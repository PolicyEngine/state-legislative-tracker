# PE-US Data Calibration Targets (Internal Reference)

**Source**: `policyengine_us_data/utils/loss.py` — `build_loss_matrix()`

This documents the internal calibration targets that `policyengine-us-data` uses
when reweighting the Enhanced CPS. These are the benchmarks the data is TRYING to
match. Our diagnostic should compare against these to determine whether a gap is:

1. **Data not calibrated for this** → No target exists → improvement opportunity
2. **Calibrated but not hitting target** → Target exists, PE output differs → weight issue
3. **Hitting target but target is wrong** → Target ≠ external benchmark → target update needed

## Calibration Target Sources

### 1. IRS SOI (Statistics of Income)
**File**: `soi.csv` in storage folder
**Variables calibrated** (by AGI bracket × filing status):
- `adjusted_gross_income` (total)
- `count` (number of returns)
- `employment_income`
- `business_net_profits`
- `capital_gains_gross`
- `ordinary_dividends`
- `partnership_and_s_corp_income`
- `qualified_dividends`
- `taxable_interest_income`
- `total_pension_income`
- `total_social_security`

**Aggregate-only variables** (not broken by AGI bracket):
- `business_net_losses`, `capital_gains_distributions`, `capital_gains_losses`
- `estate_income`, `estate_losses`, `exempt_interest`, `ira_distributions`
- `partnership_and_s_corp_losses`, `rent_and_royalty_net_income/losses`
- `taxable_pension_income`, `taxable_social_security`, `unemployment_compensation`

**Key detail**: SOI targets are NATIONAL, not state-level. The reweighting uses
national SOI targets — state-level accuracy is a side effect of population-by-state
targets (see below), not direct income calibration per state.

### 2. Census Population Projections
**File**: `np2023_d5_mid.csv`
**Variables**: Single-year age populations (age 0 through 85)
- `census/population_by_age/{age}` for each age 0-85

### 3. CBO Program Projections
**Parameters**: `calibration.gov.cbo.*`
- `income_tax`
- `snap`
- `social_security`
- `ssi`
- `unemployment_compensation`

### 4. Treasury Tax Expenditures
**Parameters**: `calibration.gov.treasury.tax_expenditures.*`
- `eitc` (total EITC spending)

### 5. IRS EITC Statistics
**File**: `eitc.csv`
- EITC returns by number of qualifying children (0, 1, 2+)
- EITC spending by number of qualifying children

### 6. Hard-Coded National Totals
- `health_insurance_premiums_without_medicare_part_b`: $385B
- `other_medical_expenses`: $278B
- `medicare_part_b_premiums`: $112B
- `over_the_counter_health_expenses`: $72B
- `spm_unit_spm_threshold`: $3,945B
- `child_support_expense/received`: $33B
- `spm_unit_capped_work_childcare_expenses`: $348B
- `spm_unit_capped_housing_subsidy`: $35B
- `tanf`: $9B
- `alimony_income/expense`: $13B
- `real_estate_taxes`: $400B
- `rent`: $735B

### 7. Healthcare Spending by Age
**File**: `healthcare_spending.csv`
- 10-year age bands × 4 expense types

### 8. State Population Targets
**File**: `population_by_state.csv`
- Total population by state
- Population under 5 by state

**CRITICAL**: This is the ONLY state-level calibration target. Income variables
are calibrated nationally, then state populations are adjusted. This means
state-level income accuracy depends entirely on whether the national income
distribution + state population weights produce correct state income totals.

## Implications for Data Diagnostics

### What IS calibrated at state level
- Population count (total and under 5)
- That's it.

### What is NOT calibrated at state level
- Total state income tax revenue
- AGI distribution
- Employment income
- Number of filers
- Any income component

This explains why state-level income metrics (AGI, revenue) can be 15-20%+ off
even when national totals are well calibrated. The diagnostic should:

1. Compare PE state output against IRS SOI (external benchmark)
2. Compare PE NATIONAL output against SOI targets (internal check)
3. If national is on target but state is off → state weight distribution issue
4. If national is also off → calibration not converging for this variable

## The Three-Way Comparison

```
                    PE state output
                         │
           ┌─────────────┼─────────────┐
           ▼              ▼             ▼
    vs IRS SOI       vs National     National SOI target
    (state-level     PE output       vs state-level
     external)       (is national    benchmark
                      on target?)    (does a target
                                      even exist?)
```

| National on target? | State on target? | Diagnosis |
|---|---|---|
| Yes | Yes | Data is good |
| Yes | No | State weight distribution issue |
| No | No | National calibration gap |
| No | Yes | Lucky cancellation — investigate |
