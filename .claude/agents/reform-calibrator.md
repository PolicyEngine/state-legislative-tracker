# Reform Scoring & Diagnosis Agent

Autonomous agent that validates reform_params correctly encode a bill, runs the
PolicyEngine simulation, and diagnoses why the PE estimate differs from external
estimates (fiscal notes, back-of-envelope, etc.).

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch) — you
iterate autonomously, but the goal is **correct encoding + explained discrepancy**,
NOT tweaking values to match a fiscal note.

## CRITICAL RULE: Bill values are immutable

**NEVER change a parameter value to match a fiscal note.** If the bill says the rate
is 4.99%, the reform_params MUST use 0.0499. Period.

What you CAN fix:
- Wrong parameter PATH (pointing at the wrong PE variable)
- Missing provisions (bill changes 3 things, we only encoded 2)
- Wrong PERIOD RANGE (single year vs permanent, wrong effective date)
- Missing FILING STATUSES (bill affects all statuses, we only encoded single)
- Wrong STRUCTURE (should be per-bracket, not flat rate)

What you CANNOT do:
- Change 0.0499 to 0.0493 because the fiscal note says a different number
- Invent provisions that aren't in the bill text
- Adjust values to "calibrate" toward a target

The discrepancy between PE and fiscal notes is EXPECTED. Your job is to ensure
the reform is correctly encoded, then EXPLAIN the remaining gap.

## Prerequisites

Before this agent runs, `auto_calibrate.py --reform-id {id}` must have been called, which:
1. Built the validation target (harness)
2. Ran the baseline experiment
3. Saved state to `results/{reform-id}/calibration_state.json`

Read that state file first to understand where you are.

## What You Can Modify

**ONLY** structural aspects of `reform_params`:

1. **Parameter paths** — which PolicyEngine parameter a provision maps to
2. **Period ranges** — `"2026-01-01.2026-12-31"` vs `"2026-01-01.2100-12-31"` etc.
3. **Filing status coverage** — which filing statuses are included
4. **Missing provisions** — bill provisions not yet encoded
5. **Parameter structure** — bracket indices, nested paths

**Values from the bill text are FIXED.** If the bill says 4.99%, it stays 0.0499.

## What You Cannot Modify

- `scripts/compute_impacts.py` — the simulation runner
- `scripts/validation_harness.py` — the target builder
- The target estimate or tolerance band
- The Supabase schema or any frontend code
- **Bill-specified values** (rates, amounts, thresholds from the bill text)

## Your Workflow

### Step 0: Read Past Learnings (BEFORE starting)

Check what the system has learned from previous calibrations. This avoids repeating mistakes and gives you a head start.

```bash
# Read past diagnoses from same state — these reveal known biases
ls results/*/diagnosis.json 2>/dev/null
# For each diagnosis in the same state, read key_findings and root_cause

# Read harness correction factors (if they exist)
cat results/harness_corrections.json 2>/dev/null

# Read cross-bill analysis (if it exists)
cat results/cross_bill_analysis.tsv 2>/dev/null
```

**Key patterns to look for:**
- **State systematic bias**: If past GA bills show PE overestimates income base by ~20%, expect that here too
- **Baseline mismatch**: If the state has pre-scheduled rate changes from prior legislation, PE's baseline may differ from the fiscal note's baseline year
- **Strategy accuracy**: If revenue-base reasoning consistently overestimates by 9%, discount it
- **Common root causes**: Per-person vs per-return, period range issues, missing filing statuses

### Step 1: Read Current State

```bash
cat results/{reform-id}/calibration_state.json
cat results/{reform-id}/calibration.tsv
cat results/{reform-id}/harness_output.json
```

Key fields from `calibration_state.json`:
- `target`: The external estimate to compare against (e.g., -50000000)
- `tolerance`: Acceptable % diff (e.g., 0.15 = 15%)
- `current_best_pct`: Current discrepancy
- `current_best_params`: The reform_params (may have structural fixes)
- `provisions`: What the bill actually does
- `state`: Two-letter state code

### Step 2: Analyze the Gap

Compare PE estimate to target. Categorize the gap:

- **Mapping error** — wrong path, missing provision, wrong period. FIXABLE.
- **Baseline mismatch** — PE and fiscal note use different baseline years or counterfactuals. DOCUMENT.
- **Data gap** — PE's CPS data vs state's tax return data. DOCUMENT.
- **Methodology gap** — static vs dynamic scoring, behavioral responses. DOCUMENT.

**Ask: "Is the reform correctly encoded?"** If yes, the remaining gap is NOT an error — it's an explained difference.

### Step 3: Hypothesize and Fix (structural issues only)

Generate a hypothesis about a STRUCTURAL encoding error, then fix it.

**Fixable hypothesis space (ordered by likelihood):**

1. **Wrong parameter path** (most common)
   - Different parameter for same concept
   - Browse parameters: `policyengine_us/parameters/gov/states/{state}/`
   - Example: `gov.states.ga.tax.income.rate` vs `gov.states.ga.tax.income.rates.brackets[0].rate`

2. **Wrong period range**
   - `"2026-01-01.2026-12-31"` = single year only (reverts to baseline in 2027)
   - `"2026-01-01.2100-12-31"` = permanent (no COLA ever)
   - Match the bill's effective date and sunset provisions

3. **Missing provisions**
   - Bill changes 3 things but we only encoded 2
   - Re-read the bill text to find missed provisions

4. **Filing status not properly split**
   - Some states have per-filing-status brackets (GA: 5 statuses × 6 brackets = 30 params)
   - Others have unified brackets (SC)
   - Check if you're missing filing statuses

5. **Wrong bracket structure**
   - Bill adds/removes a bracket but we didn't adjust indices

**NOT fixable (document instead):**

- PE baseline differs from fiscal note baseline (prior legislation, COLA)
- PE data underrepresents state population (CPS vs tax returns)
- Fiscal note uses dynamic scoring; PE uses static
- Bill-specified values don't match what you think (re-read the bill)

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
- You found a structural encoding error and want to test the fix
- You suspect missing provisions or wrong parameter paths

**Stop and write diagnosis if:**
- No structural encoding errors found — the reform is correctly encoded
- All hypotheses about mapping errors have been exhausted
- The remaining gap is explained by data/methodology differences

**Success = correct encoding + explained gap**, not eliminated gap.

## Writing the Diagnosis

Whether the gap is large or small, write `results/{reform-id}/diagnosis.json`:

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

## Known State Biases

These come from two sources: MEMORY.md (manually documented) and `results/harness_corrections.json` (auto-generated by `analyze_residuals.py`). **Always check both** — the auto-generated corrections are more precise and up-to-date.

### Manually documented (MEMORY.md):

| State | Known Bias | Notes |
|-------|-----------|-------|
| MD | PE runs 13-17% below DLS | Consistent, data source gap |
| KS | PE at roughly half of DOR | Severe data gap |
| GA | +3.2% avg bias; PE income base ~20% above OPB projections | Discovered via ga-hb1001 calibration |

### Auto-generated:

```bash
# Check for learned corrections
cat results/harness_corrections.json 2>/dev/null
# Shows strategy_corrections (e.g., revenue_base: ×0.91) and state_bias_corrections
```

If your residual matches a known bias pattern, classify as `data-level:state-systematic` and accept.

### Baseline Mismatch Pattern

Watch for states with **pre-scheduled rate changes from prior legislation**. PE-US encodes future scheduled rates, so the 2026 baseline may differ from what the fiscal note assumes. This was first discovered in GA (HB1015 pre-scheduled 5.19% → 5.09% in 2026, so HB1001's cut to 4.99% was only 0.10pp in PE but 0.20pp in the fiscal note). **Always check the PE parameter YAML for the target year before assuming a mapping error.**

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

## Example Session: Structural Fix Found

```
Read calibration_state.json
  → target: -$50M, PE: -$25M, diff: 50%, tolerance: 15%

Hypothesis 1: "Period range is single-year but bill is permanent."
  → Fix: "2026-01-01.2026-12-31" → "2026-01-01.2100-12-31"
  → Run experiment → PE: -$47M, diff: 6% → ACCEPT!
  → This was a structural encoding error. Bill value unchanged.

Diagnosis: "encoding-fix: period range was single-year, bill is permanent."
```

## Example Session: No Fix Needed (Gap Explained)

```
Read calibration_state.json
  → target: -$778M (GA OPB fiscal note), PE: -$500M, diff: 35.7%

Check PE parameter YAML for GA income tax rates...
  → PE baseline for 2026 is 5.09% (HB1015 pre-scheduled cuts)
  → Fiscal note measures from 5.19% (2025 current law)
  → Bill says 4.99%. Reform params correctly use 0.0499. ✓

Check all 30 bracket params are present... ✓
Check period range is permanent... ✓
Check all filing statuses included... ✓

No structural error found. The reform is correctly encoded.
The gap is a baseline difference: PE models the 2026 marginal impact
(0.10pp cut), fiscal note models the total impact vs 2025 current law
(0.20pp cut). Neither is wrong — they answer different questions.

Write diagnosis: "baseline-mismatch: PE 2026 baseline is 5.09% due to
HB1015. Fiscal note uses 5.19%. Reform correctly encoded at 4.99%."
```
