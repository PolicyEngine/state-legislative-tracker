# Safe Approach to PE-US Data Improvements

**Status**: Design — do not implement without regression harness
**Context**: Our reform diagnostic identified state-level income gaps (e.g., GA AGI +19%).
We want to improve the data, but changes to any stage of the pipeline can cascade
unpredictably. This doc maps the risk and proposes a safe approach.

## 1. The Problem

State-level reform estimates diverge from fiscal notes partly due to data quality.
We traced this to the fact that `policyengine-us-data` calibrates income variables
nationally but only calibrates state populations — not state income.

**The temptation**: Add state-level income targets to `build_loss_matrix()`.
**The risk**: Weight changes that fix GA could break NY, or degrade national totals.

## 2. All Stages That Could Cause State-Level Gaps

### Stage 1: Raw CPS (Census Current Population Survey)
- **What it is**: The survey microdata before any PE processing
- **State-level risks**:
  - Small states have tiny CPS samples (WY ~300 HHs, ND ~400)
  - High-income earners are undersampled (top-coding at $999,999)
  - Non-response bias varies by state
  - State FIPS assignment can be wrong for edge cases
- **What we can change**: Nothing (this is the input data)
- **What we can do**: Document which states have reliable sample sizes

### Stage 2: Imputation (QRF — Quantile Random Forest)
- **What it is**: Fills in variables CPS doesn't collect (investment income, capital
  gains, etc.) using a model trained on CPS + PUF data
- **File**: `extended_cps.py`, `utils/qrf.py`
- **State-level risks**:
  - Model is trained on national data — doesn't learn state-specific income patterns
  - If GA has unusually high investment income, the national model won't capture that
  - Imputed values are plausible nationally but may be wrong for any given state
- **What we could change**: Train state-specific or region-specific QRF models
- **Risk**: Overfitting to small state samples, loss of national consistency
- **Regression check needed**: Compare imputed distributions before/after per state

### Stage 3: Uprating
- **What it is**: Scales historical CPS values to future years using growth factors
- **File**: `utils/uprating.py`
- **State-level risks**:
  - Growth factors are NATIONAL (from PE parameter `gov.irs.uprating`)
  - If GA income grew 8% but the national factor is 5%, GA values are 3% too low
  - Compounds over multiple years of uprating
- **What we could change**: State-specific uprating factors
- **Risk**: Need reliable state-level growth data (BEA personal income by state?)
- **Regression check needed**: Before/after uprating accuracy per state

### Stage 4: Reweighting (build_loss_matrix)
- **What it is**: Adjusts household weights so weighted totals match calibration targets
- **File**: `utils/loss.py`
- **Current targets** (documented in us-data-calibration-targets.md):
  - National: IRS SOI income by AGI bracket × filing status (~100+ targets)
  - National: CBO program totals (income tax, SNAP, SS, SSI, UI)
  - National: Treasury EITC, IRS EITC by child count
  - National: Census population by single-year age
  - National: Hard-coded totals (healthcare, rent, etc.)
  - **State**: Population by state + under-5 by state (ONLY state-level targets)
- **What we could change**: Add state-level income targets
- **Risk**: Multi-objective optimization — improving one target can degrade others
- **Regression check needed**: Full SOI comparison before/after

## 3. The Regression Harness (REQUIRED before any changes)

Before modifying any stage of the pipeline, we need to measure the current state
of ALL targets, then measure again after the change.

### 3.1 Existing Tool

`soi.py` already has `compare_soi_replication_to_soi()` which compares PE output
against IRS SOI across all variables and AGI brackets. This is the national-level
regression test.

### 3.2 What's Missing

- **State-level regression test**: For each state, compare PE state income tax
  revenue, household count, and income distribution against public data
- **Cross-state impact test**: When adding a target for GA, verify that all other
  states didn't get worse
- **National target preservation test**: Verify national SOI targets still hold
  within acceptable tolerance

### 3.3 Proposed Regression Test Flow

```python
def regression_test(before_dataset, after_dataset, year):
    """Compare all targets before and after a data change."""
    
    # 1. National SOI comparison
    before_soi = compare_soi_replication_to_soi(pe_to_soi(before_dataset, year), get_soi(year))
    after_soi = compare_soi_replication_to_soi(pe_to_soi(after_dataset, year), get_soi(year))
    
    # 2. State-level income comparison (all states)
    for state in ALL_STATES:
        before_revenue = compute_state_revenue(before_dataset, state, year)
        after_revenue = compute_state_revenue(after_dataset, state, year)
        
    # 3. Verdict
    national_degraded = after_soi["Absolute relative error"].mean() > before_soi["Absolute relative error"].mean() * 1.05
    any_state_blown = any(after_state_error > before_state_error * 1.50 for state)
    
    if national_degraded:
        return "REJECT: national targets degraded"
    if any_state_blown:
        return "REJECT: state {x} degraded by >50%"
    return "ACCEPT: improvement without regression"
```

## 4. Safe Improvement Strategy

### Phase 0: Baseline Measurement (do this FIRST)
Run the full regression test on the CURRENT dataset. Store results.
This gives us the "before" snapshot for every future comparison.

```bash
python scripts/regression_test.py --dataset current --year 2026 --save-baseline
```

### Phase 1: Diagnose (what we've built)
- Reform-specific data diagnostics identify which variables are off per state
- Three-way comparison: PE state vs external vs internal targets
- Accumulate findings across reforms

### Phase 2: Rank Improvements by Impact × Safety
For each finding, estimate:
- **Impact**: How many reforms would improve if this were fixed?
- **Feasibility**: Which pipeline stage is the fix in?
- **Risk**: How many other targets could be affected?

| Improvement | Impact | Stage | Risk | Priority |
|---|---|---|---|---|
| Add state AGI targets | High (all rate reforms) | Reweighting | Medium (could shift other states) | Research |
| State-specific uprating | Medium (reduces compound drift) | Uprating | Low (isolated per state) | High |
| Region-specific QRF | Medium (better imputation) | Imputation | High (could overfit) | Research |
| Better CPS sample for small states | Low (few reforms in small states) | Raw data | None (can't change) | N/A |

### Phase 3: Test Each Improvement Individually
For each proposed change:
1. Apply the change to a copy of the dataset
2. Run the full regression test
3. Compare before/after for ALL targets
4. Only merge if: target state improved AND no other state/national degraded beyond tolerance

### Phase 4: The Autoresearch Loop (only after Phases 0-2)
Once we have the regression harness and baseline measurements, THEN we can
do the autoresearch cycle:

```
Iteration 1: Add GA state AGI target to loss matrix
  → Re-run calibration
  → Regression test: national OK, GA improved, FL degraded slightly
  → KEEP (FL degradation < 5% threshold)

Iteration 2: Add state-specific uprating for GA
  → Re-run full pipeline
  → Regression test: GA improved further, national OK
  → KEEP

Iteration 3: Add NY state AGI target
  → Re-run calibration
  → Regression test: NY improved but NJ degraded 12%
  → DISCARD — NJ impact too large

Iteration 4: Add NY + NJ state AGI targets together
  → Re-run calibration
  → Regression test: both improved, national OK
  → KEEP
```

## 5. What NOT to Do

- **Don't add state targets without the regression harness** — you won't know what broke
- **Don't modify build_loss_matrix on a per-reform basis** — the data should be general, not tuned to one bill
- **Don't assume reweighting is the only fix** — the gap might be in imputation or uprating
- **Don't skip the national check** — a state improvement that degrades national totals is net negative
- **Don't change multiple stages at once** — impossible to attribute improvement/regression

## 6. Implementation Order

1. **Build regression harness** (measure all targets, before/after comparison)
2. **Run baseline measurement** on current dataset
3. **Implement state-specific uprating** (safest, most isolated change)
4. **Test state-level reweighting targets** (one state at a time, with regression)
5. **Consider region-specific imputation** (highest risk, most research needed)

Each step is its own PR to policyengine-us-data with the regression test results included.
