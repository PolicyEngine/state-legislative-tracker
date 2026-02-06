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
                    │   CHECKPOINT #1: REVIEW MAP   │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 3: WRITE TO DATABASE   │
                    │  (research + reform_params)   │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 4: RUN SCRIPT          │
                    │                               │
                    │  python compute_impacts.py    │
                    │    --reform-id {id}           │
                    │                               │
                    │  Script handles:              │
                    │  • PE API calls               │
                    │  • District microsimulation   │
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
                    │  PHASE 5: VERIFY IN APP       │
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

## Checkpoint #1: User Review

Present the mapping for approval:

```
═══════════════════════════════════════════════════════════════════════════
PARAMETER MAPPING REVIEW
═══════════════════════════════════════════════════════════════════════════

Bill: {STATE} {BILL_NUMBER}
Title: {title}
Effective: {effective_date}

PROVISIONS:
  1. {provision_1}
  2. {provision_2}

PROPOSED REFORM JSON:
┌─────────────────────────────────────────────────────────────────────────┐
│ {                                                                       │
│   "gov.states.ut.tax.income.rate": {                                    │
│     "2026-01-01.2100-12-31": 0.0445                                     │
│   }                                                                     │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

FISCAL NOTE ESTIMATE: -$83.6M (annual)

═══════════════════════════════════════════════════════════════════════════
```

Use `AskUserQuestion` to confirm:
- Does this mapping look correct?
- Options: Yes / No, adjust / Cancel

## Phase 3: Write Reform Config to Database

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
    "status": "in_progress",
    "title": "{BILL_TITLE}",
    "description": "{DESCRIPTION}",
    "url": "{BILL_URL}",
    "key_findings": ["{provision_1}", "{provision_2}"],
}
supabase.table("research").upsert(research).execute()

# 2. Upsert reform_impacts with reform_params (impacts will be computed by script)
reform_impacts = {
    "id": "{state}-{bill}".lower(),
    "computed": False,
    "reform_params": {REFORM_JSON},
}
supabase.table("reform_impacts").upsert(reform_impacts).execute()

print("Reform config written to database")
EOF
```

## Phase 4: Compute Impacts (via script)

**Run the compute_impacts.py script** - this is the ONLY way to compute impacts:

```bash
export $(grep -v '^#' .env | xargs) && python scripts/compute_impacts.py --reform-id {state}-{bill}
```

The script will:
1. Read reform_params from database
2. Call PolicyEngine API to create policy
3. Fetch economy-wide impacts (budgetary, poverty, winners/losers)
4. Run local Microsimulation for district-level impacts
5. Write results back to database using proper schema

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

## Phase 5: Verify and Finalize

1. **Check the app** - refresh to see the bill with computed impacts
2. **Update status** if everything looks good:

```bash
export $(grep -v '^#' .env | xargs) && python3 << 'EOF'
from supabase import create_client
import os
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
supabase.table("research").update({"status": "in_progress"}).eq("id", "{state}-{bill}").execute()
print("Status updated")
EOF
```

## Final Output

```
═══════════════════════════════════════════════════════════════════════════
COMPLETE: {STATE} {BILL_NUMBER}
═══════════════════════════════════════════════════════════════════════════

RECORDS IN DATABASE:
  ✓ research: {id} (status: in_progress, type: bill)
  ✓ reform_impacts: {id} (computed: true)

APP DISPLAY:
  ✓ Bill appears in state panel
  ✓ Statewide impacts tab shows data
  ✓ District map displays (if available)
  ✓ Household calculator works

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

## Scripts Used

| Script | Purpose |
|--------|---------|
| `scripts/compute_impacts.py` | Compute and store impacts (PE API + Microsimulation) |
| `scripts/db_schema.py` | Schema utilities for consistent data formatting |

## Prerequisites

- `.env` file with SUPABASE_URL and SUPABASE_KEY
- PolicyEngine-US installed (for district microsimulation)
- HuggingFace Hub access (for state datasets)

## Key Principle: All Computation via Script

**NEVER compute impacts inline.** Always use `compute_impacts.py` because:

1. **Reproducibility**: Same code runs every time
2. **Auditability**: Changes are tracked in git
3. **Schema consistency**: Uses `db_schema.py` utilities
4. **Testability**: Script can be tested independently

The agents research and generate reform JSON. The script does computation.
