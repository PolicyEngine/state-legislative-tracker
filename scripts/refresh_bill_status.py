#!/usr/bin/env python3
"""
Refresh Bill Status from OpenStates API

Updates legislative stage, last action, and status for tracked bills
in the processed_bills table.

Usage:
    export $(grep -v '^#' .env | xargs)

    # Refresh all scored, non-skipped bills (highest score first)
    python scripts/refresh_bill_status.py

    # Refresh specific state
    python scripts/refresh_bill_status.py --state NY

    # Limit number of API calls (respect 250/day limit)
    python scripts/refresh_bill_status.py --limit 50

    # Dry run — show what would be updated
    python scripts/refresh_bill_status.py --dry-run

    # Include all bills (not just scored ones)
    python scripts/refresh_bill_status.py --all
"""

import os
import sys
import json
import argparse
import time
import re
import difflib
import requests
from datetime import datetime

# ============== Configuration ==============

OPENSTATES_API_KEY = os.environ.get("OPENSTATES_API_KEY")
OPENSTATES_BASE_URL = "https://v3.openstates.org"
RECENT_CREATED_SINCE = f"{datetime.utcnow().year - 1}-01-01"

STOPWORDS = {
    "act", "bill", "state", "tax", "income", "credit", "credits", "reduction",
    "increase", "expanded", "expansion", "child", "marriage", "penalty",
    "elimination", "supplemental", "empire",
}

# Legislative stage classification based on action classifications
# Order matters — later stages override earlier ones
STAGE_CLASSIFICATIONS = {
    "introduction": "introduced",
    "filing": "introduced",
    "referral-committee": "in_committee",
    "committee-passage": "passed_committee",
    "reading-1": "first_reading",
    "reading-2": "second_reading",
    "reading-3": "third_reading",
    "passage": "passed_chamber",
    "executive-receipt": "sent_to_governor",
    "executive-signature": "signed",
    "became-law": "signed",
    "executive-veto": "vetoed",
    "executive-veto-line-item": "vetoed",
    "failure": "dead",
    "withdrawal": "dead",
}

# Numeric ordering for stages (higher = further along)
STAGE_ORDER = {
    "prefiled": 0,
    "introduced": 1,
    "in_committee": 2,
    "passed_committee": 3,
    "first_reading": 4,
    "second_reading": 5,
    "third_reading": 6,
    "passed_chamber": 7,
    "passed_both": 8,
    "sent_to_governor": 9,
    "signed": 10,
    "vetoed": 11,
    "dead": -1,
}

# Stage display labels
STAGE_LABELS = {
    "prefiled": "Pre-filed",
    "introduced": "Introduced",
    "in_committee": "In Committee",
    "passed_committee": "Passed Committee",
    "first_reading": "First Reading",
    "second_reading": "Second Reading",
    "third_reading": "Third Reading",
    "passed_chamber": "Passed One Chamber",
    "passed_both": "Passed Both Chambers",
    "sent_to_governor": "Sent to Governor",
    "signed": "Signed into Law",
    "vetoed": "Vetoed",
    "dead": "Dead/Withdrawn",
}

BILL_NUMBER_RE = re.compile(r"\b(?!FY)([A-Z]{1,3}\.?\s*\d+(?:\s*S\d+)?)\b", re.I)


class RateLimitExhaustedError(RuntimeError):
    """Raised when OpenStates continues returning 429 after retries."""


def normalize_bill_number(value):
    """Normalize bill numbers across spacing and leading-zero variants."""
    if not value:
        return None

    value = re.sub(r"\s+", "", value).replace(".", "").upper()
    return re.sub(r"([A-Z]+)0+(\d)", r"\1\2", value)


def normalize_text(value):
    """Lowercase and strip punctuation for fuzzy title comparisons."""
    return re.sub(r"[^a-z0-9 ]+", " ", (value or "").lower())


def token_set(value):
    """Tokenize bill titles while dropping generic legislative filler."""
    tokens = set()
    for token in normalize_text(value).split():
        if len(token) <= 2 or token in STOPWORDS or token.isdigit():
            continue
        tokens.add(token)
    return tokens


def title_similarity_score(left, right):
    """Return sequence and token-overlap similarity for two bill titles."""
    left_norm = normalize_text(left)
    right_norm = normalize_text(right)
    ratio = difflib.SequenceMatcher(None, left_norm, right_norm).ratio()
    left_tokens = token_set(left)
    right_tokens = token_set(right)
    overlap = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    return ratio, overlap


def normalize_action_date(value):
    """Collapse ISO timestamps to YYYY-MM-DD for stable comparison/storage."""
    if not value:
        return None
    return str(value)[:10]


def openstates_request(endpoint, params=None, max_retries=3):
    """Make a request to the OpenStates API v3 with retry on rate limit."""
    if not OPENSTATES_API_KEY:
        raise ValueError("OPENSTATES_API_KEY environment variable not set")

    headers = {"X-API-KEY": OPENSTATES_API_KEY}
    url = f"{OPENSTATES_BASE_URL}{endpoint}"

    for attempt in range(max_retries):
        response = requests.get(url, headers=headers, params=params or {})

        if response.status_code == 429:
            wait = 15 * (attempt + 1)
            print(f"  Rate limited, waiting {wait}s...")
            time.sleep(wait)
            continue

        if response.status_code in {500, 502, 503, 504}:
            wait = 5 * (attempt + 1)
            print(f"  OpenStates {response.status_code}, retrying in {wait}s...")
            time.sleep(wait)
            continue

        if response.status_code == 404:
            return None

        response.raise_for_status()
        return response.json()

    response = requests.get(url, headers=headers, params=params or {})
    if response.status_code == 429:
        raise RateLimitExhaustedError(
            f"OpenStates rate limit exhausted after {max_retries} retries"
        )
    if response.status_code in {500, 502, 503, 504}:
        raise requests.HTTPError(
            f"OpenStates transient error persisted ({response.status_code})",
            response=response,
        )
    response.raise_for_status()
    return response.json()


def classify_stage(actions):
    """
    Determine legislative stage from a list of actions.

    Tracks both chambers — if a bill passes in both, it's "passed_both".
    """
    stage = "introduced"
    chambers_passed = set()

    for action in actions:
        classifications = action.get("classification", [])
        org = action.get("organization", {})
        chamber = org.get("classification", "")  # "upper" or "lower"

        for cls in classifications:
            mapped = STAGE_CLASSIFICATIONS.get(cls)
            if not mapped:
                continue

            if mapped == "passed_chamber":
                chambers_passed.add(chamber)
                if len(chambers_passed) >= 2:
                    stage = "passed_both"
                elif STAGE_ORDER.get(mapped, 0) > STAGE_ORDER.get(stage, 0):
                    stage = mapped
            elif mapped == "dead":
                stage = "dead"
            elif STAGE_ORDER.get(mapped, 0) > STAGE_ORDER.get(stage, 0):
                stage = mapped

    return stage


def search_bill_on_openstates(state_name, bill_number, title=""):
    """
    Search for a bill by state + identifier on OpenStates.
    Returns the bill detail with actions, or None.
    """
    clean_num = bill_number.strip()
    target_norm = normalize_bill_number(clean_num)

    params = {
        "jurisdiction": state_name,
        "q": clean_num,
        "per_page": 8,
        "include": "actions",
        "sort": "updated_desc",
        "created_since": RECENT_CREATED_SINCE,
    }

    data = openstates_request("/bills", params)
    if not data or not data.get("results"):
        return None

    candidates = []
    for result in data["results"]:
        result_norm = normalize_bill_number(result.get("identifier", ""))
        if target_norm and result_norm != target_norm:
            continue

        ratio, overlap = title_similarity_score(title, result.get("title", ""))
        latest_date = normalize_action_date(result.get("latest_action_date"))
        recency_bonus = 20 if latest_date and latest_date >= RECENT_CREATED_SINCE else 0
        score = ratio * 100 + overlap * 100 + recency_bonus
        candidates.append((score, ratio, overlap, result))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    _, ratio, overlap, result = candidates[0]

    # Reject low-confidence title mismatches to avoid wrong-session collisions.
    if title and ratio < 0.22 and overlap == 0:
        return None

    return result


def get_bill_detail(openstates_id):
    """Fetch full bill detail with actions."""
    return openstates_request(f"/bills/{openstates_id}", {"include": "actions"})


# State abbreviation -> name mapping
ABBR_TO_STATE = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


def main():
    parser = argparse.ArgumentParser(description="Refresh bill status from OpenStates")
    parser.add_argument("--state", help="Filter to specific state (e.g., NY)")
    parser.add_argument("--limit", type=int, default=100, help="Max bills to refresh (default: 100)")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing")
    parser.add_argument("--all", action="store_true", help="Include all bills, not just scored ones")
    parser.add_argument("--offset", type=int, default=0, help="Skip first N bills (resume from where you left off)")
    args = parser.parse_args()

    if not OPENSTATES_API_KEY:
        print("Error: OPENSTATES_API_KEY environment variable not set")
        return 1

    try:
        from supabase import create_client
    except ImportError:
        print("Error: supabase package not installed")
        return 1

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_KEY required")
        return 1

    supabase = create_client(url, key)

    # Fetch bills to refresh
    query = supabase.table("processed_bills") \
        .select("id, bill_id, state, bill_number, title, status, last_action, last_action_date, confidence_score, legiscan_url")

    if not args.all:
        query = query.gt("confidence_score", 0)

    query = query.is_("skipped_reason", "null")

    if args.state:
        query = query.eq("state", args.state)

    query = query.order("confidence_score", desc=True)

    result = query.execute()
    bills = result.data[args.offset:args.offset + args.limit]

    print(f"Bill Status Refresh")
    print(f"===================")
    print(f"Bills to refresh: {len(bills)} (of {len(result.data)} total, offset {args.offset})")
    if args.state:
        print(f"State filter: {args.state}")
    print(f"Dry run: {args.dry_run}")
    print()

    updated = 0
    skipped = 0
    errors = 0

    interrupted_by_rate_limit = False
    resume_offset = None

    for i, bill in enumerate(bills):
        state = bill["state"]
        bn = bill["bill_number"]
        state_name = ABBR_TO_STATE.get(state, state)

        print(f"[{i+1}/{len(bills)}] {state} {bn}...", end=" ", flush=True)

        try:
            # Search for the bill on OpenStates by state + bill number
            detail = search_bill_on_openstates(state_name, bn, bill.get("title", ""))

            if not detail:
                print("not found on OpenStates")
                skipped += 1
                continue

            # Extract actions and classify stage
            actions = detail.get("actions", [])
            stage = classify_stage(actions) if actions else "introduced"

            # Get latest action info
            latest_action = detail.get("latest_action_description", "")
            latest_action_date = normalize_action_date(detail.get("latest_action_date", "") or None)

            # Determine if anything changed
            old_action = bill.get("last_action", "")
            old_date = normalize_action_date(bill.get("last_action_date", ""))

            stage_label = STAGE_LABELS.get(stage, stage)

            if (
                latest_action == old_action
                and latest_action_date == old_date
                and stage_label == (bill.get("status") or "")
            ):
                print(f"{stage_label} (no change)")
                skipped += 1
            else:
                print(f"{stage_label} | {latest_action[:50]} ({latest_action_date})")

                if not args.dry_run:
                    update_data = {
                        "last_action": latest_action,
                        "last_action_date": latest_action_date,
                        "status": stage_label,
                    }

                    supabase.table("processed_bills") \
                        .update(update_data) \
                        .eq("id", bill["id"]) \
                        .execute()

                updated += 1

        except RateLimitExhaustedError as e:
            print(f"STOPPING: {e}")
            interrupted_by_rate_limit = True
            resume_offset = args.offset + i
            break
        except Exception as e:
            print(f"ERROR: {e}")
            errors += 1

        # Rate limiting: 10 req/min on free tier
        if i < len(bills) - 1:
            time.sleep(7)

    print()
    print(f"Done!")
    print(f"  Updated: {updated}")
    print(f"  No change: {skipped}")
    print(f"  Errors: {errors}")
    if interrupted_by_rate_limit:
        print(f"  Resume with: --offset {resume_offset}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
