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
        result = supabase.table("processed_bills").select("bill_id").execute()
        return {str(r["bill_id"]) for r in result.data}
    except Exception as e:
        print(f"Warning: Could not fetch processed bills from Supabase: {e}")
        return set()


def save_processed_bill(supabase, bill, matched_query, github_issue_url=None, skipped_reason=None, scoring_result=None):
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

        if scoring_result is not None:
            data["confidence_score"] = scoring_result["score"]
            data["matched_categories"] = json.dumps(scoring_result["matched_categories"])
            data["matched_parameters"] = json.dumps(scoring_result["matched_parameters"])
            data["top_category"] = scoring_result["top_category"]

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

def create_digest_issue(scored_bills):
    """Create a single digest issue for all new bills found.

    Args:
        scored_bills: list of (bill, query, scoring) tuples, pre-sorted by score desc.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    bill_count = len(scored_bills)

    # Confidence tier counts
    high = sum(1 for _, _, s in scored_bills if s["score"] >= 75)
    medium = sum(1 for _, _, s in scored_bills if 40 <= s["score"] < 75)
    low = sum(1 for _, _, s in scored_bills if s["score"] < 40)

    # Reform type counts
    parametric = sum(1 for _, _, s in scored_bills if s.get("reform_type") == "parametric")
    structural = sum(1 for _, _, s in scored_bills if s.get("reform_type") == "structural")

    # Group bills by state
    by_state = {}
    for bill, query, scoring in scored_bills:
        state = bill.get("state", "US")
        if state not in by_state:
            by_state[state] = []
        by_state[state].append((bill, query, scoring))

    issue_title = f"[{today}] LegiScan Monitor: {bill_count} new bill{'s' if bill_count != 1 else ''} found"

    # Build body
    body_parts = [
        f"## Daily Bill Digest - {today}",
        f"",
        f"Found **{bill_count} new bill{'s' if bill_count != 1 else ''}** across **{len(by_state)} state{'s' if len(by_state) != 1 else ''}**.",
        f"",
        f"### Confidence Tiers",
        f"- **High (>=75):** {high} bill{'s' if high != 1 else ''} (auto-encode candidates)",
        f"- **Medium (40-74):** {medium} bill{'s' if medium != 1 else ''}",
        f"- **Low (<40):** {low} bill{'s' if low != 1 else ''}",
        f"",
        f"### Reform Type",
        f"- **Parametric:** {parametric} (PE parameter exists — just change the value)",
        f"- **Structural:** {structural} (needs new code in policyengine-us)",
        f"",
    ]

    for state in sorted(by_state.keys()):
        state_bills = by_state[state]
        # Sort within state: parametric first, then by score descending
        type_order = {"parametric": 0, "structural": 1, "unknown": 2}
        state_bills.sort(key=lambda x: (type_order.get(x[2].get("reform_type", "unknown"), 2), -x[2]["score"]))
        body_parts.append(f"### {state} ({len(state_bills)} bill{'s' if len(state_bills) != 1 else ''})")
        body_parts.append("")

        for bill, query, scoring in state_bills:
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
            # Confidence + reform type annotation
            categories_str = ", ".join(scoring["matched_categories"]) if scoring["matched_categories"] else "none"
            rtype = scoring.get("reform_type", "unknown")
            rtype_label = {"parametric": "Parametric", "structural": "Structural", "unknown": "Unknown"}.get(rtype, "Unknown")
            body_parts.append(f"- Confidence: **{scoring['score']}/100** ({categories_str})")
            body_parts.append(f"- Reform type: **{rtype_label}**")
            if rtype == "parametric" and scoring.get("existing_parameters"):
                body_parts.append(f"- PE parameters: `{'`, `'.join(scoring['existing_parameters'])}`")
            if scoring.get("reasoning"):
                body_parts.append(f"- {scoring['reasoning']}")
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


# ============== Confidence Scoring (LLM) ==============

_pe_parameter_cache = None


def get_pe_parameters():
    """Fetch all PE-US parameter paths from the API. Cached for the session."""
    global _pe_parameter_cache
    if _pe_parameter_cache is not None:
        return _pe_parameter_cache

    try:
        print("  Fetching PolicyEngine parameter index...")
        resp = requests.get(
            "https://api.policyengine.org/us/metadata",
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            params = data.get("result", {}).get("parameters", {})
            _pe_parameter_cache = set(params.keys())
            print(f"  Loaded {len(_pe_parameter_cache)} PE parameters")
        else:
            print(f"  Warning: PE API returned {resp.status_code}, skipping parameter lookup")
            _pe_parameter_cache = set()
    except Exception as e:
        print(f"  Warning: Could not fetch PE parameters: {e}")
        _pe_parameter_cache = set()

    return _pe_parameter_cache


def get_state_parameter_context(state, pe_params):
    """Filter PE params to gov.states.{state}.* and deduplicate parents.

    Returns a compact multi-line string for the LLM prompt.
    """
    prefix = f"gov.states.{state.lower()}."
    state_params = sorted(p for p in pe_params if p.startswith(prefix))

    if not state_params:
        return f"No parameters found for state {state}."

    # Deduplicate by grouping children under parent paths
    # e.g. gov.states.ut.tax.income.rate.[i].rate and .threshold → gov.states.ut.tax.income.rate
    seen_parents = set()
    compact = []
    for p in state_params:
        # Strip array indices like [i] and trailing leaf segments to find parent
        parts = p.replace(prefix, "").split(".")
        # Keep up to 4 levels of depth for grouping
        parent = prefix + ".".join(parts[:4])
        if parent not in seen_parents:
            seen_parents.add(parent)
            compact.append(parent)

    # Also include full paths but limit total lines
    if len(state_params) <= 300:
        return "\n".join(state_params)

    return "\n".join(compact[:300])


def _empty_score():
    """Default scoring result when LLM is unavailable."""
    return {
        "score": 0,
        "matched_categories": [],
        "matched_parameters": [],
        "top_category": None,
        "reform_type": "unknown",
        "existing_parameters": [],
        "reasoning": "Scoring unavailable",
    }


def score_bill_with_llm(bill, state_params_text):
    """Score a bill using Claude Code (`claude -p`) with PE parameter context.

    Uses the same Claude Code CLI that powers the rest of the pipeline.
    No separate API key needed — inherits auth from the environment.

    Returns dict with:
    {score, matched_categories, matched_parameters, top_category,
     reform_type, existing_parameters, reasoning}
    """
    title = bill.get("title", "")
    description = bill.get("description", "")
    state = bill.get("state", "XX")

    prompt = f"""You are a policy analyst scoring legislative bills for PolicyEngine modelability.

Bill information:
- State: {state}
- Title: {title}
- Description: {description}

Below are the existing PolicyEngine parameter paths for {state}. If the bill modifies something
that maps to one of these parameters, it is "parametric" (just change the value). If it requires
new code/parameters, it is "structural".

{state_params_text}

Note: PolicyEngine also models federal programs (SNAP/food stamps, EITC, CTC, CDCC, etc.)
at paths like gov.irs.*, gov.usda.snap.*, gov.hhs.*, etc. State bills that modify state-level
matches or supplements for these programs are often parametric.

Scoring rubric:
- 80-100: Directly parametric — bill changes a value that maps to an existing PE parameter
- 50-79: Likely modelable but may need parameter additions or adaptation
- 20-49: Structural change — needs new code in policyengine-us
- 0-19: Not modelable in PolicyEngine (e.g. purely administrative)

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{{
  "score": <integer 0-100>,
  "reform_type": "<parametric|structural|unknown>",
  "matched_parameters": ["<list of PE parameter paths this bill would affect>"],
  "top_category": "<short category label, e.g. flat_income_tax_rate, state_eitc, snap, etc.>",
  "reasoning": "<one sentence explaining the score>"
}}"""

    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json"],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            print(f"  Warning: claude -p failed (rc={result.returncode}): {result.stderr[:200]}")
            return _empty_score()

        # claude --output-format json wraps the response in {"result": "..."}
        outer = json.loads(result.stdout)
        raw = outer.get("result", result.stdout).strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:raw.rfind("```")]
        raw = raw.strip()

        parsed = json.loads(raw)

        # Normalize to expected shape
        score = int(parsed.get("score", 0))
        score = max(0, min(100, score))
        reform_type = parsed.get("reform_type", "unknown")
        if reform_type not in ("parametric", "structural", "unknown"):
            reform_type = "unknown"
        matched_params = parsed.get("matched_parameters", [])
        if not isinstance(matched_params, list):
            matched_params = []
        top_category = parsed.get("top_category")
        reasoning = parsed.get("reasoning", "")

        matched_categories = [top_category] if top_category else []
        existing_parameters = matched_params if reform_type == "parametric" else []

        return {
            "score": score,
            "matched_categories": matched_categories,
            "matched_parameters": matched_params,
            "top_category": top_category,
            "reform_type": reform_type,
            "existing_parameters": existing_parameters,
            "reasoning": reasoning,
        }

    except json.JSONDecodeError as e:
        print(f"  Warning: Could not parse scoring response as JSON: {e}")
        return _empty_score()
    except subprocess.TimeoutExpired:
        print(f"  Warning: Scoring timed out for {state} {bill.get('bill_number', '')}")
        return _empty_score()
    except FileNotFoundError:
        print("  Warning: 'claude' CLI not found, scoring disabled")
        return _empty_score()
    except Exception as e:
        print(f"  Warning: LLM scoring failed: {e}")
        return _empty_score()


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

def get_already_encoded_bill_ids(supabase):
    """Get set of bill IDs already in the encoding pipeline (have a research entry)."""
    try:
        result = supabase.table("research").select("legiscan_bill_id").not_.is_("legiscan_bill_id", "null").execute()
        return {r["legiscan_bill_id"] for r in result.data}
    except Exception as e:
        print(f"Warning: Could not fetch encoded bill IDs: {e}")
        return set()


def run_auto_encode(supabase, scored_bills, already_encoded_ids, threshold, max_bills, dry_run):
    """Auto-encode high-confidence bills via subprocess.

    Known limitation: /encode-bill has human checkpoints. This plumbing is
    opt-in via --auto-encode and should only be used after addressing checkpoint
    handling (e.g. --non-interactive flag on encode-bill, or --dangerouslySkipPermissions).

    Args:
        scored_bills: list of (bill, query, scoring) tuples
        already_encoded_ids: set of bill_ids already in research table
        threshold: minimum confidence score to auto-encode
        max_bills: maximum number of bills to auto-encode per run
        dry_run: if True, just print what would be done
    """
    candidates = []
    for bill, query, scoring in scored_bills:
        bill_id = bill.get("bill_id")
        if scoring["score"] < threshold:
            continue
        if bill_id in already_encoded_ids:
            continue
        # Skip bills already attempted (auto_encode_status is set)
        # We can't check DB here efficiently, so rely on the research table check above
        candidates.append((bill, query, scoring))

    candidates = candidates[:max_bills]

    if not candidates:
        print("Auto-encode: no candidates above threshold.")
        return

    print(f"Auto-encode: {len(candidates)} candidate(s) above threshold {threshold}")
    for bill, query, scoring in candidates:
        state = bill.get("state", "")
        bill_number = bill.get("bill_number", "")
        print(f"  [{state}-{bill_number}] score={scoring['score']} top={scoring['top_category']}")

        if dry_run:
            print(f"    [DRY RUN] Would run: claude -p '/encode-bill {state} {bill_number}'")
            continue

        # Update status to queued
        try:
            supabase.table("processed_bills").update(
                {"auto_encode_status": "queued"}
            ).eq("bill_id", int(bill.get("bill_id"))).execute()
        except Exception as e:
            print(f"    Warning: Could not update auto_encode_status: {e}")

        # Run encode-bill via Claude CLI
        try:
            result = subprocess.run(
                ["claude", "-p", f"/encode-bill {state} {bill_number}"],
                capture_output=True,
                text=True,
                timeout=600,
            )
            status = "success" if result.returncode == 0 else "failed"
            if result.returncode != 0:
                print(f"    encode-bill failed (rc={result.returncode}): {result.stderr[:200]}")
        except subprocess.TimeoutExpired:
            status = "failed"
            print(f"    encode-bill timed out")
        except Exception as e:
            status = "failed"
            print(f"    encode-bill error: {e}")

        # Update final status
        try:
            supabase.table("processed_bills").update(
                {"auto_encode_status": status}
            ).eq("bill_id", int(bill.get("bill_id"))).execute()
        except Exception as e:
            print(f"    Warning: Could not update auto_encode_status: {e}")

        print(f"    Result: {status}")


def main():
    parser = argparse.ArgumentParser(description="Monitor LegiScan for relevant bills")
    parser.add_argument("--states", help="Comma-separated list of state codes (e.g., NH,NY,CA)")
    parser.add_argument("--dry-run", action="store_true", help="Don't create issues, just show what would be created")
    parser.add_argument("--query", help="Run a single search query (uses search mode instead of dataset mode)")
    parser.add_argument("--auto-encode", action="store_true",
                        help="Auto-encode high-confidence bills (requires checkpoint handling — see docs)")
    parser.add_argument("--encode-threshold", type=int, default=75,
                        help="Minimum confidence score for auto-encode (default: 75)")
    parser.add_argument("--encode-max", type=int, default=3,
                        help="Maximum bills to auto-encode per run (default: 3)")
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

    # Score all relevant bills with LLM
    pe_params = get_pe_parameters() if new_bills else set()

    # Build per-state parameter context once
    state_contexts = {}
    for bill, _ in new_bills:
        st = bill.get("state", "XX")
        if st not in state_contexts:
            state_contexts[st] = get_state_parameter_context(st, pe_params)

    scored_new = []
    for bill, matched_query in new_bills:
        st = bill.get("state", "XX")
        scoring = score_bill_with_llm(bill, state_contexts[st])
        scored_new.append((bill, matched_query, scoring))

    # Sort: parametric first, then by score descending
    type_order = {"parametric": 0, "structural": 1, "unknown": 2}
    scored_new.sort(key=lambda x: (type_order.get(x[2].get("reform_type", "unknown"), 2), -x[2]["score"]))

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
    print(f"  New bills for digest: {len(scored_new)}")

    # Confidence tier summary
    high = sum(1 for _, _, s in scored_new if s["score"] >= 75)
    medium = sum(1 for _, _, s in scored_new if 40 <= s["score"] < 75)
    low = sum(1 for _, _, s in scored_new if s["score"] < 40)
    print(f"  Confidence: {high} high (>=75), {medium} medium (40-74), {low} low (<40)")

    # Reform type summary
    parametric = sum(1 for _, _, s in scored_new if s.get("reform_type") == "parametric")
    structural = sum(1 for _, _, s in scored_new if s.get("reform_type") == "structural")
    unknown_type = sum(1 for _, _, s in scored_new if s.get("reform_type") in ("unknown", None))
    print(f"  Reform type: {parametric} parametric, {structural} structural, {unknown_type} unknown")
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

    if not scored_new:
        print("No new bills to process.")
        return 0

    # Show bills that will be included (now with scores)
    print("Bills to include in digest:")
    for bill, matched_query, scoring in scored_new:
        state = bill.get("state", "US")
        bill_number = bill.get("bill_number", "")
        title = bill.get("title", "")[:50]
        year_start = bill.get("session", {}).get("year_start", "")
        legiscan_url = f"https://legiscan.com/{state}/bill/{bill_number}/{year_start}"
        categories = ", ".join(scoring["matched_categories"]) if scoring["matched_categories"] else "none"
        rtype = scoring.get("reform_type", "unknown")
        print(f"  [{state}-{bill_number}] score={scoring['score']} {rtype} ({categories}) {title}...")
        print(f"    {legiscan_url}")

    if args.dry_run:
        print()
        print(f"[DRY RUN] Would create 1 digest issue with {len(scored_new)} bills")

        if args.auto_encode:
            print()
            already_encoded = get_already_encoded_bill_ids(supabase)
            run_auto_encode(supabase, scored_new, already_encoded,
                            args.encode_threshold, args.encode_max, dry_run=True)
        return 0

    # Create single digest issue
    print()
    print("Creating digest issue...")
    issue_url = create_digest_issue(scored_new)

    if issue_url:
        print(f"Created: {issue_url}")

        # Save all bills to Supabase with scoring data
        for bill, matched_query, scoring in scored_new:
            save_processed_bill(supabase, bill, matched_query,
                                github_issue_url=issue_url, scoring_result=scoring)

        print(f"Saved {len(scored_new)} bills to Supabase")
    else:
        print("Failed to create digest issue")
        return 1

    # Auto-encode if requested
    if args.auto_encode:
        print()
        already_encoded = get_already_encoded_bill_ids(supabase)
        run_auto_encode(supabase, scored_new, already_encoded,
                        args.encode_threshold, args.encode_max, dry_run=False)

    print()
    print(f"Done! Created 1 digest issue with {len(scored_new)} bills.")
    return 0


if __name__ == "__main__":
    exit(main())
