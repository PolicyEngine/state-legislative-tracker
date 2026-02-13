# Triage Bills

Score unscored bills in Supabase and create a GitHub issue for human review.

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
encoded = supabase.table("research").select("legiscan_bill_id").not_.is_("legiscan_bill_id", "null").execute()
encoded_ids = {r["legiscan_bill_id"] for r in encoded.data}

# Get unscored, non-skipped bills
query = supabase.table("processed_bills") \
    .select("bill_id, state, bill_number, title, description, legiscan_url") \
    .eq("confidence_score", 0) \
    .is_("skipped_reason", "null")

# Add state filter if provided
# STATE_FILTER_PLACEHOLDER

result = query.order("state, bill_number").execute()

# Filter out already-encoded bills
bills = [b for b in result.data if b["bill_id"] not in encoded_ids]

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
   - **80-100**: Directly parametric — bill changes a value that maps to an existing PE parameter (e.g., income tax rate cut, EITC match percentage change, standard deduction increase)
   - **50-79**: Likely modelable but may need parameter additions or minor code changes (e.g., new credit with simple formula, threshold changes to existing programs)
   - **20-49**: Structural change — needs new code in policyengine-us (e.g., entirely new program, complex eligibility rules)
   - **0-19**: Not modelable in PolicyEngine (e.g., purely administrative, procedural, enforcement)

2. **`reform_type`**: `parametric` | `structural` | `unknown`

3. **`scoring_reasoning`**: One sentence explaining the score (e.g., "Reduces GA flat tax rate — maps directly to existing PE parameter").

Use your knowledge of PolicyEngine's parameter structure. For each bill, consider:
- Does the bill title/description mention a specific tax rate, credit, deduction, or exemption?
- Is there an existing PE parameter for this state that maps to it?
- Would encoding this bill require only a parameter value change, or new variables/formulas?

### Step 5: Present Proposals for Human Review

Display ALL proposed scores in a table for the user to review:

```
═══════════════════════════════════════════════════════════════════════════
PROPOSED SCORES — {N} bills (review before saving)
═══════════════════════════════════════════════════════════════════════════

| # | Bill       | Score | Type       | Reasoning                         | Link           |
|---|------------|-------|------------|-----------------------------------|----------------|
| 1 | GA HB1001  | 95    | parametric | Reduces flat income tax rate      | [LegiScan](…)  |
| 2 | GA SB387   | 90    | parametric | Repeals state income tax entirely | [LegiScan](…)  |
| 3 | GA SB448   | 5     | unknown    | Not a tax/benefit change          | [LegiScan](…)  |

Bills scoring < 20 will be marked as `not_modelable` (permanently skipped).

═══════════════════════════════════════════════════════════════════════════
```

Then use `AskUserQuestion` to get approval:
- "Do these scores look correct? You can adjust any scores or skip specific bills."
- Options: "Yes, save all" / "Adjust scores" / "Cancel"

If the user wants to adjust, apply their changes before writing.

### Step 6: Write Approved Scores to Supabase + Create GitHub Issue

**Only after user approval**, do two things:

#### 6a. Write scores to Supabase

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

#### 6b. Create GitHub Issue with scored results

Create a GitHub issue that serves as the **human review surface**. The issue should contain all the information needed to decide which bills to encode.

```bash
gh issue create \
  --repo PolicyEngine/state-legislative-tracker \
  --title "Bill Triage: {N} bills scored ({date})" \
  --label "bill-triage" \
  --body "$(cat <<'EOF'
## Bill Triage Results

Scored {N} bills for PolicyEngine modelability on {date}.

### Ready to Encode (score 80-100)

These bills map directly to existing PolicyEngine parameters:

| Bill | Score | Type | Description | Link |
|------|-------|------|-------------|------|
| GA HB1001 | 95 | parametric | Reduces flat income tax rate | [LegiScan](url) |

**To encode:** Run `/encode-bill GA HB1001` in Claude Code.

### May Need Parameter Additions (score 50-79)

| Bill | Score | Type | Description | Link |
|------|-------|------|-------------|------|
| GA SB474 | 65 | structural | Overtime tax exclusion | [LegiScan](url) |

### Needs Review (score 20-49)

| Bill | Score | Type | Description | Link |
|------|-------|------|-------------|------|

### Skipped as Not Modelable (score < 20)

| Bill | Score | Reason |
|------|-------|--------|
| GA SB448 | 5 | Senior facility power requirements |

---

*Generated by `/triage-bills`. Bills marked not_modelable are permanently filtered from future triage runs.*
EOF
)"
```

Adjust the table contents based on the actual scored bills. Include ALL bills in their appropriate tier. Each bill row should have the LegiScan URL as a clickable link.

### Step 7: Show Summary

After writing scores and creating the issue, display:

```
═══════════════════════════════════════════════════════════════════════════
TRIAGE COMPLETE: {N} bills scored
═══════════════════════════════════════════════════════════════════════════

GitHub Issue: {ISSUE_URL}

  {X} ready to encode (80-100)
  {Y} may need param additions (50-79)
  {Z} needs review (20-49)
  {W} skipped as not_modelable

Review the issue and run /encode-bill for bills you want to model.
═══════════════════════════════════════════════════════════════════════════
```

## Example Usage

```
/triage-bills           # Score all unscored bills
/triage-bills GA        # Score only Georgia bills
/triage-bills --limit 5 # Score up to 5 bills
```
