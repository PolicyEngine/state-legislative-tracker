# Encode Bill

Analyze a legislative bill, compute PolicyEngine impacts, and write results to Supabase.

This is the database-integrated version of `/score-bill`. Results are stored in Supabase and synced to the app.

## Arguments
- `$ARGUMENTS` - State and bill number (e.g., "UT SB60", "SC H3492")

## Workflow Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          /encode-bill UT SB60                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  PHASE 1: PARALLEL RESEARCH   │
                    └───────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          │                                                   │
          ▼                                                   ▼
┌───────────────────┐                             ┌───────────────────┐
│  bill-researcher  │                             │  fiscal-finder    │
│                   │                             │                   │
│  • Fetch bill     │                             │  • Find fiscal    │
│  • Parse text     │                             │    note           │
│  • ID provisions  │                             │  • Find external  │
│                   │                             │    analyses       │
└─────────┬─────────┘                             └─────────┬─────────┘
          │                                                 │
          └─────────────────────┬───────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 2: PARAMETER MAPPING   │
                    └───────────────────────────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │   param-mapper    │
                      │                   │
                      │  • Map bill →     │
                      │    PE params      │
                      │  • Generate       │
                      │    reform JSON    │
                      └─────────┬─────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │   CHECKPOINT #1: REVIEW MAP   │
                    │                               │
                    │   You approve the parameter   │
                    │   mapping before computation  │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  PHASE 3: IMPACT COMPUTATION  │
                    └───────────────────────────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │ impact-calculator │
                      │                   │
                      │  • Call PE API    │
                      │  • Get budgetary  │
                      │  • Get poverty    │
                      │  • Get districts  │
                      └─────────┬─────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │  CHECKPOINT #2: REVIEW RESULTS│
                    │                               │
                    │   Compare PE vs fiscal note   │
                    │   You approve before DB write │
                    └───────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │   PHASE 4: DATABASE WRITE     │
                    └───────────────────────────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │    db-writer      │
                      │                   │
                      │  • research table │
                      │  • reform_impacts │
                      │  • validation_    │
                      │    metadata       │
                      └─────────┬─────────┘
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

## Phase 3: Impact Computation

Spawn impact-calculator agent:
```
Task: impact-calculator
Prompt: Compute PolicyEngine impacts for this reform:
{reform JSON}

State: {STATE}
Year: 2026

Return budgetary impact, poverty impact, decile impacts, and district impacts.
```

## Checkpoint #2: Results Review

Present results and validation:

```
═══════════════════════════════════════════════════════════════════════════
RESULTS REVIEW
═══════════════════════════════════════════════════════════════════════════

VALIDATION
  PolicyEngine estimate: -$68.6M
  Fiscal note estimate:  -$83.6M
  Difference: 17.9%  ⚠️ (within acceptable range)

BUDGETARY IMPACT
  State revenue change: -$69.9M
  Households affected: 1,058,820

POVERTY IMPACT
  Overall: -0.06 pp (-0.37%)
  Child: -0.05 pp (-0.36%)

WINNERS & LOSERS
  Better off: 44.5%
  No change: 55.5%
  Worse off: 0.0%

INCOME DISTRIBUTION (avg $ benefit by decile)
  D1: $6   D2: $15  D3: $24  D4: $30  D5: $36
  D6: $45  D7: $54  D8: $64  D9: $95  D10: $430

═══════════════════════════════════════════════════════════════════════════
```

Use `AskUserQuestion`:
- Write to database?
- Options: Yes / Re-compute / Cancel

## Phase 4: Database Write

Spawn db-writer agent:
```
Task: db-writer
Prompt: Write these results to Supabase:

Bill info: {bill_info}
Impacts: {impacts}
Validation: {validation}
Reform: {reform}

Tables: research, reform_impacts, validation_metadata
```

## Final Output

```
═══════════════════════════════════════════════════════════════════════════
COMPLETE: {STATE} {BILL_NUMBER}
═══════════════════════════════════════════════════════════════════════════

RECORDS WRITTEN:
  ✓ research: {id}
  ✓ reform_impacts: {id}
  ✓ validation_metadata: {id}

NEXT STEPS:
  1. Run: make sync
  2. Add reformConfig to src/data/states.js (if needed)
  3. Commit and push

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
| impact-calculator | Compute PE impacts | `.claude/agents/impact-calculator.md` |
| db-writer | Write to Supabase | `.claude/agents/db-writer.md` |

## Skills Used

| Skill | Purpose |
|-------|---------|
| policyengine-us-skill | PE parameter knowledge |
| supabase-tracker-skill | Database schema knowledge |

## Prerequisites

- `.env` file with SUPABASE_URL and SUPABASE_KEY
- Internet access for bill fetching and PE API
- PolicyEngine API access

## Comparison with /score-bill

| Feature | /score-bill | /encode-bill |
|---------|-------------|--------------|
| Stores in database | No | Yes (Supabase) |
| Human checkpoints | 1 | 2 |
| Parallel research | No | Yes |
| Validation tracking | No | Yes |
| Fiscal note comparison | Manual | Automatic |
