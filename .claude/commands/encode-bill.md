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
                    │  PHASE 6: VERIFY IN APP       │
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
export $(grep -v '^#' .env | xargs) && python scripts/compute_impacts.py --reform-id {state}-{bill} --create-pr
```

### Multi-year bills

For bills that phase in over multiple years (e.g., GA SB168 cuts 1pp/year from 2026-2031), run each year with `--multi-year`:

```bash
export $(grep -v '^#' .env | xargs)
python scripts/compute_impacts.py --reform-id {state}-{bill} --year 2026 --multi-year
python scripts/compute_impacts.py --reform-id {state}-{bill} --year 2027 --multi-year
python scripts/compute_impacts.py --reform-id {state}-{bill} --year 2028 --multi-year
# ... continue for all years
# Run the last year with --create-pr to create the review PR with all years' data:
python scripts/compute_impacts.py --reform-id {state}-{bill} --year {final_year} --multi-year --create-pr
```

The `--multi-year` flag stores each year's impacts in `model_notes.impacts_by_year[year]` instead of overwriting. The `--create-pr` flag on the last year will generate a PR body that includes a multi-year summary table.

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
5. Create a GitHub PR with full impact summary for review (if `--create-pr`)

The PR body includes: provisions table, multi-year impact summary (if applicable), decile/district breakdowns, reform parameters (collapsed), and version info.

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

## Phase 6: PR Created - Awaiting Review

The bill is now in review. The `--create-pr` flag created a GitHub PR with the full impact summary.

**The bill is NOT visible on the dashboard** until the PR is merged.

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
