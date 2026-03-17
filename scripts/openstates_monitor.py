#!/usr/bin/env python3
"""
OpenStates Bill Monitor

Searches OpenStates API for tax/benefit-related bills and saves them to Supabase
for triage.

Usage:
    export OPENSTATES_API_KEY="your_api_key"
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_KEY="your_service_key"

    # Scan all states with standard keyword queries
    python scripts/openstates_monitor.py

    # Scan specific states
    python scripts/openstates_monitor.py --states NY,GA,CT

    # Single ad-hoc query
    python scripts/openstates_monitor.py --query "earned income tax credit"

    # Dry run (show what would be saved, don't write to Supabase)
    python scripts/openstates_monitor.py --dry-run

Get a free API key at: https://openstates.org/accounts/signup/

Rate limits (free tier): 10 requests/min, 250 requests/day.
A single-state scan uses ~11 requests (one per query).
An all-states scan uses ~11 requests (queries search all states by default).
"""

import os
import sys
import json
import hashlib
import argparse
import time
import requests
from datetime import datetime

# ============== Configuration ==============

OPENSTATES_API_KEY = os.environ.get("OPENSTATES_API_KEY")
OPENSTATES_BASE_URL = "https://v3.openstates.org"

# Search queries for PolicyEngine-relevant bills
SEARCH_QUERIES = [
    "income tax rate",
    "flat tax",
    "child tax credit",
    "child and dependent care credit",
    "personal exemption",
    "earned income tax credit",
    "EITC",
    "SNAP benefits",
    "tax rebate",
    "standard deduction",
    "tax bracket",
]

# All 50 US states + DC — OpenStates uses lowercase jurisdiction names
ALL_US_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California",
    "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
    "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
    "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
    "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
    "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
    "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
    "District of Columbia",
]

# State name -> abbreviation mapping
STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC",
}

# Reverse mapping: abbreviation -> jurisdiction name
ABBR_TO_STATE = {v: k for k, v in STATE_ABBR.items()}

# Target session year
TARGET_SESSION_YEAR = 2026


# ============== OpenStates API ==============

def openstates_request(endpoint, params=None, max_retries=3):
    """Make a request to the OpenStates API v3 with retry on rate limit."""
    if not OPENSTATES_API_KEY:
        raise ValueError("OPENSTATES_API_KEY environment variable not set")

    headers = {"X-API-KEY": OPENSTATES_API_KEY}
    url = f"{OPENSTATES_BASE_URL}{endpoint}"

    for attempt in range(max_retries):
        response = requests.get(url, headers=headers, params=params or {})

        if response.status_code == 429:
            wait = 15 * (attempt + 1)  # 15s, 30s, 45s
            print(f"  Rate limited, waiting {wait}s...")
            time.sleep(wait)
            continue

        response.raise_for_status()
        return response.json()

    # Final attempt without retry
    response = requests.get(url, headers=headers, params=params or {})
    response.raise_for_status()
    return response.json()


def search_bills_openstates(query, jurisdiction=None, session=None, per_page=20, max_pages=10):
    """
    Search for bills via OpenStates API.

    Args:
        query: Full text search term
        jurisdiction: State name (e.g., "New York") or None for all
        session: Session identifier (e.g., "2025-2026")
        per_page: Results per page (max 20 on free tier)
        max_pages: Maximum number of pages to fetch

    Returns:
        List of bill dicts from OpenStates
    """
    params = {
        "q": query,
        "per_page": per_page,
        "sort": "updated_desc",
        # Only get bills from recent sessions (avoids old 2017-2018 results)
        "created_since": f"{TARGET_SESSION_YEAR - 1}-01-01",
    }
    if jurisdiction:
        params["jurisdiction"] = jurisdiction
    if session:
        params["session"] = session

    all_results = []

    for page in range(1, max_pages + 1):
        params["page"] = page
        try:
            data = openstates_request("/bills", params)
            results = data.get("results", [])
            all_results.extend(results)

            # Check if there are more pages
            pagination = data.get("pagination", {})
            total_pages = pagination.get("max_page", 1)
            if page >= total_pages:
                break

            # Free tier: 10 requests/min, so ~6s between requests
            time.sleep(6)

        except Exception as e:
            print(f"  Warning: Search page {page} failed for '{query}': {e}")
            break

    return all_results


# ============== Normalize to processed_bills format ==============

def normalize_bill(os_bill):
    """
    Convert an OpenStates bill dict to our processed_bills format.

    OpenStates fields -> processed_bills columns.
    """
    jurisdiction = os_bill.get("jurisdiction", {})
    jurisdiction_name = jurisdiction.get("name", "")
    state_abbr = STATE_ABBR.get(jurisdiction_name, "")

    # Bill identifier (e.g., "SB 168", "HB 3492")
    bill_number = os_bill.get("identifier", "")

    # Title — OpenStates uses "title" directly
    title = os_bill.get("title", "")

    # Description — check abstracts first, fall back to title
    abstracts = os_bill.get("abstracts", [])
    description = abstracts[0].get("abstract", "") if abstracts else title

    # OpenStates URL for the bill
    openstates_url = os_bill.get("openstates_url", "")

    # Session
    session = os_bill.get("session", "")

    # Latest action
    latest_action = os_bill.get("latest_action_description", "")
    latest_action_date = os_bill.get("latest_action_date", "")

    # Status — derive from latest action
    # We infer from latest_passage_date and classification
    latest_passage_date = os_bill.get("latest_passage_date")
    if latest_passage_date:
        status = "Passed"
    else:
        first_action = os_bill.get("first_action_date", "")
        status = "Introduced" if first_action else "Prefiled"

    # Generate a stable integer bill_id from OpenStates ID
    # (processed_bills.bill_id is INTEGER PK)
    os_id = os_bill.get("id", "")
    bill_id = _generate_bill_id(os_id)

    return {
        "bill_id": bill_id,
        "state": state_abbr,
        "bill_number": bill_number,
        "title": title,
        "description": description,
        "status": status,
        "status_date": latest_action_date or None,
        "last_action": latest_action,
        "last_action_date": latest_action_date or None,
        "official_url": openstates_url,
        "session_name": session,
        "legiscan_url": openstates_url,  # Reuses legacy column name for source URL
        "source": "openstates",
        "source_id": os_id,
    }


def _generate_bill_id(openstates_id):
    """
    Generate a stable integer from an OpenStates ID string.

    Uses first 8 bytes of MD5 hash, offset by 10M to avoid collisions
    with existing integer IDs (offset by 10M to avoid collisions).
    """
    hash_bytes = hashlib.md5(openstates_id.encode()).digest()
    # Take first 4 bytes as unsigned int, add offset
    int_id = int.from_bytes(hash_bytes[:4], "big") % 90_000_000 + 10_000_000
    return int_id


# ============== Relevance Filter ==============

def is_relevant_bill(bill):
    """
    Filter to determine if a bill is relevant to PolicyEngine.
    Returns True if the bill seems worth reviewing.

    Accepts either raw OpenStates format or normalized format.
    """
    # Handle both OpenStates raw and normalized formats
    title_field = bill.get("title", "")
    desc_field = bill.get("description", "")

    # For raw OpenStates bills, also check abstracts
    abstracts = bill.get("abstracts", [])
    abstract_text = " ".join(a.get("abstract", "") for a in abstracts) if abstracts else ""

    title = (title_field + " " + desc_field + " " + abstract_text).lower()

    # Keywords that indicate relevance (individual tax/benefits)
    relevant_keywords = [
        "personal income tax", "individual income tax",
        "state income tax",
        "income tax; reduce", "income tax; exclude",
        "income tax rate", "tax bracket", "flat tax",
        "standard deduction",
        "eitc", "earned income tax credit", "earned income credit",
        "child tax credit", "child and dependent care", "child and dependent care credit",
        "personal exemption",
        "working families tax credit", "working families credit",
        "snap benefit", "food stamp",
    ]

    # Keywords that indicate NOT relevant
    exclude_keywords = [
        # Business/corporate
        "business tax credit", "corporate", "tariff",
        "enterprise zone", "investment tax credit",
        "franchise tax", "commercial", "employer tax credit",
        "industrial development", "business enterprises",
        "opportunity zone", "economic development",
        "thrift institution", "returnship", "phoenix employee",
        "businesses that develop", "local employment",
        "model management",
        # Specific industry credits
        "film tax credit", "film,", "postproduction",
        "film and television", "television production",
        "entertainment production",
        "agricultural tax credit", "hemp", "timber",
        "beginning farmer", "farmer tax credit", "carbon farming",
        "farmers who use",
        "clean energy", "energy production", "energy investment",
        "aviation fuel", "hydroelectric", "motor fuel",
        # Local/property taxes
        "ad valorem", "county;", "city of",
        "school district", "municipal",
        "property tax", "school tax", "star credit", "the star",
        # Developer/housing credits
        "housing tax credit", "low income housing", "lihtc",
        "at-risk development", "housing development fund",
        "rent stabiliz", "maximum rent",
        # Sales and use tax
        "sales and use tax", "sales tax", "retail sales",
        # Charitable/donation credits
        "law enforcement", "contributions to", "foster child support",
        "qualified education expense", "education expense tax credit",
        "qualified education donation", "education donation",
        "organ and tissue", "food rescue", "grocery donation",
        "food donation",
        # Government/authority
        "authority act", "commission act", "redevelopment authority",
        "governing authority",
        # Military
        "military", "active duty", "armed forces", "national guard",
        # Health/employer
        "health reimbursement arrangement", "employer health",
        "warming center",
        "medicaid", "teledentistry", "dentist", "dental",
        "certificate of need", "rural hospital", "sickle cell",
        "fertility", "peachcare",
        "health insurance affordability", "aca", "marketplace",
        # Education
        "quality basic education", "educational opportunity",
        "every student act", "school choice", "school voucher",
        "education savings",
        # Procedural/administrative
        "levy and sale", "appeal and protest", "carryover", "carried forward",
        "any bill proposing", "voting requirement",
        "inheritance", "intestate succession",
        # Other
        "first responder", "volunteer tax credit",
        "sports betting", "gaming",
        "workforce-ready", "preceptor",
        "firearm", "safe storage",
        "historic", "rehabilitation of certified",
        "emergency power", "generator",
        "fire and emergency",
        "rural development", "disclosure and posting",
        # Disaster-specific
        "wildfire", "wildland fire", "bobcat fire", "fire exclusion",
        "landfill event", "disaster relief", "disaster exclusion",
        # Trust taxation
        "nongrantor trust", "grantor trust",
        # Climate
        "climate", "environmental conservation", "environmental",
        # Real estate
        "real property transfer", "transfer of real property",
        "transfer of certain real prop",
        # Not modeled
        "minimum wage", "homebuyer", "home buyer", "homeowner",
        "local income tax", "local tax collection",
        "caregiver", "poll worker",
        "work opportunity tax credit", "jobs development",
        "lead poisoning", "lead free home",
        "stock transfer", "gold star",
        "child care capital", "child care program capital",
        "opportunity account", "college preparation",
        "child psychiatry", "real property transfer",
        "irrigation", "utility bill",
        "long-term health", "landowner",
        "not-for-profit", "food service establishment",
        "child support",
        # Occupation-specific / behavior-specific
        "psychiatry", "psychiatric", "mental health services",
        "theft loss", "casualty loss",
        "premarital counseling", "stillbirth",
        # Niche credits/deductions
        "conservation contribution", "conservation credit",
        "long-term care insurance", "long-term care tax credit",
        # Administrative/procedural
        "check-off box", "surcharge",
        "signage", "food distributor",
        "emergency assistance", "incarcerated",
        "adoption", "transitional tax credit",
        "commissioner of", "department of social services",
        "to study", "extends provisions", "extends the effectiveness",
        "reissuance", "fraud victim",
        "aggregate funds", "installment payment",
        "foreign dependent",
        "identifies and enrolls", "to be used to purchase",
        "tax levy", "qualified expenses",
        "awareness week", "providing for the study",
        "gym membership", "fitness", "tithing",
        "urge congress",
        # Substances
        "cannabis", "marijuana", "vapor product", "tobacco", "alcoholic beverages",
    ]

    if any(kw in title for kw in exclude_keywords):
        return False

    return any(kw in title for kw in relevant_keywords)


# ============== Supabase Functions ==============

def get_supabase_client():
    """Get Supabase client."""
    try:
        from supabase import create_client
    except ImportError:
        print("Error: supabase package not installed. Run: pip install supabase")
        return None

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        return None

    return create_client(url, key)


def get_processed_bill_keys(supabase):
    """
    Get set of already-processed bill dedup keys (state + bill_number).

    Using state+bill_number instead of bill_id since OpenStates IDs
    This prevents duplicates when re-running.
    """
    try:
        all_keys = set()
        page_size = 1000
        offset = 0
        while True:
            result = (
                supabase.table("processed_bills")
                .select("state, bill_number")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            for r in result.data:
                key = f"{r['state']}:{r['bill_number'].replace(' ', '')}"
                all_keys.add(key)
            if len(result.data) < page_size:
                break
            offset += page_size
        return all_keys
    except Exception as e:
        print(f"Warning: Could not fetch processed bills: {e}")
        return set()


def save_processed_bill(supabase, bill_data, matched_query):
    """Save a normalized bill to Supabase processed_bills table."""
    try:
        data = {
            "bill_id": bill_data["bill_id"],
            "state": bill_data["state"],
            "bill_number": bill_data["bill_number"],
            "title": bill_data["title"],
            "description": bill_data["description"],
            "status": bill_data["status"],
            "status_date": bill_data["status_date"],
            "last_action": bill_data["last_action"],
            "last_action_date": bill_data["last_action_date"],
            "official_url": bill_data["official_url"],
            "session_name": bill_data.get("session_name", ""),
            "legiscan_url": bill_data.get("legiscan_url", ""),
            "matched_query": matched_query,
        }
        supabase.table("processed_bills").upsert(data).execute()
        return True
    except Exception as e:
        print(f"  Warning: Could not save to Supabase: {e}")
        return False


# ============== Scan Modes ==============

def run_search_scan(supabase, states, queries, dry_run):
    """
    Search-based scan: keyword queries across states (ad-hoc mode).

    Returns (new_bills, stats).
    """
    processed_keys = get_processed_bill_keys(supabase)
    print(f"Previously processed: {len(processed_keys)} bills")
    print()

    skipped_processed = 0
    skipped_irrelevant = 0
    candidate_bills = {}  # dedup_key -> (normalized_bill, matched_query)

    for qi, query in enumerate(queries):
        print(f"Searching: '{query}'")

        if states:
            for si, state_abbr in enumerate(states):
                jurisdiction = ABBR_TO_STATE.get(state_abbr, state_abbr)
                results = search_bills_openstates(query, jurisdiction=jurisdiction)
                print(f"  {state_abbr}: {len(results)} results")

                for os_bill in results:
                    normalized = normalize_bill(os_bill)
                    dedup_key = f"{normalized['state']}:{normalized['bill_number'].replace(' ', '')}"

                    if dedup_key in processed_keys:
                        skipped_processed += 1
                        continue

                    if not is_relevant_bill(os_bill):
                        skipped_irrelevant += 1
                        continue

                    candidate_bills[dedup_key] = (normalized, query)

                # Delay between states within a query
                if si < len(states) - 1:
                    time.sleep(6)
        else:
            results = search_bills_openstates(query)
            print(f"  All states: {len(results)} results")

            for os_bill in results:
                normalized = normalize_bill(os_bill)
                dedup_key = f"{normalized['state']}:{normalized['bill_number'].replace(' ', '')}"

                if dedup_key in processed_keys:
                    skipped_processed += 1
                    continue

                if not is_relevant_bill(os_bill):
                    skipped_irrelevant += 1
                    continue

                candidate_bills[dedup_key] = (normalized, query)

        # Delay between queries (free tier: 10 req/min)
        if qi < len(queries) - 1:
            time.sleep(6)

    new_bills = list(candidate_bills.values())
    stats = {
        "skipped_processed": skipped_processed,
        "skipped_irrelevant": skipped_irrelevant,
    }
    return new_bills, stats


# ============== Main ==============

def main():
    parser = argparse.ArgumentParser(description="Monitor OpenStates for relevant bills")
    parser.add_argument("--states", help="Comma-separated state codes (e.g., NY,GA,CT)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be saved without writing")
    parser.add_argument("--query", help="Run a single ad-hoc search query")
    args = parser.parse_args()

    if not OPENSTATES_API_KEY:
        print("Error: OPENSTATES_API_KEY environment variable not set")
        print("Get a free key at: https://openstates.org/accounts/signup/")
        return 1

    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
        return 1

    states = args.states.split(",") if args.states else None
    queries = [args.query] if args.query else SEARCH_QUERIES

    print("OpenStates Bill Monitor")
    print("=======================")
    if args.query:
        print(f"Query: '{args.query}'")
    else:
        print(f"Queries: {len(queries)} standard keywords")
    print(f"States: {states or 'All'}")
    print(f"Dry run: {args.dry_run}")
    print()

    new_bills, stats = run_search_scan(supabase, states, queries, args.dry_run)

    # Summary
    print()
    print("Summary:")
    print(f"  Skipped (already in Supabase): {stats['skipped_processed']}")
    print(f"  Skipped (not relevant): {stats['skipped_irrelevant']}")
    print(f"  New relevant bills: {len(new_bills)}")
    print()

    if not new_bills:
        print("No new bills to process.")
        return 0

    # Show bills
    print("Bills to include:")
    for bill_data, matched_query in new_bills:
        state = bill_data["state"]
        bill_num = bill_data["bill_number"]
        title = bill_data["title"][:60]
        url = bill_data["official_url"]
        print(f"  [{state} {bill_num}] {title}...")
        print(f"    {url}")

    if args.dry_run:
        print()
        print(f"[DRY RUN] Would save {len(new_bills)} bills to Supabase")
        return 0

    # Save to Supabase
    saved = 0
    for bill_data, matched_query in new_bills:
        if save_processed_bill(supabase, bill_data, matched_query):
            saved += 1

    print()
    print(f"Done! Saved {saved} new bills to Supabase.")
    print("Run /triage-bills to score and create per-state GitHub issues.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
