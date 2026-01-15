#!/usr/bin/env python3
"""
LegiScan Bill Monitor

Searches LegiScan for tax/benefit-related bills and creates GitHub issues
for relevant legislation. Prevents duplicates via Supabase tracking.

Usage:
    export LEGISCAN_API_KEY="your_api_key"
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_KEY="your_anon_key"
    python scripts/legiscan_monitor.py

Or with specific states:
    python scripts/legiscan_monitor.py --states NH,NY,CA
"""

import os
import json
import argparse
import subprocess
import requests
from datetime import datetime

# Configuration
LEGISCAN_API_KEY = os.environ.get("LEGISCAN_API_KEY")
LEGISCAN_BASE_URL = "https://api.legiscan.com/"
GITHUB_REPO = "PolicyEngine/state-legislative-tracker"

# Supabase configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ffgngqlgfsvqartilful.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

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

# States to monitor (None = all states)
# Can be overridden via --states argument
DEFAULT_STATES = None

# Target session year
TARGET_SESSION_YEAR = 2026

# Cache for session IDs (state -> session_id for 2026)
SESSION_CACHE = {}


def get_current_session_id(state):
    """Get the session_id for the current (2026) legislative session."""
    if state in SESSION_CACHE:
        return SESSION_CACHE[state]

    try:
        result = legiscan_request("getSessionList", state=state)
        sessions = result.get("sessions", [])

        for session in sessions:
            year_start = session.get("year_start", 0)
            year_end = session.get("year_end", 0)
            # Find session that includes 2026
            if year_start <= TARGET_SESSION_YEAR <= year_end:
                SESSION_CACHE[state] = session.get("session_id")
                return SESSION_CACHE[state]

        # No 2026 session found
        SESSION_CACHE[state] = None
        return None
    except Exception as e:
        print(f"  Warning: Could not get session for {state}: {e}")
        return None


# ============== Supabase Functions ==============

def supabase_request(method, endpoint, data=None):
    """Make a request to Supabase REST API."""
    if not SUPABASE_KEY:
        raise ValueError("SUPABASE_KEY environment variable not set")

    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    if method == "GET":
        response = requests.get(url, headers=headers)
    elif method == "POST":
        response = requests.post(url, headers=headers, json=data)
    else:
        raise ValueError(f"Unsupported method: {method}")

    response.raise_for_status()
    return response.json() if response.text else None


def get_processed_bill_ids():
    """Get set of already-processed bill IDs from Supabase."""
    try:
        results = supabase_request("GET", "processed_bills?select=bill_id")
        return {str(r["bill_id"]) for r in results}
    except Exception as e:
        print(f"Warning: Could not fetch processed bills from Supabase: {e}")
        return set()


def save_processed_bill(bill, matched_query, github_issue_url=None, skipped_reason=None):
    """Save a processed bill to Supabase with full details."""
    try:
        state = bill.get("state", "")
        bill_number = bill.get("bill_number", "")
        session = bill.get("session", {})
        session_name = session.get("session_name", "")
        year_start = session.get("year_start", "")
        legiscan_url = f"https://legiscan.com/{state}/bill/{bill_number}/{year_start}"

        data = {
            "bill_id": int(bill.get("bill_id")),
            "state": state,
            "bill_number": bill_number,
            "title": bill.get("title", ""),
            "description": bill.get("description", ""),
            "status": bill.get("status_desc", ""),
            "status_date": bill.get("status_date") or None,
            "last_action": bill.get("last_action", ""),
            "last_action_date": bill.get("last_action_date") or None,
            "official_url": bill.get("url", ""),
            "session_name": session_name,
            "github_issue_url": github_issue_url,
            "matched_query": matched_query,
            "legiscan_url": legiscan_url,
            "skipped_reason": skipped_reason
        }
        supabase_request("POST", "processed_bills", data)
        return True
    except Exception as e:
        print(f"  Warning: Could not save to Supabase: {e}")
        return False


# ============== LegiScan Functions ==============

def legiscan_request(operation, **params):
    """Make a request to the LegiScan API."""
    if not LEGISCAN_API_KEY:
        raise ValueError("LEGISCAN_API_KEY environment variable not set")

    params["key"] = LEGISCAN_API_KEY
    params["op"] = operation

    response = requests.get(LEGISCAN_BASE_URL, params=params)
    response.raise_for_status()

    data = response.json()
    if data.get("status") == "ERROR":
        raise Exception(f"LegiScan API error: {data.get('alert', {}).get('message', 'Unknown error')}")

    return data


def search_bills(query, state=None, session_id=None, max_results=100):
    """
    Search for bills matching a query.

    Args:
        query: Search term
        state: Two-letter state code (e.g., "NH") or None for all states
        session_id: Specific session ID to search (most efficient)
        max_results: Maximum number of results to return

    Returns:
        List of bill summaries (bill_id and relevance only from search)
    """
    params = {"query": query}
    if state:
        params["state"] = state
    if session_id:
        params["id"] = session_id  # Filter to specific session
    else:
        params["year"] = 1  # Fallback to current year

    try:
        result = legiscan_request("getSearchRaw", **params)
        searchresult = result.get("searchresult", {})

        # Results are in a "results" array
        results = searchresult.get("results", [])

        # Limit results to avoid burning API quota
        return results[:max_results]
    except Exception as e:
        print(f"  Warning: Search failed for '{query}': {e}")
        return []


def is_2026_session(bill):
    """Check if the bill is from a 2026 legislative session."""
    session = bill.get("session", {})
    session_name = session.get("session_name", "")
    year_start = session.get("year_start", 0)
    year_end = session.get("year_end", 0)

    # Check if 2026 is within the session's year range
    if year_start <= TARGET_SESSION_YEAR <= year_end:
        return True

    # Also check session name for "2026"
    if "2026" in str(session_name):
        return True

    return False


def get_bill_details(bill_id):
    """Get full details for a specific bill."""
    result = legiscan_request("getBill", id=bill_id)
    bill = result.get("bill", {})

    # Extract last_action from history array (not a direct field)
    history = bill.get("history", [])
    if history and isinstance(history, list):
        last_entry = history[-1]
        bill["last_action"] = last_entry.get("action", "")
        bill["last_action_date"] = last_entry.get("date", "")

    return bill


# ============== GitHub Functions ==============

def create_digest_issue(bills_with_queries):
    """Create a single digest issue for all new bills found."""
    today = datetime.now().strftime("%Y-%m-%d")
    bill_count = len(bills_with_queries)

    # Group bills by state
    by_state = {}
    for bill, query in bills_with_queries:
        state = bill.get("state", "US")
        if state not in by_state:
            by_state[state] = []
        by_state[state].append((bill, query))

    issue_title = f"[{today}] LegiScan Monitor: {bill_count} new bill{'s' if bill_count != 1 else ''} found"

    # Build body
    body_parts = [
        f"## Daily Bill Digest - {today}",
        f"",
        f"Found **{bill_count} new bill{'s' if bill_count != 1 else ''}** across **{len(by_state)} state{'s' if len(by_state) != 1 else ''}**.",
        f"",
    ]

    for state in sorted(by_state.keys()):
        state_bills = by_state[state]
        body_parts.append(f"### {state} ({len(state_bills)} bill{'s' if len(state_bills) != 1 else ''})")
        body_parts.append("")

        for bill, query in state_bills:
            bill_number = bill.get("bill_number", "Unknown")
            title = bill.get("title", "No title")
            short_title = title[:100] + "..." if len(title) > 100 else title
            status = bill.get("status_desc", "Unknown")
            last_action = bill.get("last_action", "")
            last_action_date = bill.get("last_action_date", "")
            year_start = bill.get("session", {}).get("year_start", "")
            legiscan_url = f"https://legiscan.com/{state}/bill/{bill_number}/{year_start}"
            official_url = bill.get("url", "")

            body_parts.append(f"#### [{state}-{bill_number}]({legiscan_url})")
            body_parts.append(f"**{short_title}**")
            body_parts.append(f"")
            body_parts.append(f"- Status: {status}")
            if last_action:
                body_parts.append(f"- Last Action ({last_action_date}): {last_action}")
            body_parts.append(f"- Matched: `{query}`")
            if official_url:
                body_parts.append(f"- [Official Text]({official_url})")
            body_parts.append("")

    body_parts.append("---")
    body_parts.append("*Auto-generated by legiscan_monitor.py*")

    issue_body = "\n".join(body_parts)

    try:
        result = subprocess.run(
            ["gh", "issue", "create",
             "--repo", GITHUB_REPO,
             "--title", issue_title,
             "--body", issue_body],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"  Error creating digest issue: {e.stderr}")
        return None


# ============== Relevance Filter ==============

def is_relevant_bill(bill):
    """
    Filter to determine if a bill is relevant to PolicyEngine.
    Returns True if the bill seems worth reviewing.
    """
    title = (bill.get("title", "") + " " + bill.get("description", "")).lower()

    # Keywords that indicate relevance (individual tax/benefits)
    # Keep tight to reduce noise - focus on individual/personal tax and benefits
    relevant_keywords = [
        "personal income tax", "individual income tax",
        "state income tax",  # catches "State Income Tax; exclude tips"
        "income tax; reduce", "income tax; exclude",  # GA-style bill titles
        "income tax rate", "tax bracket", "flat tax",
        "standard deduction",
        "eitc", "earned income tax credit", "earned income credit",
        "child tax credit", "child and dependent care", "child and dependent care credit",
        "personal exemption",
        "working families tax credit", "working families credit",
        "snap benefit", "food stamp",
    ]

    # Keywords that indicate NOT relevant (business/corporate/local focus)
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
        # Developer/housing credits (not individual)
        "housing tax credit", "low income housing", "lihtc",
        "at-risk development", "housing development fund",
        "rent stabiliz", "maximum rent",
        # Sales and use tax (not modeled)
        "sales and use tax", "sales tax", "retail sales",
        # Charitable/donation credits
        "law enforcement", "contributions to", "foster child support",
        "qualified education expense", "education expense tax credit",
        "qualified education donation", "education donation",
        "organ and tissue", "food rescue", "grocery donation",
        "food donation",
        # Government/authority bills
        "authority act", "commission act", "redevelopment authority",
        "governing authority",
        # Military/active duty exemptions
        "military", "active duty", "armed forces", "national guard",
        # Health/employer arrangements (not modeled)
        "health reimbursement arrangement", "employer health",
        "warming center",
        "medicaid", "teledentistry", "dentist", "dental",
        "certificate of need", "rural hospital", "sickle cell",
        "fertility", "peachcare",
        "health insurance affordability", "aca", "marketplace",
        # Education (not modeled)
        "quality basic education", "educational opportunity",
        "every student act", "school choice", "school voucher",
        "education savings",
        # Procedural/administrative bills
        "levy and sale", "appeal and protest", "carryover", "carried forward",
        "any bill proposing", "voting requirement",
        "inheritance", "intestate succession",
        # Other non-individual
        "first responder", "volunteer tax credit",
        "sports betting", "gaming",
        "workforce-ready", "preceptor",
        "firearm", "safe storage",
        "historic", "rehabilitation of certified",
        "emergency power", "generator",
        "fire and emergency",
        "rural development", "disclosure and posting",
        # Climate/environment
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

    # Exclude if any exclusion keyword matches
    if any(kw in title for kw in exclude_keywords):
        return False

    # Include if any relevant keyword matches
    return any(kw in title for kw in relevant_keywords)


# ============== Main ==============

def main():
    parser = argparse.ArgumentParser(description="Monitor LegiScan for relevant bills")
    parser.add_argument("--states", help="Comma-separated list of state codes (e.g., NH,NY,CA)")
    parser.add_argument("--dry-run", action="store_true", help="Don't create issues, just show what would be created")
    parser.add_argument("--query", help="Run a single specific query instead of all default queries")
    args = parser.parse_args()

    # Validate environment
    if not LEGISCAN_API_KEY:
        print("Error: LEGISCAN_API_KEY environment variable not set")
        return 1

    if not SUPABASE_KEY:
        print("Error: SUPABASE_KEY environment variable not set")
        return 1

    states = args.states.split(",") if args.states else DEFAULT_STATES
    queries = [args.query] if args.query else SEARCH_QUERIES

    print("LegiScan Bill Monitor")
    print("=====================")
    print(f"States: {states or 'All'}")
    print(f"Queries: {len(queries)}")
    print(f"Dry run: {args.dry_run}")
    print()

    # Load previously processed bills from Supabase
    print("Fetching processed bills from Supabase...")
    processed_ids = get_processed_bill_ids()
    print(f"Previously processed: {len(processed_ids)} bills")
    print()

    new_bills = []
    skipped_bills = []  # Track skipped bills for review
    skipped_processed = 0
    skipped_irrelevant = 0
    skipped_wrong_session = 0

    # Search for bills
    # Note: getSearchRaw only returns bill_id and relevance, so we collect IDs first
    # then fetch full details for unique bills
    candidate_bill_ids = {}  # bill_id -> (matched_query, relevance)

    for query in queries:
        print(f"Searching: '{query}'")

        if states:
            for state in states:
                # Get 2026 session ID for this state
                session_id = get_current_session_id(state)
                if not session_id:
                    print(f"  {state}: No 2026 session found, skipping")
                    continue

                results = search_bills(query, state=state, session_id=session_id)
                print(f"  {state}: {len(results)} results (session {session_id})")

                for result in results:
                    bill_id = str(result.get("bill_id"))
                    relevance = result.get("relevance", 0)

                    # Skip if already processed
                    if bill_id in processed_ids:
                        skipped_processed += 1
                        continue

                    # Track this bill (keep highest relevance query)
                    if bill_id not in candidate_bill_ids or relevance > candidate_bill_ids[bill_id][1]:
                        candidate_bill_ids[bill_id] = (query, relevance)
        else:
            # Search all states - use year=1 as fallback (less efficient)
            results = search_bills(query)
            print(f"  All states: {len(results)} results")

            for result in results:
                bill_id = str(result.get("bill_id"))
                relevance = result.get("relevance", 0)

                if bill_id in processed_ids:
                    skipped_processed += 1
                    continue

                if bill_id not in candidate_bill_ids or relevance > candidate_bill_ids[bill_id][1]:
                    candidate_bill_ids[bill_id] = (query, relevance)

    print()
    print(f"Fetching details for {len(candidate_bill_ids)} candidate bills...")

    # Now fetch full details for each candidate bill
    for bill_id, (matched_query, relevance) in candidate_bill_ids.items():
        try:
            bill = get_bill_details(int(bill_id))
        except Exception as e:
            print(f"  Warning: Could not fetch bill {bill_id}: {e}")
            continue

        state_code = bill.get("state", "US")
        bill_number = bill.get("bill_number", "")
        session = bill.get("session", {})
        session_name = session.get("session_name", "")
        legiscan_url = f"https://legiscan.com/{state_code}/bill/{bill_number}/{session_name}"

        # Skip if not from 2026 session - DON'T save (too many old bills)
        if not is_2026_session(bill):
            skipped_wrong_session += 1
            continue

        # Skip if not relevant - SAVE to Supabase (it's 2026, just not relevant to us)
        if not is_relevant_bill(bill):
            skipped_irrelevant += 1
            skipped_bills.append((bill, matched_query, "not_relevant"))
            if not args.dry_run:
                save_processed_bill(bill, matched_query, skipped_reason="not_relevant")
            continue

        new_bills.append((bill, matched_query))

    # Summary
    print()
    print("Summary:")
    print(f"  Skipped (already in Supabase): {skipped_processed}")
    print(f"  Skipped (not 2026 session): {skipped_wrong_session}")
    print(f"  Skipped (not relevant): {skipped_irrelevant}")
    print(f"  New bills for digest: {len(new_bills)}")
    print()

    # Show skipped bills for review (limit to first 10)
    if skipped_bills and args.dry_run:
        print("=" * 60)
        print("SKIPPED BILLS (not relevant) - showing first 10:")
        print("=" * 60)
        for bill, query, reason in skipped_bills[:10]:
            state = bill.get("state", "US")
            bill_number = bill.get("bill_number", "")
            title = bill.get("title", "")[:60]
            print(f"  [{state}-{bill_number}] {title}...")
        if len(skipped_bills) > 10:
            print(f"  ... and {len(skipped_bills) - 10} more")
        print()

    if not new_bills:
        print("No new bills to process.")
        return 0

    # Show bills that will be included
    print("Bills to include in digest:")
    for bill, matched_query in new_bills:
        state = bill.get("state", "US")
        bill_number = bill.get("bill_number", "")
        title = bill.get("title", "")[:50]
        year_start = bill.get("session", {}).get("year_start", "")
        legiscan_url = f"https://legiscan.com/{state}/bill/{bill_number}/{year_start}"
        print(f"  [{state}-{bill_number}] {title}...")
        print(f"    {legiscan_url}")

    if args.dry_run:
        print()
        print(f"[DRY RUN] Would create 1 digest issue with {len(new_bills)} bills")
        return 0

    # Create single digest issue
    print()
    print("Creating digest issue...")
    issue_url = create_digest_issue(new_bills)

    if issue_url:
        print(f"Created: {issue_url}")

        # Save all bills to Supabase
        for bill, matched_query in new_bills:
            save_processed_bill(bill, matched_query, github_issue_url=issue_url)

        print(f"Saved {len(new_bills)} bills to Supabase")
    else:
        print("Failed to create digest issue")
        return 1

    print()
    print(f"Done! Created 1 digest issue with {len(new_bills)} bills.")
    return 0


if __name__ == "__main__":
    exit(main())
