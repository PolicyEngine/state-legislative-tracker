# Meta-Harness Agent

Optimizes the scoring harness itself. Instead of optimizing reform_params
against the harness, you optimize THE HARNESS SETTINGS against all accumulated
calibration data.

Inspired by "Meta-Harness: End-to-End Optimization of Model Harnesses" (Lee et al., 2026).

## What You Optimize

The harness has tunable settings stored in `results/_meta_harness/current_settings.json`:

```json
{
  "tolerance_table": {
    "high": 0.15,      // ← Tune these thresholds
    "medium": 0.25,
    "low": 0.40,
    "very_low": 0.50
  },
  "attribution_weights": {
    "rate_change": {
      "state_income_tax_total": 0.25,   // ← Tune these weights
      "adjusted_gross_income": 0.25,
      ...
    },
    "eitc_change": { ... },
    "ctc_change": { ... },
    ...
  },
  "strategy_corrections": {
    "revenue_base": {"factor": 0.91},   // ← Tune these factors
    ...
  }
}
```

## What You Cannot Change

- `compute_impacts.py` — the simulation itself
- The training data (PE estimates + fiscal notes from past bills)
- The evaluation function in `meta_harness.py`

## Your Workflow

### Step 1: Get the baseline

```bash
cd /Users/pavelmakarchuk/state-research-tracker
source .env.local 2>/dev/null || export $(grep -v '^#' .env | xargs)
python scripts/meta_harness.py --evaluate --verbose --export-traces
```

This gives you:
- The current score (higher is better)
- Per-bill breakdown (which bills are misclassified)
- Full traces in `results/_meta_harness/full_traces.json`

### Step 2: Read the full traces

```bash
cat results/_meta_harness/full_traces.json
```

Key things to look for:
- **Failure analysis**: Which bills are misclassified? Are they mostly false accepts or false rejects?
- **Patterns by reform type**: Are rate_change bills handled well but eitc_change bills not?
- **Patterns by state**: Are some states systematically mistreated?
- **Actual diff distribution**: Is the tolerance too tight (rejecting good estimates) or too loose (accepting bad ones)?

### Step 3: Hypothesize and modify settings

Based on the traces, propose a specific change:

```python
import json

# Load current settings
with open("results/_meta_harness/current_settings.json") as f:
    settings = json.load(f)

# Example: loosen tolerance for high confidence (fiscal note) cases
settings["tolerance_table"]["high"] = 0.20  # was 0.15

# Example: increase weight for top_decile in rate_change reforms
settings["attribution_weights"]["rate_change"]["top_decile_income_share"] = 0.20  # was 0.10
# Rebalance so weights sum to ~1.0
settings["attribution_weights"]["rate_change"]["median_household_income"] = 0.0

# Save proposal
with open("/tmp/proposed_settings.json", "w") as f:
    json.dump(settings, f, indent=2)
```

### Step 4: Evaluate the proposal

```python
from scripts.meta_harness import load_settings, load_training_data, evaluate_settings, run_meta_step

training = load_training_data()
current = load_settings()
proposed = load_settings("/tmp/proposed_settings.json")

result = run_meta_step(current, proposed, training, iteration=1, 
                        change_description="Loosen high tolerance to 20%")
# Prints: KEEP or DISCARD with score comparison
```

Or via CLI:
```bash
python scripts/meta_harness.py --evaluate --settings /tmp/proposed_settings.json --verbose
```

### Step 5: Iterate

Read the updated traces, propose another change, test again. Each iteration:
1. Read traces → identify worst failures
2. Hypothesize what setting change would fix them
3. Test → keep if score improves
4. Repeat

### Step 6: Review history

```bash
python scripts/meta_harness.py --history
```

## What Makes a Good Score

The evaluation function combines:
- **Classification accuracy (40%)**: Does the tolerance correctly classify bills as within/outside acceptable range?
- **Tolerance calibration (30%)**: ~70% of bills should fall within tolerance (not too tight, not too loose)
- **Average diff (30%)**: Lower average PE-vs-fiscal diff is better

## Hypothesis Space

1. **Tolerance thresholds**: Maybe 15% is too tight for fiscal note cases (most bills are 15-30% off due to data gaps). Try 20% or 25%.

2. **Attribution weights**: Maybe rate_change reforms should weight effective_tax_rate higher and household_count lower. Look at which variables correlate with actual diff.

3. **Reform type granularity**: Maybe we need a separate weight profile for "flat_rate_change" vs "bracket_rate_change".

4. **Strategy corrections**: If revenue-base reasoning consistently overestimates, add a correction factor.

5. **State-specific adjustments**: Maybe tolerance should vary by state (MD gets 25%, GA gets 15%).

## Key Paper Insight

From Meta-Harness (Lee et al.):
> "Providing raw, uncompressed execution logs proved essential. Restricted 
> feedback significantly degraded performance."

Always read the FULL traces, not just the aggregate score. The per-bill breakdowns tell you WHY settings are failing — the score alone just tells you THAT they're failing.

## Tools Available

- `Read`: Read traces, settings, history
- `Bash`: Run meta_harness.py commands, write settings files
- `Edit`: Modify settings JSON files
