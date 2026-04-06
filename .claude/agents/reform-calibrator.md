# Reform Calibrator Agent

Autonomous agent that iteratively refines reform_params to minimize the discrepancy between PolicyEngine's estimate and an external validation target.

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch) — you are the autonomous agent that modifies the "train.py" (reform_params) while the harness ("prepare.py") evaluates your changes.

## Prerequisites

Before this agent runs, `auto_calibrate.py --reform-id {id}` must have been called, which:
1. Built the validation target (harness)
2. Ran the baseline experiment
3. Saved state to `results/{reform-id}/calibration_state.json`

Read that state file first to understand where you are.

## What You Can Modify

**ONLY** `reform_params` — the parameter mapping JSON. Specifically:

1. **Parameter paths** — which PolicyEngine parameter a provision maps to
2. **Values** — the numeric values for each parameter
3. **Period ranges** — `"2026-01-01.2026-12-31"` vs `"2026-01-01.2100-12-31"` etc.
4. **Filing status coverage** — which filing statuses are included
5. **COLA/uprating adjustments** — manual per-year value computation

## What You Cannot Modify

- `scripts/compute_impacts.py` — the simulation runner
- `scripts/validation_harness.py` — the target builder
- The target estimate or tolerance band
- The Supabase schema or any frontend code

## Your Workflow

### Step 1: Read Current State

```bash
cat results/{reform-id}/calibration_state.json
cat results/{reform-id}/calibration.tsv
cat results/{reform-id}/harness_output.json
```

Key fields from `calibration_state.json`:
- `target`: The estimate you're trying to match (e.g., -50000000)
- `tolerance`: Acceptable % diff (e.g., 0.15 = 15%)
- `current_best_pct`: Best discrepancy so far
- `current_best_params`: The reform_params that achieved it
- `provisions`: What the bill actually does
- `state`: Two-letter state code

### Step 2: Analyze the Gap

Compare PE estimate to target. Think about WHY they differ:

- **PE too high (magnitude)?** — Maybe counting more people than affected, or per-person instead of per-return
- **PE too low (magnitude)?** — Maybe missing a filing status, or period range too narrow
- **Wrong sign?** — Probably wrong parameter path entirely
- **Right ballpark but off?** — Fine-tuning values, COLA, or interaction effects

### Step 3: Hypothesize and Modify

Generate a specific hypothesis, then modify reform_params to test it.

**Hypothesis space (ordered by likelihood):**

1. **Wrong parameter path** (most common)
   - Different parameter for same concept
   - Browse parameters: `policyengine_us/parameters/gov/states/{state}/`
   - Example: `gov.states.ga.tax.income.rate` vs `gov.states.ga.tax.income.rates.brackets[0].rate`

2. **Wrong period range**
   - `"2026-01-01.2026-12-31"` = single year only (reverts to baseline in 2027)
   - `"2026-01-01.2100-12-31"` = permanent (no COLA ever)
   - Multi-year: explicit values per year

3. **Value interpretation**
   - Per-person vs per-return
   - Annual vs monthly
   - Decimal rate vs percentage (0.05 vs 5)
   - Dollar vs cents

4. **Missing COLA/uprating adjustment**
   - PE reforms override the final value, not the YAML base
   - If the bill says "increase from $5,400 to $7,000", the $5,400 may have been COLA'd to $5,600 by 2026
   - Use uprating indices to compute correct 2026 baseline

5. **Filing status not properly split**
   - Some states have per-filing-status brackets (GA: 5 statuses × 6 brackets = 30 params)
   - Others have unified brackets (SC)
   - Check if you're missing filing statuses

6. **Interaction effects**
   - SALT deduction: state tax cuts can reduce federal SALT deduction, making some itemizers worse off
   - AMT: some changes interact with alternative minimum tax
   - Credit refundability: refundable vs non-refundable changes who benefits

### Step 4: Run the Experiment

Use the `run_calibration_step()` function from `auto_calibrate.py`:

```python
from scripts.auto_calibrate import run_calibration_step

result = run_calibration_step(
    reform_id="ga-hb168",
    reform_params=modified_params,  # Your proposed change
    target=-50000000,
    tolerance=0.15,
    attempt=2,
    description="Switch to per-return interpretation; fix period to 2026-2100",
    best_pct=0.604,  # Previous best
    best_params=previous_best_params,
    year=2026,
)
```

Or run via CLI:
```bash
# Write your modified reform_params to a file
cat > /tmp/reform_params.json << 'EOF'
{...your modified params...}
EOF

# The harness will pick up the new params from DB after you write them
```

### Step 5: Interpret Result

The step returns one of:
- **`accept`**: Within tolerance! You're done.
- **`keep`**: Improved, but not yet within tolerance. Continue.
- **`discard`**: Worse than best. Params reverted. Try something else.
- **`crash`**: Simulation failed. Params reverted. Investigate error.

### Step 6: Repeat or Stop

**Continue if:**
- Status was `keep` or `discard` and you have more hypotheses
- Haven't hit max iterations

**Stop if:**
- Status was `accept` — success!
- Plateau detected (3+ attempts with <2% improvement)
- Max iterations reached
- 3 consecutive crashes

## When You Plateau

If you can't improve further, diagnose the residual. Write `results/{reform-id}/diagnosis.json`:

```json
{
  "category": "data-level:state-systematic",
  "final_pct_diff": 0.18,
  "attempts": 7,
  "kept": 3,
  "explanation": "Stable at ~18% under target. GA has a known +3.2% avg state bias. Remaining gap consistent with PE data coverage limitations for GA.",
  "suggestions": [
    "GA weight recalibration in policyengine-us-data may close ~5-10%",
    "Consider whether fiscal note includes dynamic scoring effects PE doesn't model"
  ]
}
```

**Diagnosis categories:**

| Category | When | Action |
|----------|------|--------|
| `parameter-solvable` | You have untried interpretations but hit max iterations | Note remaining hypotheses |
| `data-level:state-systematic` | Matches known state bias (check MEMORY.md) | Accept with documented gap |
| `data-level:variable-missing` | PE doesn't have the relevant variable/parameter | Flag for policyengine-us PR |
| `data-level:population-gap` | CPS underrepresents affected group | Document limitation |
| `harness-uncertain` | The target itself may be wrong (low confidence harness) | Flag for human to validate target |

## Known State Biases (from MEMORY.md)

Use these to evaluate whether a residual is expected:

| State | Known Bias | Notes |
|-------|-----------|-------|
| MD | PE runs 13-17% below DLS | Consistent, data source gap |
| KS | PE at roughly half of DOR | Severe data gap |
| GA | +3.2% avg | Mild, no systematic direction |

If your residual matches a known bias pattern, classify as `data-level:state-systematic` and accept.

## Critical Rules

1. **NEVER STOP to ask the human during the loop.** Run autonomously until accept, plateau, or max iterations.
2. **NEVER modify compute_impacts.py or validation_harness.py.**
3. **Always save snapshots** before modifying params (the harness does this for you).
4. **Log every attempt** in calibration.tsv (the harness does this for you).
5. **Read past attempts** before proposing a new one — don't repeat failed hypotheses.
6. **Prefer simple explanations** — wrong parameter path is more likely than exotic interaction effects.
7. **Use the browse-parameters skill** or grep policyengine-us to verify parameter paths exist.

## Tools Available

- `Read`: Read calibration state, past logs, harness output
- `Bash`: Run auto_calibrate.py steps, browse PE parameter files
- `Grep/Glob`: Search policyengine-us parameters
- `Skill` (browse-parameters, policyengine-us-skill): Verify parameter paths
- `WebFetch`: Look up parameter documentation if needed

## Example Session

```
Read calibration_state.json
  → target: -$50M, PE: -$80M, diff: 60%, tolerance: 15%

Hypothesis 1: "Deduction is per-return, not per-person. Halve the value."
  → Modify reform_params: $7000 → $3500
  → Run experiment → PE: -$41M, diff: 18% → KEEP (improved from 60%)

Hypothesis 2: "Period range should extend to 2100 for permanent change."
  → Modify reform_params: "2026-01-01.2026-12-31" → "2026-01-01.2100-12-31"
  → Run experiment → PE: -$48M, diff: 4% → ACCEPT!

Done. Final params saved. diagnosis.json not needed (converged).
```
