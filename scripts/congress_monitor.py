#!/usr/bin/env python3
"""
Federal bill monitor using the congress.gov API.

Ensures a curated seed list of federal tax/benefit bills exists in
processed_bills (state='US'), then refreshes status and last action for
every tracked federal bill. Unlike OpenStates, the congress.gov API has a
generous rate limit (5,000/hr), so all federal bills refresh every run.

Requires a free API key from https://api.congress.gov/sign-up/.

Usage:
    export CONGRESS_API_KEY=...
    export SUPABASE_URL=...
    export SUPABASE_KEY=...

    python scripts/congress_monitor.py
    python scripts/congress_monitor.py --dry-run
    python scripts/congress_monitor.py --seed-only    # only upsert seeds, no refresh
"""

import argparse
import hashlib
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from supabase import create_client

API_BASE = "https://api.congress.gov/v3"

# Reuses the state tracker's status vocabulary (see refresh_bill_status.py
# STAGE_LABELS) so badges, filters, and the Enacted card work unchanged.
# "Sent to President" is the federal analogue of "Sent to Governor".
STAGE_ORDER = {
    "Introduced": 1,
    "In Committee": 2,
    "Passed Committee": 3,
    "Passed One Chamber": 4,
    "Passed Both Chambers": 5,
    "Sent to President": 6,
    "Signed into Law": 7,
    "Vetoed": 8,
    "Dead/Withdrawn": -1,
}

BILL_TYPE_LABELS = {"hr": "HR", "s": "S", "hjres": "HJRes", "sjres": "SJRes"}
BILL_TYPE_URL_SEGMENTS = {
    "hr": "house-bill",
    "s": "senate-bill",
    "hjres": "house-joint-resolution",
    "sjres": "senate-joint-resolution",
}

# ============== Curated seed list ==============
#
# Hand-picked federal tax/benefit bills worth tracking (Phase 1 of federal
# support — see docs/GENERAL_BILL_TRACKER_ARCHITECTURE.md). Discovery
# automation comes later; for now curation IS the triage, so each entry
# carries its own confidence_score/reform_type and auto_triage skips them
# (it only scores rows with a null confidence_score).
#
# Fields: congress, bill_type (hr|s|hjres|sjres), number,
#         confidence_score (modelability 0-100), reform_type, description.
# Title, status, and dates come from the congress.gov API at runtime, so a
# wrong number here simply logs "not found" — it can't corrupt a row.
#
# Curated July 2026 from congress.gov. Modelability scores reflect
# PolicyEngine-US federal coverage (see auto_triage.py rubric): parametric =
# changes an existing parameter's value; structural = new variable/eligibility.
SEED_BILLS = [
    # --- Child Tax Credit / EITC ---
    {"congress": 119, "bill_type": "hr", "number": 1425, "confidence_score": 82, "reform_type": "parametric",
     "description": "Increase the child tax credit, make it fully refundable, and remove its income limitations."},
    {"congress": 119, "bill_type": "hr", "number": 353, "confidence_score": 62, "reform_type": "structural",
     "description": "Family First Act: raise the CTC to $4,200/child and fully refundable, with SALT, EITC, and head-of-household changes."},
    {"congress": 119, "bill_type": "hr", "number": 905, "confidence_score": 68, "reform_type": "structural",
     "description": "EITC Modernization Act: extend the earned income tax credit to taxpayers with dependents and to qualifying students."},
    {"congress": 119, "bill_type": "hr", "number": 2994, "confidence_score": 64, "reform_type": "structural",
     "description": "Child and Dependent Care Tax Credit Enhancement Act: enhance the CDCTC and make it fully refundable for certain taxpayers."},
    {"congress": 119, "bill_type": "s", "number": 1421, "confidence_score": 64, "reform_type": "structural",
     "description": "Child and Dependent Care Tax Credit Enhancement Act (Senate companion): enhance the CDCTC and make it fully refundable."},
    # --- Tips / overtime ---
    {"congress": 119, "bill_type": "hr", "number": 482, "confidence_score": 66, "reform_type": "structural",
     "description": "No Tax on Tips Act: deduction eliminating income tax on qualified tips for all individual taxpayers."},
    {"congress": 119, "bill_type": "hr", "number": 561, "confidence_score": 60, "reform_type": "structural",
     "description": "Overtime Pay Tax Relief Act: deduction for overtime compensation, capped at 20% of regular wages, through 2029."},
    {"congress": 119, "bill_type": "s", "number": 1046, "confidence_score": 60, "reform_type": "structural",
     "description": "No Tax on Overtime Act: exclude from gross income overtime compensation for hours over 40 per week."},
    {"congress": 119, "bill_type": "s", "number": 1606, "confidence_score": 58, "reform_type": "structural",
     "description": "Overtime Wages Tax Relief Act: establish a deduction for certain overtime payments."},
    # --- Social Security taxation / payroll ---
    {"congress": 119, "bill_type": "hr", "number": 904, "confidence_score": 72, "reform_type": "parametric",
     "description": "No Tax on Social Security: repeal the inclusion of Social Security benefits in gross income."},
    {"congress": 119, "bill_type": "s", "number": 770, "confidence_score": 56, "reform_type": "structural",
     "description": "Social Security Expansion Act: raise benefits and apply payroll taxes to earnings above $250,000."},
    {"congress": 119, "bill_type": "hr", "number": 3517, "confidence_score": 55, "reform_type": "structural",
     "description": "Social Security Enhancement and Protection Act: raise benefits, phase out the taxable maximum, and lift the payroll tax rate to 6.5%."},
]


def bill_source_id(congress, bill_type, number):
    """Canonical source id, e.g. 'us-congress-119-hr-1234'."""
    return f"us-congress-{congress}-{bill_type}-{number}"


def ordinal(n):
    """119 -> '119th', 121 -> '121st' (needed from the 121st Congress on)."""
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def generate_bill_id(source_id):
    """
    Stable integer PK from the source id (processed_bills.bill_id is INTEGER).

    Same construction as openstates_monitor._generate_bill_id but offset by
    20M so congress-sourced ids can never collide with OpenStates-sourced
    ones (10M offset) or legacy LegiScan ids.
    """
    digest = hashlib.md5(source_id.encode()).hexdigest()
    return 20_000_000 + int(digest[:8], 16) % 10_000_000


def congress_request(path, api_key, params=None):
    params = dict(params or {})
    params["api_key"] = api_key
    params["format"] = "json"
    for attempt in range(3):
        response = requests.get(f"{API_BASE}{path}", params=params, timeout=30)
        if response.status_code == 429 or response.status_code >= 500:
            wait = 5 * (attempt + 1)
            print(f"  congress.gov {response.status_code}, retrying in {wait}s...")
            time.sleep(wait)
            continue
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    response.raise_for_status()


def fetch_bill(api_key, congress, bill_type, number):
    """Fetch bill core data + full action list from congress.gov."""
    data = congress_request(f"/bill/{congress}/{bill_type}/{number}", api_key)
    if not data or "bill" not in data:
        return None
    bill = data["bill"]

    actions = []
    offset = 0
    while True:
        page = congress_request(
            f"/bill/{congress}/{bill_type}/{number}/actions",
            api_key,
            {"limit": 250, "offset": offset},
        )
        if not page or not page.get("actions"):
            break
        actions.extend(page["actions"])
        if len(page["actions"]) < 250:
            break
        offset += 250
    bill["_actions"] = actions
    return bill


# Regexes matched against action text, most advanced stage wins.
# Congress.gov action text is prose, not classified enums like OpenStates,
# so stage detection is keyword-based.
_ACTION_PATTERNS = [
    (re.compile(r"became public law|signed by president", re.I), "Signed into Law"),
    (re.compile(r"vetoed by president|pocket veto", re.I), "Vetoed"),
    (re.compile(r"presented to president", re.I), "Sent to President"),
    (re.compile(r"placed on .* calendar", re.I), "Passed Committee"),
    (re.compile(r"reported (by|to) the committee|ordered to be reported", re.I), "Passed Committee"),
    (re.compile(r"referred to (the )?(house |senate )?committee|referred to the subcommittee", re.I), "In Committee"),
    (re.compile(r"introduced in (house|senate)", re.I), "Introduced"),
]
_PASSAGE_RE = re.compile(r"passed(/agreed to)? in (the )?(house|senate)|on passage passed|passed (house|senate)", re.I)


def classify_stage(bill):
    """Map congress.gov actions to the tracker's status vocabulary."""
    if bill.get("laws"):
        return "Signed into Law"

    stage = "Introduced"
    chambers_passed = set()

    for action in bill.get("_actions", []):
        text = action.get("text", "")

        passage = _PASSAGE_RE.search(text)
        if passage:
            chamber_match = re.search(r"house|senate", text, re.I)
            if chamber_match:
                chambers_passed.add(chamber_match.group(0).lower())
            candidate = "Passed Both Chambers" if len(chambers_passed) >= 2 else "Passed One Chamber"
            if STAGE_ORDER.get(candidate, 0) > STAGE_ORDER.get(stage, 0):
                stage = candidate
            continue

        for pattern, candidate in _ACTION_PATTERNS:
            if pattern.search(text):
                if candidate == "Vetoed":
                    return "Vetoed"
                if STAGE_ORDER.get(candidate, 0) > STAGE_ORDER.get(stage, 0):
                    stage = candidate
                break

    return stage


def congress_gov_url(congress, bill_type, number):
    segment = BILL_TYPE_URL_SEGMENTS.get(bill_type, bill_type)
    return f"https://www.congress.gov/bill/{ordinal(congress)}-congress/{segment}/{number}"


def build_row(seed, bill):
    """Build a processed_bills row from a seed entry + congress.gov data."""
    congress, bill_type, number = seed["congress"], seed["bill_type"], seed["number"]
    latest = bill.get("latestAction") or {}
    url = congress_gov_url(congress, bill_type, number)
    title = bill.get("title", "") or seed.get("description", "")

    row = {
        "bill_id": generate_bill_id(bill_source_id(congress, bill_type, number)),
        "state": "US",
        "bill_number": f"{BILL_TYPE_LABELS.get(bill_type, bill_type.upper())} {number}",
        "title": title,
        "description": seed.get("description", ""),
        "status": classify_stage(bill),
        "status_date": latest.get("actionDate") or None,
        "last_action": latest.get("text", ""),
        "last_action_date": latest.get("actionDate") or None,
        "official_url": url,
        "session_name": f"{ordinal(congress)} Congress",
        "legiscan_url": url,  # legacy column reused as source URL, as openstates_monitor does
        "matched_query": "curated-federal-seed",
    }
    # Curation is the triage for seeds; only set on rows that carry it so a
    # refresh never nulls out a score auto_triage assigned.
    if "confidence_score" in seed:
        row["confidence_score"] = seed["confidence_score"]
    if "reform_type" in seed:
        row["reform_type"] = seed["reform_type"]
    return row


# ============== Discovery ==============
#
# Congress produces ~17k bills per session; almost all are irrelevant or die at
# introduction. Discovery scans recently-updated bills, keeps those whose title
# matches tax/benefit terms, and inserts new ones with confidence_score=0 so
# auto_triage.py scores them for modelability (curated seeds keep their own
# score and are skipped by triage). Title is the cheap prefilter (available on
# the list endpoint); the per-bill detail fetch only happens for matches.
DISCOVERY_CURRENT_CONGRESS = 119

# Loose by design: title is only a prefilter, auto_triage.py is the precision
# layer that scores modelability. Bare "taxpayer"/"wage" are omitted — they
# almost exclusively catch IRS-admin and labor bills triage would reject.
_TAX_BENEFIT_TITLE_RE = re.compile(
    r"\b("
    r"tax(es|ation)?|deduction|credit|EITC|earned income|refund|"
    r"child tax|CTC|dependent care|standard deduction|itemi[sz]|exemption|"
    r"bracket|marginal rate|capital gains|estate tax|payroll tax|"
    r"social security|SSI|supplemental security|SNAP|food stamp|"
    r"medicaid|medicare|premium tax credit|affordable care|ACA|CHIP|"
    r"TANF|welfare|WIC|housing (voucher|assistance)|section 8|"
    r"minimum wage|overtime|tips?|filing status|head of household|"
    r"saver'?s credit|adoption credit|education credit|student loan|"
    r"unemployment (insurance|compensation)|pension|retirement (saving|account)"
    r")\b",
    re.I,
)

BILL_TYPE_FROM_LIST = {"HR": "hr", "S": "s", "HJRES": "hjres", "SJRES": "sjres"}


def title_is_tax_benefit(title):
    return bool(title and _TAX_BENEFIT_TITLE_RE.search(title))


def discover_recent_bills(api_key, since_iso, max_scan):
    """
    Scan bills updated since `since_iso` (ISO8601), newest first, and return
    title-matching (congress, bill_type, number) tuples. Bounded by max_scan
    bills examined so a daily run stays cheap.
    """
    matches = []
    scanned = 0
    offset = 0
    while scanned < max_scan:
        page = congress_request(
            f"/bill/{DISCOVERY_CURRENT_CONGRESS}",
            api_key,
            {
                "sort": "updateDate desc",
                "fromDateTime": since_iso,
                "limit": 250,
                "offset": offset,
            },
        )
        bills = (page or {}).get("bills") or []
        if not bills:
            break
        for b in bills:
            scanned += 1
            bill_type = BILL_TYPE_FROM_LIST.get((b.get("type") or "").upper())
            number = b.get("number")
            if not bill_type or not number:
                continue
            if title_is_tax_benefit(b.get("title", "")):
                matches.append((DISCOVERY_CURRENT_CONGRESS, bill_type, int(number)))
        if len(bills) < 250:
            break
        offset += 250
    print(f"  scanned {scanned} recently-updated bills, {len(matches)} title matches")
    return matches


def build_discovered_row(congress, bill_type, number, bill):
    """Row for a discovered (untriaged) federal bill: confidence_score=0."""
    latest = bill.get("latestAction") or {}
    url = congress_gov_url(congress, bill_type, number)
    policy_area = (bill.get("policyArea") or {}).get("name", "")
    return {
        "bill_id": generate_bill_id(bill_source_id(congress, bill_type, number)),
        "state": "US",
        "bill_number": f"{BILL_TYPE_LABELS.get(bill_type, bill_type.upper())} {number}",
        "title": bill.get("title", ""),
        "description": f"Policy area: {policy_area}" if policy_area else "",
        "status": classify_stage(bill),
        "status_date": latest.get("actionDate") or None,
        "last_action": latest.get("text", ""),
        "last_action_date": latest.get("actionDate") or None,
        "official_url": url,
        "session_name": f"{ordinal(congress)} Congress",
        "legiscan_url": url,
        "matched_query": "congress-discovery",
        # 0 (not null) so auto_triage.fetch_unscored_bills picks it up.
        "confidence_score": 0,
    }


def parse_tracked_row(row):
    """
    Recover (congress, bill_type, number) from a processed_bills US row,
    using session_name ('119th Congress') + bill_number ('HR 1234').
    """
    session_match = re.match(r"(\d+)(?:st|nd|rd|th) Congress", row.get("session_name") or "")
    number_match = re.match(r"([A-Za-z.]+)\s*(\d+)", row.get("bill_number") or "")
    if not session_match or not number_match:
        return None
    type_label = number_match.group(1).replace(".", "").lower()
    if type_label not in BILL_TYPE_LABELS:
        return None
    return int(session_match.group(1)), type_label, int(number_match.group(2))


def main():
    parser = argparse.ArgumentParser(description="Seed and refresh federal bills from congress.gov")
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing")
    parser.add_argument("--seed-only", action="store_true", help="Only upsert seed bills, skip refreshing others")
    parser.add_argument("--discover", action="store_true",
                        help="Also scan recently-updated bills for new tax/benefit legislation")
    parser.add_argument("--since-days", type=int, default=7,
                        help="Discovery window: scan bills updated in the last N days (default 7)")
    parser.add_argument("--max-scan", type=int, default=1500,
                        help="Discovery cap: max bills to examine per run (default 1500)")
    args = parser.parse_args()

    api_key = os.environ.get("CONGRESS_API_KEY")
    if not api_key:
        # Exit 0 so the daily pipeline keeps working until the secret is added.
        print("CONGRESS_API_KEY not set — skipping federal bill refresh.")
        print("Get a free key at https://api.congress.gov/sign-up/ and add it as a repo secret.")
        return 0

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_KEY required")
        return 1

    supabase = create_client(supabase_url, supabase_key)

    # Union of curated seeds and whatever US rows already exist, keyed by
    # (congress, type, number) so re-running is idempotent.
    targets = {}
    for seed in SEED_BILLS:
        targets[(seed["congress"], seed["bill_type"], seed["number"])] = dict(seed)

    if not args.seed_only:
        existing = (
            supabase.table("processed_bills")
            .select("bill_id, bill_number, session_name, description, confidence_score, reform_type")
            .eq("state", "US")
            .execute()
        )
        for row in existing.data or []:
            parsed = parse_tracked_row(row)
            if not parsed:
                print(f"  Warning: cannot parse tracked federal bill {row.get('bill_number')!r}, skipping")
                continue
            congress, bill_type, number = parsed
            targets.setdefault(
                (congress, bill_type, number),
                {"congress": congress, "bill_type": bill_type, "number": number,
                 "description": row.get("description") or ""},
            )

    print("Federal Bill Monitor")
    print("====================")
    print(f"Bills to sync: {len(targets)} ({len(SEED_BILLS)} seeds)")
    print(f"Dry run: {args.dry_run}")
    print()

    updated = errors = 0
    for (congress, bill_type, number), seed in sorted(targets.items()):
        label = f"{BILL_TYPE_LABELS.get(bill_type, bill_type)} {number}"
        print(f"US {label} ({congress}th)...", end=" ", flush=True)
        try:
            bill = fetch_bill(api_key, congress, bill_type, number)
            if not bill:
                print("not found on congress.gov")
                errors += 1
                continue
            row = build_row(seed, bill)
            print(f"{row['status']} | {row['last_action'][:60]} ({row['last_action_date']})")
            if not args.dry_run:
                supabase.table("processed_bills").upsert(row).execute()
            updated += 1
        except Exception as e:
            print(f"error: {e}")
            errors += 1

    print()
    print(f"Done: {updated} synced, {errors} errors")

    if args.discover:
        discovered = discover_and_insert(supabase, api_key, args)
        print(f"Discovery: {discovered} new bill(s) queued for triage")

    return 1 if errors and not updated else 0


def discover_and_insert(supabase, api_key, args):
    """Scan recent bills, insert new tax/benefit ones with confidence_score=0.

    Dedup is by bill_id against everything already in processed_bills, so a
    discovered bill that already exists (seed, prior discovery, or triaged) is
    skipped outright — never re-inserted with a reset score.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=args.since_days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    print()
    print("Federal Bill Discovery")
    print("======================")
    print(f"Window: bills updated since {since} (max scan {args.max_scan})")

    existing = (
        supabase.table("processed_bills").select("bill_id").eq("state", "US").execute()
    )
    existing_ids = {r["bill_id"] for r in (existing.data or [])}

    candidates = discover_recent_bills(api_key, since, args.max_scan)
    new = [
        (c, t, n)
        for (c, t, n) in candidates
        if generate_bill_id(bill_source_id(c, t, n)) not in existing_ids
    ]
    print(f"  {len(new)} candidate(s) not already in processed_bills")

    inserted = 0
    for congress, bill_type, number in new:
        label = f"{BILL_TYPE_LABELS.get(bill_type, bill_type)} {number}"
        try:
            bill = fetch_bill(api_key, congress, bill_type, number)
            if not bill:
                continue
            row = build_discovered_row(congress, bill_type, number, bill)
            print(f"  + US {label}: {row['title'][:60]} [{row['status']}]")
            if not args.dry_run:
                supabase.table("processed_bills").upsert(row).execute()
            inserted += 1
        except Exception as e:
            print(f"  ! US {label}: {e}")
    return inserted


if __name__ == "__main__":
    sys.exit(main())
