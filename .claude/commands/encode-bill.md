# Encode Bill

Analyze a legislative bill, compute PolicyEngine impacts, and write results to Supabase.

This is the database-integrated version of `/score-bill`. Results are stored in Supabase and synced to the app.

## Arguments
- `$ARGUMENTS` - State and bill number (e.g., "UT SB60", "SC H3492")

## Phase 0: Check Database First

**BEFORE doing any research**, check if this bill already exists in the database:

```bash
source .env && python3 << EOF
from supabase import create_client
import os
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
result = supabase.table("research").select("*").eq("id", "{state}-{bill}".lower()).execute()
if result.data:
    item = result.data[0]
    print(f"FOUND IN DATABASE: {item['id']}")
    print(f"  Status: {item['status']}")
    print(f"  Key findings: {item['key_findings']}")
else:
    print("NOT FOUND - proceed with research")
EOF
```

**If status is `not_modelable`**: Stop and show the cached findings. Don't re-research.

```
═══════════════════════════════════════════════════════════════════════════
BILL ALREADY ANALYZED: {id}
═══════════════════════════════════════════════════════════════════════════

Status: not_modelable

Reason: {key_findings from database}

This bill was previously researched and determined to require structural
changes to PolicyEngine-US before it can be modeled.

No further action needed unless PE-US has been updated.
═══════════════════════════════════════════════════════════════════════════
```

**If found with `computed: true`**: Show existing results, ask if re-computation needed.

**If not found**: Proceed with Phase 1 (research).

## Workflow Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          /encode-bill UT SB60                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  PHASE 1: PARALLEL RESEARCH   │
                    │  (Task agents)                │
                    └───────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          │                                                   │
          ▼                                                   ▼
┌───────────────────┐                             ┌───────────────────┐
│  bill-researcher  │                             │  fiscal-finder    │
└─────────┬─────────┘                             └─────────┬─────────┘
          └─────────────────────┬───────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 2: PARAMETER MAPPING   │
                    │  (param-mapper agent)         │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 3: MODEL DESCRIPTION   │
                    │  (model-describer agent)      │
                    │                               │
                    │  Generates:                   │
                    │  • provisions[] array         │
                    │  • model_notes string         │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │   CHECKPOINT #1: REVIEW       │
                    │   Mapping + Description       │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 4: WRITE TO DATABASE   │
                    │  (research + reform_impacts   │
                    │   with provisions)            │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 5: RUN SCRIPT          │
                    │                               │
                    │  python compute_impacts.py    │
                    │    --reform-id {id}           │
                    │                               │
                    │  Script handles:              │
                    │  • Local microsimulation      │
                    │  • District-level impacts     │
                    │  • Schema formatting          │
                    │  • Database writes            │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  CHECKPOINT #2: REVIEW        │
                    │  Compare results to fiscal    │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 6: UPDATE LOCAL FILE   │
                    │  + CREATE REVIEW PR           │
                    │                               │
                    │  1. Add entry to              │
                    │     analysisDescriptions.js   │
                    │  2. Create bill/ branch       │
                    │  3. Commit file change + PR   │
                    └───────────────────────────────┘
                                │
                                ▼
                          ┌───────────┐
                          │   DONE!   │
                          └───────────┘
```

## Phase 1: Research (Parallel)

Spawn two Task agents in parallel:

### 1a. Bill Researcher Agent
```
Task: bill-researcher
Prompt: Research bill {STATE} {BILL_NUMBER}. Fetch the bill text, identify
policy provisions, and extract specific values (rates, thresholds, amounts).
Return structured JSON with bill metadata and provisions.
```

### 1b. Fiscal Finder Agent
```
Task: fiscal-finder
Prompt: Find fiscal note and external analyses for {STATE} {BILL_NUMBER}.
Search state legislative fiscal office, Tax Foundation, ITEP, state policy
centers. Extract revenue estimates and methodologies.
```

Wait for both to complete, then combine results.

## Phase 2: Parameter Mapping

Spawn param-mapper agent:
```
Task: param-mapper
Prompt: Map these bill provisions to PolicyEngine-US parameters:
{provisions from bill-researcher}

State: {STATE}
Effective date: {effective_date}

Generate reform JSON and verify parameters exist.
```

## Phase 3: Model Description

Spawn model-describer agent:
```
Task: model-describer
Prompt: Generate human-readable descriptions for this reform:

State: {STATE}
Bill: {BILL_NUMBER}
Reform JSON: {reform_json from param-mapper}
Bill provisions: {provisions from bill-researcher}

Return provisions array and model_notes string.
```

The agent will return:
```json
{
  "provisions": [
    {
      "parameter": "gov.states.ok.tax.income.credits.earned_income.eitc_fraction",
      "label": "Oklahoma State EITC",
      "baseline": "None",
      "reform": "10% of federal EITC",
      "explanation": "Creates a new Oklahoma state EITC equal to 10% of the federal credit."
    }
  ],
  "model_notes": "This analysis uses PolicyEngine's Enhanced CPS microdata for Oklahoma, projected to tax year 2026."
}
```

**IMPORTANT**: Every provision must include a `parameter` field (single PE parameter path) or `parameters` array (for grouped provisions), and a `bill_section` field (carried through from bill-researcher output). See `.claude/agents/model-describer.md` for details.

## Checkpoint #1: User Review

Present the mapping AND model description for approval:

```
═══════════════════════════════════════════════════════════════════════════
PARAMETER MAPPING & MODEL DESCRIPTION REVIEW
═══════════════════════════════════════════════════════════════════════════

Bill: {STATE} {BILL_NUMBER}
Title: {title}
Effective: {effective_date}

REFORM JSON:
┌─────────────────────────────────────────────────────────────────────────┐
│ {                                                                       │
│   "gov.states.ut.tax.income.rate": {                                    │
│     "2026-01-01.2100-12-31": 0.0445                                     │
│   }                                                                     │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

WHAT WE MODEL (for Overview tab):
┌─────────────────────────────────────────────────────────────────────────┐
│ Parameter                    │ Current    │ Proposed                   │
│──────────────────────────────│────────────│────────────────────────────│
│ Utah Income Tax Rate         │ 4.85%      │ 4.45%                      │
└─────────────────────────────────────────────────────────────────────────┘

Explanation: Reduces Utah's flat income tax rate from 4.85% to 4.45%,
providing tax relief to all Utah taxpayers.

FISCAL NOTE ESTIMATE: -$83.6M (annual)

═══════════════════════════════════════════════════════════════════════════
```

Use `AskUserQuestion` to confirm:
- Does this mapping and description look correct?
- Options: Yes / No, adjust / Cancel

## Phase 4: Write Reform Config to Database

**CRITICAL: NEVER set status to `published`**. The status must be `in_review` when writing to the database. Only the `publish-bill` GitHub Action (triggered by merging the review PR) is allowed to set `published`. If you skip the PR or set `published` directly, the bill goes live without human review.

**IMPORTANT**: Before computing impacts, write the reform config to the database.
This ensures the reform is tracked and can be re-computed if needed.

```bash
export $(grep -v '^#' .env | xargs) && python3 << 'EOF'
from supabase import create_client
import os

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# 1. Upsert research record
# key_findings format: always include source URL so PR builder can parse into validation table
# Format each finding as: "{source}: {estimate} — {url}"
research = {
    "id": "{state}-{bill}".lower(),
    "state": "{STATE}",
    "type": "bill",
    "status": "in_review",
    "title": "{BILL_TITLE}",
    "description": "{DESCRIPTION}",
    "url": "{BILL_URL}",
    "key_findings": [
        "Fiscal note ({source}): {estimate} — {fiscal_note_url}",
        "{external_source}: {estimate} — {external_url}",
        "Back-of-envelope: {calculation_summary} = {result}"
    ],
}
supabase.table("research").upsert(research).execute()

# 2. Upsert reform_impacts with reform_params AND provisions
reform_impacts = {
    "id": "{state}-{bill}".lower(),
    "computed": False,
    "reform_params": {REFORM_JSON},
    "provisions": {PROVISIONS_ARRAY},  # From model-describer
    "model_notes": "{MODEL_NOTES}",     # From model-describer
}
supabase.table("reform_impacts").upsert(reform_impacts).execute()

print("Reform config and provisions written to database")
EOF
```

## Phase 5: Compute Impacts (via script)

**Run the compute_impacts.py script** - this is the ONLY way to compute impacts.

### Single-year bills

```bash
export $(grep -v '^#' .env | xargs) && python scripts/compute_impacts.py --reform-id {state}-{bill}
```

### Multi-year bills

For bills that phase in over multiple years (e.g., GA SB168 cuts 1pp/year from 2026-2031), run each year with `--multi-year`:

```bash
export $(grep -v '^#' .env | xargs)
python scripts/compute_impacts.py --reform-id {state}-{bill} --year 2026 --multi-year
python scripts/compute_impacts.py --reform-id {state}-{bill} --year 2027 --multi-year
python scripts/compute_impacts.py --reform-id {state}-{bill} --year 2028 --multi-year
# ... continue for all years
python scripts/compute_impacts.py --reform-id {state}-{bill} --year {final_year} --multi-year
```

The `--multi-year` flag stores each year's impacts in `model_notes.impacts_by_year[year]` instead of overwriting.

### How to detect multi-year bills

Look for these signals from the bill-researcher output:
- `is_multi_year: true` in the research
- Multiple year-specific period ranges in reform_params (e.g., `"2026-01-01.2026-12-31"`, `"2027-01-01.2027-12-31"`)
- Rate schedules, phase-in language, annual reduction provisions

### What the script does

1. Read reform_params from database
2. Run local Microsimulation (budgetary, poverty, winners/losers, district-level)
3. Write results back to database using proper schema
4. Set status to `in_review` (bill hidden from dashboard)

**DO NOT compute impacts inline or with ad-hoc code.** All computation goes through the script for:
- Reproducibility
- Auditability
- Consistent schema formatting

## Phase 5b: Generate Household Earnings Sweep Chart

After compute_impacts.py completes, generate a household-level chart to validate the reform's shape:

```bash
export $(grep -v '^#' .env | xargs) && python scripts/generate_household_chart.py --reform-id {state}-{bill}
```

This auto-selects a household archetype (e.g., single parent + 2 kids for CTC/EITC, single filer for rate cuts), sweeps employment income from $0 to a sensible max, and saves:
- `charts/{reform-id}.png` — static chart for PR comment
- `charts/{reform-id}.html` — interactive chart for local review

**Quick sanity check the chart**: Does the benefit curve match the bill's intent? E.g.:
- CTC: flat benefit up to income limit, then cliff
- EITC: triangle shape (phase-in, plateau, phase-out)
- Rate cut: linearly increasing benefit with income

If the chart looks wrong, investigate before proceeding — it likely means a parameter mapping error.

## Checkpoint #2: Results Review

After the script completes, review the output and compare to fiscal note:

```
═══════════════════════════════════════════════════════════════════════════
RESULTS REVIEW
═══════════════════════════════════════════════════════════════════════════

SCRIPT OUTPUT:
  Policy ID: {policy_id}
  Revenue impact: ${amount}

VALIDATION
  PolicyEngine estimate: -$68.6M
  Fiscal note estimate:  -$83.6M
  Difference: 17.9%  ⚠️ (within acceptable range)

═══════════════════════════════════════════════════════════════════════════
```

Use `AskUserQuestion`:
- Results look correct?
- Options: Yes, update status to computed / Re-compute with --force / Cancel

## Phase 6: Update Local Descriptions + Create Review PR — MANDATORY

**This phase is NOT optional.** Without a PR, the bill stays hidden (`in_review`) and cannot be published. You MUST complete this phase before finishing.

**The agent (you) creates the PR**, not the script. This lets you include context from the research phases that the script doesn't have access to.

### Step 0: Add description to `src/data/analysisDescriptions.js`

**IMPORTANT**: Bill descriptions are version-controlled in `src/data/analysisDescriptions.js`. You MUST add a new entry for this bill. This is the primary source for the description shown in the app — Supabase is the fallback.

Read the file, then use the Edit tool to add a new entry in the correct alphabetical position (grouped by state). The format is just a key-value pair:

```js
  "{state}-{bill}": "{DESCRIPTION}",
```

Use the same description from Phase 4. Everything else (provisions, analysis year, computed data) stays in Supabase only.

### Step 1: Fetch computed data from Supabase

```bash
source .env && python3 << 'EOF'
import json, os
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

reform_id = "{state}-{bill}".lower()

# Fetch research record
research = supabase.table("research").select("*").eq("id", reform_id).execute()
print("=== RESEARCH ===")
print(json.dumps(research.data[0], indent=2, default=str))

# Fetch reform_impacts record
impacts = supabase.table("reform_impacts").select("*").eq("id", reform_id).execute()
print("\n=== REFORM IMPACTS ===")
print(json.dumps(impacts.data[0], indent=2, default=str))
EOF
```

### Step 2: Construct the PR body

Build the PR body using data from the DB **plus** context from earlier research phases. Use this template:

```markdown
## Bill Review: {title}

**Reform ID**: `{id}`  |  **State**: {STATE}
**Bill text**: {url}
**Description**: {description}

Merging this PR will publish the bill to the dashboard.

---

### What we model
| Provision | Parameter | Current | Proposed |
|-----------|-----------|---------|----------|
| Utah Income Tax Rate | `gov.states.ut.tax.income.rate` | 4.85% | 4.45% |
(Each row maps to a provision from reform_impacts.provisions — include provision.parameter or provision.parameters[0]. For grouped provisions with multiple parameters, list the primary parameter and note others in the row or use multiple rows.)

### Validation

#### External estimates
| Source | Estimate | Period | Link |
|--------|----------|--------|------|
| Utah Legislative Fiscal Analyst | -$83.6M | Annual | [Fiscal Note](url) |
| Tax Foundation | -$80.0M | Annual | [Analysis](url) |
(From fiscal-finder output stored in research.key_findings. Parse each finding's URL into a clickable link. If no fiscal note exists, note "No fiscal note available".)

#### Back-of-envelope check
> Rate change: 4.85% → 4.45% = 0.40pp reduction
> Utah PIT base ≈ $16.7B → 0.004 × $16.7B = **-$66.8M**
> (Rough estimate — actual varies due to deductions and credits)

(From fiscal-finder back_of_envelope data stored in key_findings. Always include when available. Especially important when no fiscal note exists.)

#### PE vs External comparison
| Source | Estimate | vs PE | Difference |
|--------|----------|-------|------------|
| PE (PolicyEngine) | **-$68.6M** | — | — |
| Fiscal note | -$83.6M | -17.9% | Acceptable |
| Tax Foundation | -$80.0M | -14.3% | Acceptable |
| Back-of-envelope | -$66.8M | +2.7% | Excellent |

**Verdict**: PE estimate is within acceptable range (10-25%) of official fiscal note.
Difference likely due to: [agent explains — e.g., PE uses CPS microdata vs state tax return data]

(Compute % difference as: (PE - source) / source × 100. Thresholds: <10% Excellent, 10-25% Acceptable, 25-50% Review needed, >50% Likely error. Always include a 1-sentence explanation of likely discrepancy sources.)

### Parameter changes
| Parameter | Period | Value | Bill Reference |
|-----------|--------|-------|----------------|
(from reform_impacts.reform_params — format rates as "0.0445 (4.45%)", amounts with commas. Bill Reference comes from bill-researcher provisions[].bill_section — the exact section/subsection of the bill that mandates this parameter change. E.g., "Section 2, amending §59-10-104(2)(a)" or "Lines 15-22".)

### Key results
| Metric | Value |
|--------|-------|
| Revenue impact | **${budgetary_impact.stateRevenueImpact}** |
| Poverty rate | {baseline} to {reform} ({change}%) |
| Child poverty rate | {baseline} to {reform} ({change}%) |
| Winners | {pct} |
| Losers | {pct} |

(For multi-year bills: replace "Key results" with a year-by-year summary table showing Revenue Impact, Poverty Change, Winners, Losers per year)

### Decile impact
| Decile | Change | Avg Benefit |
|--------|--------|-------------|
(deciles 1-10 from decile_impact.relative and decile_impact.average)

### District impacts
| District | Avg Benefit | Winners | Losers | Poverty Change |
|----------|-------------|---------|--------|----------------|
(from district_impacts, sorted by district ID)

<details><summary>Reform parameters JSON</summary>

```json
{reform_params as formatted JSON}
```

</details>

### Versions
- PolicyEngine US: `{policyengine_us_version}`
- Dataset: `{dataset_version}`
- Computed: {computed_at}
```

### Step 3: Add agent-specific context

Below the template sections, add any context from the research phases that is NOT in the DB:

- **Discrepancy explanation** (in the Validation → PE vs External Verdict): Explain *why* PE differs from the fiscal note — e.g., PE uses CPS microdata vs state tax return data, dynamic vs static scoring, different base year
- **Data quality caveats**: e.g., CPS top-coding for ultra-high earners, small sample sizes for specific districts
- **Modeling notes**: what's included/excluded from the model vs the actual bill

### Step 4: Create branch and PR

**Critical constraints** (the GitHub Action depends on these):
- Branch name MUST be `bill/{reform-id}`
- Label MUST be `bill-review`

```bash
cd /Users/pavelmakarchuk/state-research-tracker
git checkout -b bill/{reform-id}
git add src/data/analysisDescriptions.js
git commit -m "Bill review: {title}"
git push -u origin bill/{reform-id}
gh pr create --title "Bill review: {title} ({STATE})" --label "bill-review" --body "$(cat <<'EOF'
{PR_BODY}
EOF
)"
git checkout main
```

The commit includes the updated `analysisDescriptions.js` with the new bill entry. When merged, the GitHub Action sets status to `published` AND the app picks up the version-controlled description.

### Step 5: Upload household chart to PR

After creating the PR, upload the earnings sweep chart as an embedded comment:

```bash
export $(grep -v '^#' .env | xargs) && python scripts/generate_household_chart.py --reform-id {state}-{bill} --upload-to-pr {PR_NUMBER}
```

This uploads the PNG to a `charts` branch on GitHub and posts a comment with the chart embedded inline, so reviewers can verify the reform's shape at a glance.

**The bill is NOT visible on the dashboard** until the PR is merged. The `publish-bill` GitHub Action extracts the reform-id from the branch name on merge and sets status to `published`.

## Final Output

```
═══════════════════════════════════════════════════════════════════════════
COMPLETE: {STATE} {BILL_NUMBER}
═══════════════════════════════════════════════════════════════════════════

RECORDS IN DATABASE:
  ✓ research: {id} (status: in_review, type: bill)
  ✓ reform_impacts: {id} (computed: true)

REVIEW PR:
  {PR_URL}

NEXT STEPS:
  1. Review the PR for accuracy
  2. Merge the PR to publish the bill to the dashboard
  3. The publish-bill GitHub Action will set status to 'published'

VIEW IN SUPABASE:
  https://supabase.com/dashboard/project/ffgngqlgfsvqartilful/editor

═══════════════════════════════════════════════════════════════════════════
```

## Usage Examples

```
/encode-bill UT SB60
/encode-bill SC H3492
/encode-bill OK HB2229
/encode-bill NY A1234
```

## Agents Used

| Agent | Purpose | Location |
|-------|---------|----------|
| bill-researcher | Fetch and parse bill text | `.claude/agents/bill-researcher.md` |
| fiscal-finder | Find fiscal notes and analyses | `.claude/agents/fiscal-finder.md` |
| param-mapper | Map to PolicyEngine parameters | `.claude/agents/param-mapper.md` |
| model-describer | Generate human-readable descriptions | `.claude/agents/model-describer.md` |

## Scripts Used

| Script | Purpose |
|--------|---------|
| `scripts/compute_impacts.py` | Compute and store impacts (PE API + Microsimulation) |
| `scripts/generate_household_chart.py` | Generate earnings sweep chart for PR validation |
| `scripts/db_schema.py` | Schema utilities for consistent data formatting |

## Prerequisites

- `.env` file with SUPABASE_URL and SUPABASE_KEY
- PolicyEngine-US installed (for district microsimulation)
- HuggingFace Hub access (for state datasets)
- GitHub `bill-review` label exists on the repo (create with `gh label create bill-review` if missing)
- `gh` CLI authenticated for PR creation

## Key Principle: All Computation via Script

**NEVER compute impacts inline.** Always use `compute_impacts.py` because:

1. **Reproducibility**: Same code runs every time
2. **Auditability**: Changes are tracked in git
3. **Schema consistency**: Uses `db_schema.py` utilities
4. **Testability**: Script can be tested independently

The agents research and generate reform JSON. The script does computation.
