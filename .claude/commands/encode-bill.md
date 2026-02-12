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
                    │  PHASE 6: CREATE REVIEW PR    │
                    │  (agent builds PR body with   │
                    │   full research context)      │
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

**IMPORTANT**: Before computing impacts, write the reform config to the database.
This ensures the reform is tracked and can be re-computed if needed.

```bash
export $(grep -v '^#' .env | xargs) && python3 << 'EOF'
from supabase import create_client
import os

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# 1. Upsert research record
research = {
    "id": "{state}-{bill}".lower(),
    "state": "{STATE}",
    "type": "bill",
    "status": "in_review",
    "title": "{BILL_TITLE}",
    "description": "{DESCRIPTION}",
    "url": "{BILL_URL}",
    "key_findings": ["{provision_1}", "{provision_2}"],
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

## Phase 6: Create Review PR

**The agent (you) creates the PR**, not the script. This lets you include context from the research phases that the script doesn't have access to.

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
| Provision | Current | Proposed |
|-----------|---------|----------|
(from reform_impacts.provisions)

### Fiscal estimates (external)
- {key_findings[0]}
- {key_findings[1]}
(from research.key_findings)

### Parameter changes
| Parameter | Period | Value |
|-----------|--------|-------|
(from reform_impacts.reform_params — format rates as "0.0445 (4.45%)", amounts with commas)

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

- **Fiscal estimate comparison**: PE estimate vs fiscal note, percentage difference, explanation of discrepancy
- **Data quality caveats**: e.g., CPS top-coding for ultra-high earners, small sample sizes for specific districts
- **Modeling notes**: what's included/excluded from the model vs the actual bill

### Step 4: Create branch and PR

**Critical constraints** (the GitHub Action depends on these):
- Branch name MUST be `bill/{reform-id}`
- Label MUST be `bill-review`

```bash
cd /Users/pavelmakarchuk/state-research-tracker
git checkout -b bill/{reform-id}
git commit --allow-empty -m "Bill review: {title}"
git push -u origin bill/{reform-id}
gh pr create --title "Bill review: {title} ({STATE})" --label "bill-review" --body "$(cat <<'EOF'
{PR_BODY}
EOF
)"
git checkout main
```

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
