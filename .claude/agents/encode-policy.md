# Encode Policy Agent (Orchestrator)

Orchestrates the full workflow for analyzing a bill and writing results to the database.

## Purpose

This is the main orchestrator agent. Given a bill identifier, it:
1. Spawns research agents in parallel
2. Maps bill provisions to PolicyEngine parameters
3. Presents results for human review
4. Computes impacts and validates against fiscal notes
5. Writes to database after approval

## Invocation

```
/encode-policy {state} {bill_number}
```

Examples:
- `/encode-policy UT SB60`
- `/encode-policy SC H3492`
- `/encode-policy OK HB2229`

## Workflow

### Phase 1: Research (Parallel)

Spawn two agents in parallel:

1. **bill-researcher**: Fetch bill text, identify provisions
2. **fiscal-finder**: Find fiscal notes, external analyses

```
┌─────────────────────────────────────────────────────────┐
│  Task: bill-researcher                                  │
│  Input: state={state}, bill_number={bill_number}        │
└─────────────────────────────────────────────────────────┘
                         │
                         │  PARALLEL
                         │
┌─────────────────────────────────────────────────────────┐
│  Task: fiscal-finder                                    │
│  Input: state={state}, bill_number={bill_number}        │
└─────────────────────────────────────────────────────────┘
```

Wait for both to complete. Combine results.

### Phase 2: Parameter Mapping

Spawn param-mapper agent:

```
┌─────────────────────────────────────────────────────────┐
│  Task: param-mapper                                     │
│  Input: provisions (from bill-researcher)               │
│         state={state}                                   │
│         effective_date (from bill-researcher)           │
└─────────────────────────────────────────────────────────┘
```

### Phase 3: Human Checkpoint #1

Present to user for review:

```
═══════════════════════════════════════════════════════════
CHECKPOINT: Parameter Mapping Review
═══════════════════════════════════════════════════════════

Bill: {state} {bill_number}
Title: {title}

Provisions identified:
  1. {provision_1_description}
  2. {provision_2_description}

Proposed PolicyEngine mapping:
┌─────────────────────────────────────────────────────────┐
│ {                                                       │
│   "gov.states.ut.tax.income.rate": {                    │
│     "2026-01-01.2100-12-31": 0.0445                     │
│   }                                                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘

Fiscal note estimate: -$83.6M (annual)

═══════════════════════════════════════════════════════════
Does this mapping look correct? [Yes / No / Adjust]
═══════════════════════════════════════════════════════════
```

If user says "Adjust", allow them to modify the reform JSON.

### Phase 4: Impact Computation

Spawn impact-calculator agent:

```
┌─────────────────────────────────────────────────────────┐
│  Task: impact-calculator                                │
│  Input: reform (from param-mapper or user adjustment)   │
│         state={state}                                   │
│         year=2026                                       │
└─────────────────────────────────────────────────────────┘
```

### Phase 5: Validation

Compare PolicyEngine results to fiscal note:

```python
pe_estimate = impacts["budgetary_impact"]["stateRevenueImpact"]
fiscal_note = validation["fiscal_note"]["estimate"]
difference_pct = (pe_estimate - fiscal_note) / abs(fiscal_note) * 100
```

| Difference | Action |
|------------|--------|
| < 10% | Proceed automatically |
| 10-25% | Note discrepancy, proceed |
| 25-50% | Warning, ask user to review |
| > 50% | Error, require re-mapping |

### Phase 6: Human Checkpoint #2

Present results for approval:

```
═══════════════════════════════════════════════════════════
CHECKPOINT: Results Review
═══════════════════════════════════════════════════════════

Bill: {state} {bill_number}

BUDGETARY IMPACT
  PolicyEngine estimate: -${pe_estimate/1e6:.1f}M
  Fiscal note estimate:  -${fiscal_note/1e6:.1f}M
  Difference: {difference_pct:.1f}%  {status_emoji}

POVERTY IMPACT
  Baseline poverty rate: {baseline:.2%}
  Reform poverty rate:   {reform:.2%}
  Change: {change:+.3%}

WINNERS & LOSERS
  No change:     {no_change:.1%}
  Gain <5%:      {gain_less:.1%}
  Gain >5%:      {gain_more:.1%}
  Lose <5%:      {lose_less:.1%}
  Lose >5%:      {lose_more:.1%}

DECILE IMPACTS (avg $ benefit)
  D1: ${d1:.0f}  D2: ${d2:.0f}  D3: ${d3:.0f}  D4: ${d4:.0f}  D5: ${d5:.0f}
  D6: ${d6:.0f}  D7: ${d7:.0f}  D8: ${d8:.0f}  D9: ${d9:.0f}  D10: ${d10:.0f}

═══════════════════════════════════════════════════════════
Write to database? [Yes / No / Re-compute]
═══════════════════════════════════════════════════════════
```

### Phase 7: Database Write

Spawn db-writer agent:

```
┌─────────────────────────────────────────────────────────┐
│  Task: db-writer                                        │
│  Input: bill_info (from bill-researcher)                │
│         impacts (from impact-calculator)                │
│         validation (from fiscal-finder + comparison)    │
│         reform (from param-mapper)                      │
└─────────────────────────────────────────────────────────┘
```

### Phase 8: Final Summary

```
═══════════════════════════════════════════════════════════
COMPLETE: {state} {bill_number}
═══════════════════════════════════════════════════════════

Records written:
  ✓ research: {id}
  ✓ reform_impacts: {id}
  ✓ validation_metadata: {id}

Next steps:
  1. Run 'make sync' to update local JSON files
  2. Add reformConfig to src/data/states.js (if interactive analyzer needed)
  3. Commit and push changes
  4. Write blog post at policyengine.org/us/research/{id}

View in Supabase:
  https://supabase.com/dashboard/project/ffgngqlgfsvqartilful/editor

═══════════════════════════════════════════════════════════
```

## Error Handling

### Bill Not Found
```
Error: Could not find bill {state} {bill_number}
Suggestions:
  - Check bill number format (SB60 vs S60 vs SB0060)
  - Verify bill exists in current session
  - Try searching: https://legiscan.com/search?state={state}&q={bill_number}
```

### Parameter Not Found
```
Warning: Parameter not found in PolicyEngine-US
  Attempted: gov.states.{state}.tax.income.credits.new_credit.amount

Options:
  1. Use a different parameter path
  2. Add parameter to policyengine-us first
  3. Use contrib parameter (gov.contrib.states.{state}....)
```

### Validation Failed
```
Warning: Large discrepancy with fiscal note
  PE estimate:     -$150M
  Fiscal note:     -$80M
  Difference:      87.5%

Possible causes:
  - Incorrect parameter mapping
  - Different baseline assumptions
  - Behavioral vs static scoring

Action: Review mapping and re-compute, or explain discrepancy
```

## Tools Used

- `Task` (bill-researcher): Research bill text
- `Task` (fiscal-finder): Find fiscal notes
- `Task` (param-mapper): Map to PE parameters
- `Task` (impact-calculator): Compute impacts
- `Task` (db-writer): Write to database
- `AskUserQuestion`: Human checkpoints
- `Skill` (policyengine-us-skill): Parameter knowledge
- `Skill` (supabase-tracker-skill): Database schema

## Configuration

Set in environment:
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service role key
