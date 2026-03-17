# Triage Bills

Score unscored bills and create/update per-state GitHub issues for human review.

## Arguments
- `$ARGUMENTS` - Optional: state filter (e.g., "GA") or "--limit 20"

## Workflow

### Step 1: Parse Arguments

Parse `$ARGUMENTS` for:
- A two-letter state code (e.g., "GA", "NY") → filter bills to that state
- `--limit N` → cap the number of bills to score (default: all unscored)

### Step 2: Fetch Unscored Bills

```bash
export $(grep -v '^#' .env | xargs) && python3 << 'PYEOF'
import os, json
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# Get bills already in research table (already encoded)
# Match by both legiscan_bill_id (legacy) and research.id (works for all sources)
encoded = supabase.table("research").select("id, legiscan_bill_id").eq("type", "bill").execute()
encoded_legiscan_ids = {r["legiscan_bill_id"] for r in encoded.data if r.get("legiscan_bill_id")}
encoded_research_ids = {r["id"] for r in encoded.data}

# Get unscored, non-skipped bills
query = supabase.table("processed_bills") \
    .select("bill_id, state, bill_number, title, description, status, last_action, last_action_date, legiscan_url, matched_query") \
    .eq("confidence_score", 0) \
    .is_("skipped_reason", "null")

# Add state filter if provided
# STATE_FILTER_PLACEHOLDER

result = query.order("state, bill_number").execute()

# Filter out already-encoded bills (check both bill_id FK and research ID pattern)
def is_encoded(b):
    if b["bill_id"] in encoded_legiscan_ids:
        return True
    # Match by research ID convention: "{state}-{bill_number}" e.g. "ga-sb168"
    research_id = f"{b['state'].lower()}-{b['bill_number'].lower().replace(' ', '')}"
    return research_id in encoded_research_ids

bills = [b for b in result.data if not is_encoded(b)]

print(json.dumps(bills, indent=2))
print(f"\n--- {len(bills)} unscored bills ---")
PYEOF
```

Adjust the query to add `.eq("state", "XX")` if a state filter was provided.

If no unscored bills are found, report that and stop.

### Step 3: Fetch PE Parameter Index (Optional)

To improve scoring accuracy, fetch the PolicyEngine parameter index:

```bash
curl -s "https://api.policyengine.org/us/metadata" | python3 -c "
import sys, json
data = json.load(sys.stdin)
params = list(data.get('result', {}).get('parameters', {}).keys())
# Filter to state params for relevant states
for p in sorted(params):
    if p.startswith('gov.states.'):
        print(p)
" > /tmp/pe_state_params.txt
echo "$(wc -l < /tmp/pe_state_params.txt) state parameters loaded"
```

If this fails (timeout, API down), proceed using your built-in PolicyEngine knowledge. You know the common parameter patterns:
- `gov.states.{st}.tax.income.rate` (flat rate states)
- `gov.states.{st}.tax.income.main.{filing_status}.brackets[i].rate/threshold`
- `gov.states.{st}.tax.income.credits.earned_income.*`
- `gov.states.{st}.tax.income.credits.ctc.*`
- `gov.states.{st}.tax.income.deductions.standard.*`
- `gov.states.{st}.tax.income.exemptions.*`

### Step 4: Propose Scores (DO NOT write yet)

For each bill, **propose** 3 things but DO NOT write to Supabase yet:

1. **`score`** (0-100) using this rubric:
   - **80-100**: Directly parametric — bill changes an **existing** parameter value only (e.g., income tax rate cut, EITC match percentage change, standard deduction increase). The parameter must already exist with the same structure.
   - **50-79**: Likely modelable but needs parameter additions or minor code changes (e.g., new credit with simple formula, threshold changes to existing programs)
   - **20-49**: Structural change — needs new code in policyengine-us (e.g., entirely new program, complex eligibility rules)
   - **0-19**: Not modelable in PolicyEngine (e.g., purely administrative, procedural, enforcement)

   **Auto-skip (score 5, not_modelable)** — these bill types are out of scope regardless of modelability:
   - Occupation-specific deductions/credits (e.g., psychiatry income deduction, teacher supply credit)
   - Theft/casualty loss deductions
   - Premarital counseling or other behavior-specific credits
   - Niche credits: conservation contributions, long-term care insurance premiums
   - Disaster/event-specific exclusions (wildfire, landfill, named disasters)
   - Trust taxation (nongrantor trusts, etc.)
   - Purely administrative or reporting requirements

   **Key distinction — parametric vs structural:**
   - **Parametric (80-100)**: ONLY changing the *value* of parameters that already exist. Examples: changing a tax rate from 5% to 4%, changing a threshold from $10K to $15K, changing a credit percentage from 33% to 45%.
   - **Structural (50-79)**: Anything that changes the *structure* of the tax/benefit system, even if it involves parameters. Examples:
     - **Adding or removing tax brackets** (even though brackets are parameters, adding new ones requires new parameter entries)
     - **Creating new credits or programs** that don't exist yet
     - **Adding age-gated or status-gated variants** of existing provisions
     - **Restructuring bracket thresholds** in a way that changes the number of brackets
     - **Combining or splitting filing status treatments**

   When in doubt: if the bill says "new bracket", "additional bracket", "restructure", or implies the number of parameter entries changes, it is **structural** (50-79), not parametric.

2. **`reform_type`**: `parametric` | `structural` | `unknown`

3. **`scoring_reasoning`**: One sentence explaining the score (e.g., "Reduces GA flat tax rate — maps directly to existing PE parameter").

Use your knowledge of PolicyEngine's parameter structure. For each bill, consider:
- Does the bill title/description mention a specific tax rate, credit, deduction, or exemption?
- Is there an existing PE parameter for this state that maps to it?
- Would encoding this bill require only a parameter value change, or new variables/formulas?
- Does the bill **add or remove** brackets/tiers/categories, or just **change values** within the existing structure?

### Step 5: Present Proposals for Human Review

Display ALL proposed scores in a table for the user to review, **grouped by state**:

```
═══════════════════════════════════════════════════════════════════════════
PROPOSED SCORES — {N} bills (review before saving)
═══════════════════════════════════════════════════════════════════════════

### GA (5 bills)

| # | Bill       | Score | Type       | Reasoning                         | Link           |
|---|------------|-------|------------|-----------------------------------|----------------|
| 1 | GA HB1001  | 95    | parametric | Reduces flat income tax rate      | [View](…)  |
| 2 | GA SB387   | 90    | parametric | Repeals state income tax entirely | [View](…)  |
| 3 | GA SB448   | 5     | unknown    | Not a tax/benefit change          | [View](…)  |

Bills scoring < 20 will be marked as `not_modelable` (permanently skipped).

═══════════════════════════════════════════════════════════════════════════
```

Then use `AskUserQuestion` to get approval:
- "Do these scores look correct? You can adjust any scores or skip specific bills."
- Options: "Yes, save all" / "Adjust scores" / "Cancel"

If the user wants to adjust, apply their changes before writing.

### Step 6: Write Approved Scores to Supabase

**Only after user approval**, write scores to Supabase:

```bash
export $(grep -v '^#' .env | xargs) && python3 << 'PYEOF'
import os
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# For bills scoring >= 20: update scoring fields
supabase.table("processed_bills").update({
    "confidence_score": SCORE,
    "reform_type": "REFORM_TYPE",
    "scoring_reasoning": "REASONING",
}).eq("bill_id", BILL_ID).execute()

# For bills scoring < 20: mark as not modelable (permanently filtered out)
supabase.table("processed_bills").update({
    "confidence_score": SCORE,
    "reform_type": "REFORM_TYPE",
    "scoring_reasoning": "REASONING",
    "skipped_reason": "not_modelable",
}).eq("bill_id", BILL_ID).execute()
PYEOF
```

Score threshold:
- **score >= 20**: keep in the pipeline
- **score < 20**: set `skipped_reason = 'not_modelable'` (permanently filtered out)

### Step 7: Create or Update Per-State GitHub Issues

For **each state** that has scored bills, find or create a GitHub issue titled `[{STATE}] Bill Triage`. This is a **living document** that gets updated each time `/triage-bills` runs.

#### 7a. Check for existing state issue

```bash
gh issue list --repo PolicyEngine/state-legislative-tracker --label "bill-triage" --search "[GA] Bill Triage" --state open --json number,title
```

#### 7b. Build issue body

The issue body should contain ALL scored bills for that state (not just newly scored — fetch all scored, non-skipped bills for the state from Supabase). This ensures the issue is always a complete picture.

```bash
export $(grep -v '^#' .env | xargs) && python3 << 'PYEOF'
import os, json
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# Get ALL scored, non-skipped bills for this state
result = supabase.table("processed_bills") \
    .select("bill_id, state, bill_number, title, status, last_action, last_action_date, legiscan_url, matched_query, confidence_score, reform_type, scoring_reasoning") \
    .eq("state", "GA") \
    .gt("confidence_score", 0) \
    .is_("skipped_reason", "null") \
    .order("confidence_score", desc=True) \
    .execute()

# Get encoded bills (already in research table) to mark checkboxes
encoded = supabase.table("research") \
    .select("id, status, legiscan_bill_id") \
    .eq("state", "GA") \
    .eq("type", "bill") \
    .execute()
encoded_by_legiscan_id = {r["legiscan_bill_id"]: r for r in encoded.data if r.get("legiscan_bill_id")}
encoded_by_id = {r["id"]: r for r in encoded.data}

# Attach encoded status to each bill
for bill in result.data:
    research = encoded_by_legiscan_id.get(bill["bill_id"]) or encoded_by_id.get(f"{bill['state'].lower()}-{bill['bill_number'].lower().replace(' ', '')}")
    bill["encoded"] = research is not None
    bill["encode_status"] = research["status"] if research else None

print(json.dumps(result.data, indent=2))
PYEOF
```

Format the issue body like this:

```markdown
## GA Bill Triage

Tracked bills for Georgia, scored for PolicyEngine modelability.
Last updated: {date}

### Encoding progress
- [x] HB1001 — Reduce rate of income tax (`/encode-bill GA HB1001`)
- [ ] SB476 — Income Tax Reduction Act of 2026 (`/encode-bill GA SB476`)
- [ ] SB474 — Exclude overtime from taxation

### Ready to Encode (score 80-100)

| Bill | Score | Type | Title | Last Action | Link | Encode |
|------|-------|------|-------|-------------|------|--------|
| HB1001 | 95 | parametric | Reduce rate of income tax | Introduced 2026-02-10 | [View](url) | `/encode-bill GA HB1001` |
| SB476 | 95 | parametric | Income Tax Reduction Act of 2026 | Introduced 2026-02-11 | [View](url) | `/encode-bill GA SB476` |

### May Need Work (score 50-79)

| Bill | Score | Type | Title | Last Action | Link |
|------|-------|------|-------|-------------|------|
| SB474 | 65 | structural | Exclude overtime from taxation | Introduced 2026-02-11 | [View](url) |

### Needs Review (score 20-49)

| Bill | Score | Type | Title | Last Action | Link |
|------|-------|------|-------|-------------|------|

---
*Auto-generated by `/triage-bills`. Run `/encode-bill GA {BILL}` to compute impacts.*
*Last updated: {date}*
```

The "Encoding progress" checklist at the top lists all scored bills with interactive checkboxes. Bills in the `research` table are pre-checked (`- [x]`); others are unchecked (`- [ ]`). Anyone can click the checkboxes directly on the GitHub issue to track progress. The detailed tables below remain as reference.

Key formatting rules:
- Sort by score descending within each tier
- Include last action + date (helps prioritize active vs stalled bills)
- Include the `/encode-bill` command for high-confidence bills (copy-pasteable)
- Include the bill URL as a clickable link
- Include title (truncated to 80 chars if needed)

#### 7c. Create or update the issue

If no existing issue found for this state:
```bash
gh issue create \
  --repo PolicyEngine/state-legislative-tracker \
  --title "[GA] Bill Triage" \
  --label "bill-triage" \
  --body "{BODY}"
```

If an existing issue exists, update it:
```bash
gh issue edit {ISSUE_NUMBER} \
  --repo PolicyEngine/state-legislative-tracker \
  --body "{BODY}"
```

**IMPORTANT**: Always use a HEREDOC for the body to handle special characters:
```bash
gh issue create --repo PolicyEngine/state-legislative-tracker --title "[GA] Bill Triage" --label "bill-triage" --body "$(cat <<'EOF'
{BODY_CONTENT}
EOF
)"
```

### Step 8: Show Summary

```
═══════════════════════════════════════════════════════════════════════════
TRIAGE COMPLETE: {N} bills scored across {S} states
═══════════════════════════════════════════════════════════════════════════

GitHub Issues:
  [GA] Bill Triage: {URL}  (X high, Y medium, Z low)
  [NY] Bill Triage: {URL}  (X high, Y medium, Z low)

  {W} bills skipped as not_modelable

Run /encode-bill for bills you want to model.
═══════════════════════════════════════════════════════════════════════════
```

## Example Usage

```
/triage-bills           # Score all unscored bills, update all state issues
/triage-bills GA        # Score only Georgia bills, update GA issue
/triage-bills --limit 5 # Score up to 5 bills
```
