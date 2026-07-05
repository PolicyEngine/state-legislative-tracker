#!/usr/bin/env python3
"""
Auto-triage unscored bills using Claude API.

Scores bills on modelability (0-100) based on PolicyEngine parameter structure,
then updates per-state GitHub issues with the current triage state.

Usage:
    export ANTHROPIC_API_KEY=...
    export SUPABASE_URL=...
    export SUPABASE_KEY=...
    export GITHUB_TOKEN=...

    python scripts/auto_triage.py
    python scripts/auto_triage.py --limit 10
    python scripts/auto_triage.py --dry-run
"""

import os
import sys
import json
import argparse
import subprocess
from datetime import datetime
from anthropic import Anthropic
from supabase import create_client

SCORING_PROMPT = """You are scoring state legislative bills for PolicyEngine modelability.

PolicyEngine is a microsimulation model of tax/benefit policy. Bills that change
existing parameters are easy to model (parametric). Bills that need new variables,
formulas, or programs are harder (structural).

Score each bill 0-100:

- **80-100 parametric**: Changes only the VALUE of an existing PE parameter
  (tax rate, credit percentage, threshold, standard deduction amount, EITC match).
  The parameter structure must already exist.
- **50-79 structural**: Adds/removes brackets, creates new credits, or restructures
  existing programs. Requires new parameter entries or formulas.
- **20-49 structural**: Entirely new program or complex eligibility rules needing
  significant new code.
- **0-19 not_modelable**: Purely administrative, procedural, enforcement, or
  out-of-scope (occupation-specific, theft/casualty, premarital counseling,
  niche credits like conservation/long-term-care, disaster-specific, trust taxation).

Key distinctions:
- "Adding a new bracket" = structural (50-79), even though brackets are parameters
- "Reducing the top rate from 5% to 4%" = parametric (80-100)
- "New child tax credit" = structural (50-79)
- "Exempt overtime/tips" = structural (50-79), needs new exclusion variable

Return ONLY valid JSON (no markdown, no prose):
{"score": <int>, "reform_type": "parametric|structural|unknown", "reasoning": "<one sentence>"}"""


def score_bill(client, bill):
    """Score a single bill using Claude."""
    user_msg = f"""Bill: {bill['state']} {bill['bill_number']}
Title: {bill['title']}
Description: {bill.get('description', '') or bill['title']}

Score this bill."""

    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=300,
        system=SCORING_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    text = response.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def fetch_unscored_bills(supabase, limit=None):
    """Fetch bills that need scoring."""
    # Already-encoded bills
    encoded = supabase.table("research").select("id, legiscan_bill_id").eq("type", "bill").execute()
    encoded_ids = {r["legiscan_bill_id"] for r in encoded.data if r.get("legiscan_bill_id")}
    encoded_rids = {r["id"] for r in encoded.data}

    query = supabase.table("processed_bills") \
        .select("bill_id, state, bill_number, title, description, status, last_action, last_action_date, legiscan_url, matched_query") \
        .eq("confidence_score", 0) \
        .is_("skipped_reason", "null") \
        .order("state, bill_number")

    result = query.execute()

    def is_encoded(b):
        if b["bill_id"] in encoded_ids:
            return True
        rid = f"{b['state'].lower()}-{b['bill_number'].lower().replace(' ', '')}"
        return rid in encoded_rids

    bills = [b for b in result.data if not is_encoded(b)]
    if limit:
        bills = bills[:limit]
    return bills


def save_score(supabase, bill_id, score, reform_type, reasoning):
    """Save score to Supabase."""
    update = {
        "confidence_score": score,
        "reform_type": reform_type,
        "scoring_reasoning": reasoning,
    }
    if score < 20:
        update["skipped_reason"] = "not_modelable"
    supabase.table("processed_bills").update(update).eq("bill_id", bill_id).execute()


def build_issue_body(supabase, state):
    """Build the full triage issue body for a state."""
    result = supabase.table("processed_bills") \
        .select("bill_id, state, bill_number, title, status, last_action, last_action_date, legiscan_url, confidence_score, reform_type, scoring_reasoning") \
        .eq("state", state) \
        .gt("confidence_score", 0) \
        .is_("skipped_reason", "null") \
        .order("confidence_score", desc=True) \
        .execute()

    encoded = supabase.table("research") \
        .select("id, status, legiscan_bill_id") \
        .eq("state", state) \
        .eq("type", "bill") \
        .execute()
    encoded_ids = {r["legiscan_bill_id"] for r in encoded.data if r.get("legiscan_bill_id")}
    encoded_rids = {r["id"] for r in encoded.data}

    bills = result.data
    today = datetime.now().strftime("%Y-%m-%d")

    checklist_lines = []
    for b in bills:
        rid = f"{b['state'].lower()}-{b['bill_number'].lower().replace(' ', '')}"
        is_enc = b["bill_id"] in encoded_ids or rid in encoded_rids
        check = "x" if is_enc else " "
        title_short = b["title"][:60]
        checklist_lines.append(f"- [{check}] {b['bill_number']} — {title_short} (`/encode-bill {state} {b['bill_number']}`)")

    high = [b for b in bills if b["confidence_score"] >= 80]
    med = [b for b in bills if 50 <= b["confidence_score"] < 80]
    low = [b for b in bills if 20 <= b["confidence_score"] < 50]

    def row(b):
        title_short = b["title"][:80]
        action = f"{(b.get('last_action') or '')[:40]} {b.get('last_action_date') or ''}"
        return f"| {b['bill_number']} | {b['confidence_score']} | {b['reform_type'] or '?'} | {title_short} | {action.strip()} | [View]({b['legiscan_url']}) |"

    body = f"""## {state} Bill Triage

Tracked bills for {state}, scored for PolicyEngine modelability.
Last updated: {today}

### Encoding progress
{chr(10).join(checklist_lines) if checklist_lines else '_No scored bills yet._'}

### Ready to Encode (score 80-100)

| Bill | Score | Type | Title | Last Action | Link |
|------|-------|------|-------|-------------|------|
{chr(10).join(row(b) for b in high) if high else '_None_'}

### May Need Work (score 50-79)

| Bill | Score | Type | Title | Last Action | Link |
|------|-------|------|-------|-------------|------|
{chr(10).join(row(b) for b in med) if med else '_None_'}

### Needs Review (score 20-49)

| Bill | Score | Type | Title | Last Action | Link |
|------|-------|------|-------|-------------|------|
{chr(10).join(row(b) for b in low) if low else '_None_'}

---
*Auto-generated by `auto_triage.py`. Run `/encode-bill {state} {{BILL}}` to compute impacts.*
*Last updated: {today}*
"""
    return body, len(high), len(med), len(low)


def upsert_issue(repo, state, body):
    """Create or update the per-state triage issue."""
    title = f"[{state}] Bill Triage"

    # Find existing issue
    result = subprocess.run(
        ["gh", "issue", "list", "--repo", repo, "--label", "bill-triage",
         "--search", title, "--state", "open", "--json", "number,title", "--limit", "5"],
        capture_output=True, text=True, check=True,
    )
    issues = json.loads(result.stdout)
    match = next((i for i in issues if i["title"] == title), None)

    if match:
        subprocess.run(
            ["gh", "issue", "edit", str(match["number"]), "--repo", repo, "--body-file", "-"],
            input=body, text=True, check=True,
        )
        return match["number"], "updated"
    else:
        result = subprocess.run(
            ["gh", "issue", "create", "--repo", repo, "--title", title,
             "--label", "bill-triage", "--body-file", "-"],
            input=body, text=True, capture_output=True, check=True,
        )
        url = result.stdout.strip()
        num = int(url.rstrip("/").split("/")[-1])
        return num, "created"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="Max bills to score")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--repo", default="PolicyEngine/state-legislative-tracker")
    parser.add_argument("--skip-issues", action="store_true", help="Only score, skip GitHub issue updates")
    args = parser.parse_args()

    for var in ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"]:
        if not os.environ.get(var):
            print(f"Error: {var} not set")
            return 1

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    bills = fetch_unscored_bills(supabase, limit=args.limit)
    print(f"Found {len(bills)} unscored bills")

    if not bills:
        print("Nothing to triage.")
        return 0

    affected_states = set()
    scored = 0
    errors = 0

    for i, bill in enumerate(bills):
        print(f"[{i+1}/{len(bills)}] {bill['state']} {bill['bill_number']}...", end=" ", flush=True)
        try:
            result = score_bill(client, bill)
            score = int(result["score"])
            reform_type = result["reform_type"]
            reasoning = result["reasoning"][:500]

            print(f"{score} ({reform_type})")

            if not args.dry_run:
                save_score(supabase, bill["bill_id"], score, reform_type, reasoning)
                affected_states.add(bill["state"])

            scored += 1
        except Exception as e:
            print(f"ERROR: {e}")
            errors += 1

    print(f"\nScored: {scored}, Errors: {errors}")

    if args.dry_run or args.skip_issues or not affected_states:
        return 0

    print(f"\nUpdating GitHub issues for {len(affected_states)} states...")
    for state in sorted(affected_states):
        try:
            body, high, med, low = build_issue_body(supabase, state)
            num, action = upsert_issue(args.repo, state, body)
            print(f"  [{state}] {action} #{num} (high: {high}, med: {med}, low: {low})")
        except Exception as e:
            print(f"  [{state}] ERROR: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
