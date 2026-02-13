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
import base64
import zipfile
import io
import time
import requests
from datetime import datetime

# Configuration
LEGISCAN_API_KEY = os.environ.get("LEGISCAN_API_KEY")
LEGISCAN_BASE_URL = "https://api.legiscan.com/"
GITHUB_REPO = "PolicyEngine/state-legislative-tracker"

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

# All 50 US states + DC (needed for dataset API which requires explicit state codes)
ALL_US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
]

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

def get_supabase_client():
    """Get Supabase client. Returns None if credentials not set."""
    try:
        from supabase import create_client
    except ImportError:
        print("Error: supabase package not installed")
        print("Run: pip install supabase")
        return None

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        return None

    return create_client(url, key)


def get_processed_bill_ids(supabase):
    """Get set of already-processed bill IDs from Supabase."""
    try:
        all_ids = set()
        page_size = 1000
        offset = 0
        while True:
            result = (
                supabase.table("processed_bills")
                .select("bill_id")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            batch = {str(r["bill_id"]) for r in result.data}
            all_ids.update(batch)
            if len(result.data) < page_size:
                break
            offset += page_size
        return all_ids
    except Exception as e:
        print(f"Warning: Could not fetch processed bills from Supabase: {e}")
        return set()


def save_processed_bill(supabase, bill, matched_query, github_issue_url=None, skipped_reason=None):
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

        supabase.table("processed_bills").upsert(data).execute()
        return True
    except Exception as e:
        print(f"  Warning: Could not save to Supabase: {e}")
        return False


def get_stored_dataset_hashes(supabase):
    """Load all stored dataset hashes into a {session_id: hash} dict."""
    try:
        result = supabase.table("dataset_hashes").select("session_id, dataset_hash").execute()
        return {r["session_id"]: r["dataset_hash"] for r in result.data}
    except Exception as e:
        print(f"Warning: Could not fetch dataset hashes from Supabase: {e}")
        return {}


def save_dataset_hash(supabase, session_id, state, dataset_hash, dataset_date=None, session_name=None):
    """Upsert a dataset hash after successful processing."""
    try:
        data = {
            "session_id": session_id,
            "state": state,
            "dataset_hash": dataset_hash,
            "dataset_date": dataset_date,
            "session_name": session_name,
            "last_checked": datetime.utcnow().isoformat(),
        }
        supabase.table("dataset_hashes").upsert(data).execute()
        return True
    except Exception as e:
        print(f"  Warning: Could not save dataset hash: {e}")
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


def get_dataset_list(state):
    """Get list of available datasets for a state via getDatasetList.

    Returns list of dataset dicts with session_id, dataset_hash, access_key, etc.
    Handles both dict-keyed and list response formats from LegiScan.
    """
    try:
        result = legiscan_request("getDatasetList", state=state)
        datasets = result.get("datasetlist", [])

        # LegiScan may return a dict keyed by index instead of a list
        if isinstance(datasets, dict):
            datasets = list(datasets.values())

        return datasets
    except Exception as e:
        print(f"  Warning: Could not get dataset list for {state}: {e}")
        return []


def download_and_extract_dataset(session_id, access_key):
    """Download a dataset ZIP and extract bill JSONs in memory.

    Returns list of bill dicts (same structure as getBill response).
    """
    result = legiscan_request("getDataset", id=session_id, access_key=access_key)
    dataset = result.get("dataset", {})
    zip_b64 = dataset.get("zip")

    if not zip_b64:
        print(f"  Warning: No ZIP data in dataset for session {session_id}")
        return []

    # Decode base64 and open ZIP in memory
    zip_bytes = base64.b64decode(zip_b64)
    bills = []

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            # Bill files are at STATE/SESSION/bill/BILL.json
            if "/bill/" in name and name.endswith(".json"):
                with zf.open(name) as f:
                    try:
                        data = json.loads(f.read())
                        bill = data.get("bill", {})

                        # Extract last_action from history (same as get_bill_details)
                        history = bill.get("history", [])
                        if history and isinstance(history, list):
                            last_entry = history[-1]
                            bill["last_action"] = last_entry.get("action", "")
                            bill["last_action_date"] = last_entry.get("date", "")

                        bills.append(bill)
                    except (json.JSONDecodeError, KeyError) as e:
                        print(f"  Warning: Could not parse {name}: {e}")

    return bills


# ============== GitHub Functions ==============

def create_digest_issue(new_bills):
    """Create a single digest issue for all new bills found.

    Args:
        new_bills: list of (bill, query) tuples.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    bill_count = len(new_bills)

    # Group bills by state
    by_state = {}
    for bill, query in new_bills:
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
        f"Run `/triage-bills` to score these bills for PolicyEngine modelability.",
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


# ============== Scan Modes ==============

def run_search_scan(supabase, states, queries, dry_run):
    """Search-based scan: uses getSearchRaw + getBill (legacy/ad-hoc mode).

    Returns (new_bills, skipped_bills, stats) where stats is a dict with counts.
    """
    processed_ids = get_processed_bill_ids(supabase)
    print(f"Previously processed: {len(processed_ids)} bills")
    print()

    new_bills = []
    skipped_bills = []
    skipped_processed = 0
    skipped_irrelevant = 0
    skipped_wrong_session = 0

    candidate_bill_ids = {}  # bill_id -> (matched_query, relevance)

    for query in queries:
        print(f"Searching: '{query}'")

        if states:
            for state in states:
                session_id = get_current_session_id(state)
                if not session_id:
                    print(f"  {state}: No 2026 session found, skipping")
                    continue

                results = search_bills(query, state=state, session_id=session_id)
                print(f"  {state}: {len(results)} results (session {session_id})")

                for result in results:
                    bill_id = str(result.get("bill_id"))
                    relevance = result.get("relevance", 0)

                    if bill_id in processed_ids:
                        skipped_processed += 1
                        continue

                    if bill_id not in candidate_bill_ids or relevance > candidate_bill_ids[bill_id][1]:
                        candidate_bill_ids[bill_id] = (query, relevance)
        else:
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

    for bill_id, (matched_query, relevance) in candidate_bill_ids.items():
        try:
            bill = get_bill_details(int(bill_id))
        except Exception as e:
            print(f"  Warning: Could not fetch bill {bill_id}: {e}")
            continue

        if not is_2026_session(bill):
            skipped_wrong_session += 1
            continue

        if not is_relevant_bill(bill):
            skipped_irrelevant += 1
            skipped_bills.append((bill, matched_query, "not_relevant"))
            if not dry_run:
                save_processed_bill(supabase, bill, matched_query, skipped_reason="not_relevant")
            continue

        new_bills.append((bill, matched_query))

    stats = {
        "skipped_processed": skipped_processed,
        "skipped_wrong_session": skipped_wrong_session,
        "skipped_irrelevant": skipped_irrelevant,
    }
    return new_bills, skipped_bills, stats


def run_dataset_scan(supabase, states, dry_run):
    """Dataset-based scan: uses getDatasetList + getDataset (bulk mode).

    Downloads full dataset ZIPs and filters bills locally.
    ~60 API calls/day vs ~700 for search mode.

    Returns (new_bills, skipped_bills, stats) where stats is a dict with counts.
    """
    processed_ids = get_processed_bill_ids(supabase)
    stored_hashes = get_stored_dataset_hashes(supabase)
    print(f"Previously processed: {len(processed_ids)} bills")
    print(f"Stored dataset hashes: {len(stored_hashes)}")
    print()

    new_bills = []
    skipped_bills = []
    skipped_processed = 0
    skipped_irrelevant = 0
    skipped_wrong_session = 0
    datasets_downloaded = 0
    datasets_skipped_unchanged = 0
    datasets_skipped_no_2026 = 0
    api_calls = 0

    for state in states:
        print(f"Checking datasets for {state}...")
        datasets = get_dataset_list(state)
        api_calls += 1

        if not datasets:
            print(f"  {state}: No datasets available")
            continue

        for ds in datasets:
            session_id = ds.get("session_id")
            dataset_hash = ds.get("dataset_hash", "")
            access_key = ds.get("access_key", "")
            year_start = ds.get("year_start", 0)
            year_end = ds.get("year_end", 0)
            session_name = ds.get("session_name", "")
            dataset_date = ds.get("dataset_date", "")

            # Filter to sessions that include the target year
            if not (year_start <= TARGET_SESSION_YEAR <= year_end):
                datasets_skipped_no_2026 += 1
                continue

            # Check if hash has changed since last download
            if stored_hashes.get(session_id) == dataset_hash:
                datasets_skipped_unchanged += 1
                print(f"  {state} ({session_name}): unchanged, skipping")
                continue

            # Download and process dataset
            print(f"  {state} ({session_name}): downloading dataset...")
            try:
                bills = download_and_extract_dataset(session_id, access_key)
                api_calls += 1
                datasets_downloaded += 1
            except Exception as e:
                print(f"  Warning: Could not download dataset for {state} session {session_id}: {e}")
                continue

            print(f"  {state} ({session_name}): {len(bills)} bills in dataset")

            for bill in bills:
                bill_id = str(bill.get("bill_id", ""))
                if not bill_id:
                    continue

                if bill_id in processed_ids:
                    skipped_processed += 1
                    continue

                if not is_2026_session(bill):
                    skipped_wrong_session += 1
                    continue

                if not is_relevant_bill(bill):
                    skipped_irrelevant += 1
                    skipped_bills.append((bill, "dataset_scan", "not_relevant"))
                    if not dry_run:
                        save_processed_bill(supabase, bill, "dataset_scan", skipped_reason="not_relevant")
                    continue

                new_bills.append((bill, "dataset_scan"))
                # Mark as processed so we don't re-add from another session
                processed_ids.add(bill_id)

            # Save hash after successful processing
            if not dry_run:
                save_dataset_hash(supabase, session_id, state, dataset_hash,
                                  dataset_date=dataset_date, session_name=session_name)

            # Rate limit between downloads
            time.sleep(1)

    stats = {
        "skipped_processed": skipped_processed,
        "skipped_wrong_session": skipped_wrong_session,
        "skipped_irrelevant": skipped_irrelevant,
        "datasets_downloaded": datasets_downloaded,
        "datasets_skipped_unchanged": datasets_skipped_unchanged,
        "datasets_skipped_no_2026": datasets_skipped_no_2026,
        "api_calls": api_calls,
    }
    return new_bills, skipped_bills, stats


# ============== Main ==============

def main():
    parser = argparse.ArgumentParser(description="Monitor LegiScan for relevant bills")
    parser.add_argument("--states", help="Comma-separated list of state codes (e.g., NH,NY,CA)")
    parser.add_argument("--dry-run", action="store_true", help="Don't create issues, just show what would be created")
    parser.add_argument("--query", help="Run a single search query (uses search mode instead of dataset mode)")
    args = parser.parse_args()

    # Validate environment
    if not LEGISCAN_API_KEY:
        print("Error: LEGISCAN_API_KEY environment variable not set")
        return 1

    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
        return 1

    states = args.states.split(",") if args.states else None
    use_search_mode = bool(args.query)

    print("LegiScan Bill Monitor")
    print("=====================")

    if use_search_mode:
        # Search mode: ad-hoc query investigation
        queries = [args.query]
        scan_states = states or DEFAULT_STATES
        print(f"Mode: Search (query: '{args.query}')")
        print(f"States: {scan_states or 'All'}")
        print(f"Dry run: {args.dry_run}")
        print()
        print("Fetching processed bills from Supabase...")
        new_bills, skipped_bills, stats = run_search_scan(supabase, scan_states, queries, args.dry_run)
    else:
        # Dataset mode: bulk download (default for cron)
        scan_states = states or ALL_US_STATES
        print(f"Mode: Dataset (bulk download)")
        print(f"States: {len(scan_states)} states")
        print(f"Dry run: {args.dry_run}")
        print()
        print("Fetching processed bills and dataset hashes from Supabase...")
        new_bills, skipped_bills, stats = run_dataset_scan(supabase, scan_states, args.dry_run)

    # Summary
    print()
    print("Summary:")
    print(f"  Skipped (already in Supabase): {stats['skipped_processed']}")
    print(f"  Skipped (not 2026 session): {stats['skipped_wrong_session']}")
    print(f"  Skipped (not relevant): {stats['skipped_irrelevant']}")
    if not use_search_mode:
        print(f"  Datasets downloaded: {stats['datasets_downloaded']}")
        print(f"  Datasets unchanged: {stats['datasets_skipped_unchanged']}")
        print(f"  Datasets skipped (no 2026): {stats['datasets_skipped_no_2026']}")
        print(f"  API calls used: {stats['api_calls']}")
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

    # Save all bills to Supabase (unscored — use /triage-bills to score later)
    for bill, matched_query in new_bills:
        save_processed_bill(supabase, bill, matched_query)
    print(f"Saved {len(new_bills)} bills to Supabase")

    # Create single digest issue
    print()
    print("Creating digest issue...")
    issue_url = create_digest_issue(new_bills)

    if issue_url:
        print(f"Created: {issue_url}")

        # Update bills with issue URL
        for bill, matched_query in new_bills:
            try:
                supabase.table("processed_bills").update(
                    {"github_issue_url": issue_url}
                ).eq("bill_id", int(bill.get("bill_id"))).execute()
            except Exception as e:
                print(f"  Warning: Could not update issue URL for bill {bill.get('bill_id')}: {e}")
    else:
        print("Failed to create digest issue")
        return 1

    print()
    print(f"Done! Created 1 digest issue with {len(new_bills)} bills.")
    print("Run /triage-bills to score these bills for PolicyEngine modelability.")
    return 0


if __name__ == "__main__":
    exit(main())
