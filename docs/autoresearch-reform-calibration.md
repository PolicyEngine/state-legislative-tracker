# Autonomous Reform Calibration

**Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch)**

## 1. Core Concept

Apply the autoresearch pattern — autonomous iterative experimentation with a clear metric and automatic keep/discard — to reform parameter mapping in the state legislative tracker.

**The problem**: When encoding a bill, the first parameter mapping attempt often produces PE estimates that diverge significantly from external estimates. Currently this is a manual, single-shot process with human review. An autonomous loop could iterate on the mapping until the estimate converges, or diagnose why it can't.

**The autoresearch analogy**:

| autoresearch | Reform Calibration |
|---|---|
| `train.py` (single modifiable file) | `reform_params` JSON (single modifiable artifact) |
| `val_bpb` (lower is better) | `\|PE - target\| / \|target\|` (lower is better) |
| 5-minute experiment | 2-5 min `compute_impacts.py` run |
| Git commit + keep/discard | Supabase write + keep/revert |
| `program.md` (strategy instructions) | Bill text + provisions + harness estimates (fixed context) |
| `prepare.py` (immutable evaluation) | Validation harness + `compute_impacts.py` (immutable evaluation) |
| Agent modifies architecture/hyperparams | Agent modifies parameter paths, period ranges, values |

---

## 2. Architecture Overview

```
HARNESS (immutable per-run)              AGENT (mutable per-run)
-------                                  -----

Revenue data (census, IRS SOI)           reform_params JSON
Tax expenditure reports                    modify each iteration
Similar bill database
Fiscal notes (when available)
Back-of-envelope calculators
  |
  v
Target estimate + confidence band
  |
  v
compute_impacts.py (deterministic)  <--- reform_params
  |
  v
|PE - target| / |target|  <--- the metric
  |
  v
Within band? --> ACCEPT
Improving?   --> KEEP, continue
Plateau?     --> DIAGNOSE residual
```

**Separation of concerns**: The agent can never change how impacts are computed or what the target estimate is. It can only change its interpretation of the bill (the reform_params). This prevents gaming the metric — identical to autoresearch's immutable `prepare.py`.

---

## 3. The Validation Harness

The harness is the most critical component. It constructs the validation target that the calibration loop optimizes against. Not every bill has a fiscal note, so the harness must generate targets from multiple strategies.

### 3.1 Strategy 1: Fiscal Note (gold standard)

```
Source:   State fiscal analyst office (e.g., Utah LFA, Maryland DLS)
Signal:   Strongest -- actual microdata-based estimate from state tax agency
Output:   Point estimate + source URL
Confidence: HIGH
```

When a fiscal note exists, it is the primary target. The harness still runs other strategies as cross-checks, but the fiscal note anchors the target.

### 3.2 Strategy 2: Revenue-Base Reasoning

For rate changes, derive the impact mechanically from public data:

```python
# Example: GA cuts income tax rate 5.49% -> 5.39%
state_income_tax_revenue = 12_000_000_000  # From census / state tax agency
rate_change_pct = (5.49 - 5.39) / 5.49     # -1.82%
estimate = state_income_tax_revenue * rate_change_pct  # -$218M
```

**Data sources** (all public):
- State income tax revenue: Census Bureau State Government Tax Collections
- Federal tax data: IRS Statistics of Income (SOI) by state
- Income distribution: Census ACS / CPS ASEC

**Applicable to**: Rate changes, bracket adjustments (with income distribution data), standard deduction changes.

**Confidence**: HIGH for simple rate changes, MEDIUM for bracket/deduction changes (requires income distribution assumptions).

### 3.3 Strategy 3: Tax Expenditure Reports

Most states publish annual tax expenditure reports showing the cost of each credit and deduction.

```
Source:   State comptroller / revenue department annual report
Signal:   Upper-bound for existing programs, scaling factor for changes
Example:  CT EITC costs $223M total (tax expenditure report)
          PE says $56M = 25% of report (known CPS data gap)
          Bill doubles CT EITC --> expect PE at ~$112M
```

**Applicable to**: Changes to existing credits/deductions where the state reports current cost.

**Confidence**: MEDIUM (tax expenditure reports use different data and methodology than PE).

### 3.4 Strategy 4: Similar Bills / Companion Bills

```
Source:   Same bill from prior session, analogous bill in another state,
          or omnibus line items containing the provision
Signal:   Scaled by population/income ratio
Example:  SC cut top rate 7% -> 6.5%, fiscal note $300M, pop 5.2M
          GA cutting 5.49% -> 5.39%, pop 10.8M
          Scaling: $300M * (10.8/5.2) * (0.10/0.50) = ~$124M
```

**Search order**:
1. Same bill from prior legislative session (identical title/sponsors)
2. Companion bill in other chamber
3. Omnibus bill line items containing this provision
4. Analogous bill in similar-sized state

**Confidence**: MEDIUM (scaling introduces assumptions about state-specific factors).

### 3.5 Strategy 5: Back-of-Envelope from Bill Text

Parse the bill's own numbers and compute directly:

```
Bill says: "Increase standard deduction from $5,400 to $7,000 for single filers"
Compute:
  delta = $1,600 per single filer
  GA single filers ~ 2.1M (from IRS SOI)
  marginal rate ~ 5.39%
  estimate = 2.1M * $1,600 * 5.39% = ~$181M revenue loss
```

**Applicable to**: Any bill with explicit dollar amounts or rate changes.

**Confidence**: MEDIUM-LOW (ignores behavioral responses, interaction effects, but useful as sanity check).

### 3.6 Triangulation

The harness doesn't pick one strategy. It runs all applicable strategies and triangulates:

```
Strategy      Estimate    Confidence    Applies?
----------    --------    ----------    --------
Fiscal note   --          --            No (not published yet)
Revenue-base  -$218M      HIGH          Yes (rate change)
Tax expend.   --          --            No (not a credit)
Similar bill  -$124M      MEDIUM        Yes (found SC analog)
Envelope      -$181M      MEDIUM        Yes (standard calc)

Triangulation:
  Median of applicable: -$181M
  Range: -$124M to -$218M
  Spread: 43% (moderate agreement)

  Target: -$181M
  Confidence: MEDIUM (no fiscal note, 3 strategies within 2x)
  Tolerance band: +/- 25%
```

### 3.7 Tolerance Bands

Tolerance widens based on how confident we are in the target itself:

| Target Source | Confidence | Tolerance | Auto-loop? |
|---|---|---|---|
| Fiscal note alone | HIGH | +/- 15% | Yes |
| 3+ strategies agree within 30% | MEDIUM | +/- 25% | Yes |
| 2 strategies, moderate spread | LOW | +/- 40% | Yes, but flag |
| Only 1 strategy, or >2x spread | VERY LOW | -- | No auto-loop, human review |

---

## 4. The Inner Loop: Per-Bill Calibration

### 4.1 What the Agent Iterates On

Each "experiment" tries a different interpretation of the bill:

1. **Parameter path selection** -- same concept, different PE paths (e.g., `gov.states.ga.tax.income.main.single.brackets[0].rate` vs a flat rate param)
2. **Period range interpretation** -- `"2026-01-01.2026-12-31"` vs `"2026-01-01.2100-12-31"` vs multi-year explicit values
3. **COLA/uprating interaction** -- raw value vs manually COLA-adjusted per year
4. **Filing status handling** -- joint/single/HoH mapped separately or as one
5. **Value interpretation** -- pre-tax vs post-tax, per-return vs per-person, annual vs monthly
6. **Interaction effects** -- does adding a deduction cap change SALT behavior? Does a credit interact with refundability?

### 4.2 The Loop

```
Read: bill text + harness target + current reform_params + past attempts
  |
  v
Hypothesize: "Fiscal note is $50M, PE says $80M. The deduction might be
              per-return not per-person -- halving the value should bring
              PE closer to $50M"
  |
  v
Modify: reform_params in working copy
  |
  v
Run: python scripts/compute_impacts.py --reform-id {id} --force  (~3 min)
  |
  v
Compare: PE estimate vs harness target
  |
  v
Decision:
  - |discrepancy| decreased --> KEEP, log as "keep" in calibration.tsv
  - |discrepancy| increased --> REVERT, log as "discard"
  - Crash --> log as "crash", investigate
  |
  v
Repeat until:
  - Within tolerance band (success), or
  - Plateau detected (5+ attempts, <2% improvement), or
  - Max iterations reached (configurable, default 10)
```

### 4.3 Experiment Log (calibration.tsv)

One file per reform, stored in `results/{reform-id}/calibration.tsv`:

```
attempt  pe_estimate   target     tol    pct_diff  status    description
1        -$80.2M       -$50M      15%    60.4%     discard   "Initial: per-person interpretation"
2        -$41.1M       -$50M      15%    17.8%     keep      "Switch to per-return, fix period range"
3        -$48.3M       -$50M      15%    3.4%      keep      "Add COLA adjustment for 2027-2028"
ACCEPT   -$48.3M       -$50M      15%    3.4%      accept    "Within tolerance, final params saved"
```

### 4.4 Plateau Detection and Diagnosis

When the agent can't improve further, it produces a diagnosis classifying the residual:

```
attempt  pe_est    target    tol    pct_diff  status    description
1        -$80M     -$181M    25%    55.8%     discard   "Initial mapping"
2        -$120M    -$181M    25%    33.7%     keep      "Fixed period ranges"
3        -$125M    -$181M    25%    30.9%     keep      "Added COLA"
4        -$122M    -$181M    25%    32.6%     discard   "Filing status split -- worse"
5        -$126M    -$181M    25%    30.4%     discard   "Tried alt path -- marginal"
PLATEAU  -$125M    -$181M    25%    30.9%     diagnose  "See diagnosis below"
```

**Diagnosis categories**:

| Category | Meaning | Action |
|---|---|---|
| `parameter-solvable` | Still has untried interpretations | Continue loop or flag for human hints |
| `data-level:state-systematic` | Matches known state bias pattern (e.g., MD always -15%) | Apply known correction factor, accept |
| `data-level:variable-missing` | PE doesn't model the relevant concept at all | Flag for policyengine-us PR |
| `data-level:population-gap` | CPS underrepresents the affected population | Document limitation, accept with caveat |
| `harness-uncertain` | Target estimate itself may be wrong (low confidence) | Flag for human to validate the target |

---

## 5. The Outer Loop: Cross-Bill Learning

After N bills are calibrated, analyze residual patterns across bills. This is the equivalent of Karpathy reviewing overnight results and updating `program.md` or `prepare.py`.

### 5.1 State-Level Bias Detection

```
State   Bills  Avg Residual  Direction  Pattern
-----   -----  ------------  ---------  -------
MD      6      -15.2%        PE low     Consistent across all reform types
KS      3      -48.1%        PE low     Consistent
GA      8      +3.2%         Mixed      No systematic bias
UT      4      -7.8%         PE low     Mild, within tolerance
NC      2      -11.4%        PE low     Revenue-base reasoning confirms
```

### 5.2 Harness Strategy Calibration

When both a fiscal note AND other strategies exist for the same bill, compare them to calibrate the harness:

```
Revenue-base reasoning vs actual fiscal notes (when both exist):
  GA HB168:  revenue-base said -$218M, fiscal note said -$200M  (+9%)
  UT SB60:   revenue-base said -$85M,  fiscal note said -$78M   (+9%)
  NC HB123:  revenue-base said -$1.04B, fiscal note said -$950M (+9%)

  --> Revenue-base reasoning systematically overestimates by ~9%
  --> Apply 0.91 correction factor going forward
```

### 5.3 Outer Loop Actions

| Pattern Detected | Action |
|---|---|
| State systematic bias | Apply correction factor in harness; file issue on policyengine-us-data |
| Missing PE variable | PR to policyengine-us adding the variable; re-run inner loop after |
| Harness strategy bias | Update correction factor for that strategy |
| Data coverage gap | Document as known limitation; adjust tolerance bands for that state |

### 5.4 Feedback into Inner Loop

When the outer loop improves the infrastructure, the inner loop benefits:

```
Before: policyengine-us-data v1.1 (MD weights uncalibrated)
  MD bills plateau at ~15% under target
  Inner loop diagnoses: "data-level:state-systematic"

After: policyengine-us-data v1.2 (MD weights recalibrated)
  MD bills now start at ~5% under target
  Inner loop can close remaining gap with parameter tweaks
  More bills reach acceptance threshold
```

---

## 6. Error Source Taxonomy

Not all discrepancies are parameter mapping errors. The system must distinguish:

| Layer | Example | Fixable Per-Bill? | Blast Radius |
|---|---|---|---|
| **Parameter mapping** | Wrong path, wrong period range | Yes (inner loop) | 1 bill |
| **Value interpretation** | Per-person vs per-return, monthly vs annual | Yes (inner loop) | 1 bill |
| **PE-US variable logic** | Bug in existing variable, missing interaction | No -- PR to policyengine-us | All bills using that variable |
| **PE-US data coverage** | CPS doesn't capture a population well | No -- PR to policyengine-us-data | All bills in that state |
| **Systematic data gap** | MD consistently 15% low, KS at half | No -- fundamental CPS limitation | Structural |

The inner loop's job is to exhaust layers 1-2, then **diagnose** which of layers 3-5 explains the residual.

---

## 7. File Structure

```
scripts/
  auto_calibrate.py           # Inner loop harness (orchestrates experiments)
  validation_harness.py       # Target estimation strategies
  analyze_residuals.py        # Outer loop: cross-bill pattern analysis

.claude/agents/
  reform-calibrator.md        # Inner loop agent strategy (the "program.md")

results/
  {reform-id}/
    calibration.tsv           # Per-bill experiment log
    diagnosis.md              # Residual classification
    harness_output.json       # Target estimate + strategy breakdown

results/
  cross_bill_analysis.tsv     # Outer loop: state-level residual patterns
  harness_calibration.json    # Strategy correction factors
```

### 7.1 auto_calibrate.py (the orchestrator)

```python
"""
Autonomous reform calibration loop.
Analogous to autoresearch's experiment loop.

Usage:
  python scripts/auto_calibrate.py --reform-id ga-hb168 [--max-iterations 10]
"""

def run_experiment(reform_id, reform_params):
    """Write params to DB, run compute_impacts, return PE estimate.
    
    This is the immutable evaluation -- the agent cannot modify this.
    """
    # 1. Write reform_params to supabase
    # 2. Run: python compute_impacts.py --reform-id {id} --force
    # 3. Read back budgetary_impact.stateRevenueImpact
    # 4. Return PE estimate + metadata

def evaluate(pe_estimate, target, tolerance):
    """The metric -- like val_bpb in autoresearch."""
    pct_diff = abs(pe_estimate - target) / abs(target)
    within_band = pct_diff <= tolerance
    return pct_diff, within_band

def decide(current_pct, best_pct):
    """Keep or discard -- like autoresearch's git keep/reset."""
    if current_pct < best_pct:
        return "keep"
    return "discard"  # revert reform_params to previous best

def detect_plateau(history, window=3, threshold=0.02):
    """Detect when improvement has stalled."""
    if len(history) < window:
        return False
    recent = history[-window:]
    best = min(h["pct_diff"] for h in recent)
    worst = max(h["pct_diff"] for h in recent)
    return (worst - best) < threshold
```

### 7.2 validation_harness.py (target construction)

```python
"""
Multi-strategy validation harness.
Constructs target estimates when fiscal notes are unavailable.

Strategies:
  1. Fiscal note (direct lookup)
  2. Revenue-base reasoning (mechanical math from public data)
  3. Tax expenditure reports (scaling from state reports)
  4. Similar/companion bills (cross-state or cross-session)
  5. Back-of-envelope (from bill text numbers)
"""

def build_target(reform_id, state, bill_text, provisions):
    """Run all applicable strategies, triangulate, return target + confidence."""
    
    strategies = []
    
    # Strategy 1: fiscal note
    fiscal = find_fiscal_note(reform_id)
    if fiscal:
        strategies.append({"name": "fiscal_note", "estimate": fiscal.estimate,
                           "confidence": "high", "source": fiscal.url})
    
    # Strategy 2: revenue-base reasoning
    if is_rate_change(provisions):
        rev_est = revenue_base_estimate(state, provisions)
        strategies.append({"name": "revenue_base", "estimate": rev_est,
                           "confidence": "high", "source": "census/irs"})
    
    # Strategy 3: tax expenditure report
    tex_est = tax_expenditure_lookup(state, provisions)
    if tex_est:
        strategies.append({"name": "tax_expenditure", "estimate": tex_est,
                           "confidence": "medium", "source": tex_est.url})
    
    # Strategy 4: similar bills
    similar = find_similar_bills(state, provisions)
    if similar:
        strategies.append({"name": "similar_bill", "estimate": similar.scaled_estimate,
                           "confidence": "medium", "source": similar.source_bill})
    
    # Strategy 5: back-of-envelope
    envelope = back_of_envelope(state, provisions)
    if envelope:
        strategies.append({"name": "envelope", "estimate": envelope,
                           "confidence": "medium-low", "source": "computed"})
    
    return triangulate(strategies)

def triangulate(strategies):
    """Combine strategy estimates into target + confidence band."""
    # Median of applicable estimates
    # Confidence based on agreement spread
    # Tolerance band from confidence level
```

### 7.3 reform-calibrator.md (agent strategy)

The instructions given to the autonomous agent (analogous to `program.md`):

```markdown
# Reform Calibrator Agent

You are an autonomous reform calibration agent. Your goal is to minimize
the discrepancy between PolicyEngine's estimate and the validation target
by iterating on reform_params.

## What You Can Modify
- reform_params JSON (parameter paths, values, period ranges)

## What You Cannot Modify
- compute_impacts.py
- validation_harness.py
- The target estimate or tolerance band

## Experiment Loop
1. Read current reform_params, past calibration.tsv, bill text, harness output
2. Hypothesize why PE estimate differs from target
3. Modify reform_params to test hypothesis
4. Run experiment (auto_calibrate.py handles this)
5. Review result: keep or discard
6. Repeat

## Hypothesis Space (ordered by likelihood)
1. Wrong parameter path (most common)
2. Wrong period range (single year vs open-ended)
3. Value interpretation (per-person vs per-return)
4. Missing COLA/uprating adjustment
5. Filing status not properly split
6. Interaction effects (SALT, AMT, refundability)

## When to Stop
- PE estimate within tolerance band --> ACCEPT
- 5+ attempts with <2% improvement --> PLATEAU, write diagnosis
- Crash on 3 consecutive attempts --> STOP, flag for human

## Plateau Diagnosis
When you plateau, classify the residual:
- parameter-solvable: you have untried interpretations
- data-level:state-systematic: matches known state bias
- data-level:variable-missing: PE lacks the relevant variable
- data-level:population-gap: CPS underrepresents affected group
- harness-uncertain: the target itself may be wrong

NEVER STOP to ask the human during the loop. Run autonomously.
```

---

## 8. Integration with Existing Pipeline

The calibration loop slots into the existing `/encode-bill` pipeline between Phase 4 (write reform config) and Phase 6 (create PR):

```
Current pipeline:
  Phase 1: Research (bill-researcher + fiscal-finder)
  Phase 2: Parameter mapping (param-mapper)
  Phase 3: Model description (model-describer)
  Phase 4: Write to Supabase
  Phase 5: Compute impacts          <-- single shot
  Phase 6: Create PR

With auto-calibration:
  Phase 1: Research (bill-researcher + fiscal-finder)
  Phase 2: Parameter mapping (param-mapper) -- initial attempt
  Phase 3: Model description (model-describer)
  Phase 4: Write to Supabase
  Phase 4.5: Build validation target (harness)
  Phase 5: AUTO-CALIBRATION LOOP    <-- iterative
    5a: Compute impacts
    5b: Compare to target
    5c: If not converged, modify params, goto 5a
    5d: On convergence or plateau, write diagnosis
  Phase 6: Create PR (with calibration results in PR body)
```

The PR body gains a new section:

```markdown
## Calibration Results

| Attempt | PE Estimate | Target | Diff | Status | Change |
|---------|-------------|--------|------|--------|--------|
| 1 | -$80.2M | -$50M | 60.4% | discard | Initial per-person mapping |
| 2 | -$41.1M | -$50M | 17.8% | keep | Switched to per-return |
| 3 | -$48.3M | -$50M | 3.4% | keep | Added COLA for 2027-28 |

**Final discrepancy**: 3.4% (within 15% tolerance)
**Target source**: Fiscal note (Utah LFA)
**Iterations**: 3
```

---

## 9. Implementation Phases

### Phase 1: Validation Harness (foundation)
- Implement `validation_harness.py` with strategies 1 (fiscal note lookup) and 5 (back-of-envelope)
- These are the simplest and most universally applicable
- Test against existing bills where we know the fiscal note

### Phase 2: Inner Loop (core)
- Implement `auto_calibrate.py` orchestrator
- Write `reform-calibrator.md` agent instructions
- Test on 3-5 bills with known fiscal notes (validate that loop converges)

### Phase 3: Additional Harness Strategies
- Add strategy 2 (revenue-base reasoning) with Census/IRS data
- Add strategy 3 (tax expenditure reports) with state-specific sources
- Add strategy 4 (similar bills) with cross-state search

### Phase 4: Outer Loop
- Implement `analyze_residuals.py` for cross-bill patterns
- Build state-level bias database from accumulated results
- Feed correction factors back into harness

### Phase 5: Pipeline Integration
- Wire into `/encode-bill` as Phase 4.5-5
- Add calibration results to PR body template
- Update `reform-calibrator.md` with learnings from early runs
