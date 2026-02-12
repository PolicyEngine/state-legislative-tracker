# SB168: Accelerated Income Tax Elimination

- **ID**: `ga-sb168`
- **State**: Georgia
- **Bill text**: [SB168 on Georgia Legislature](https://www.legis.ga.gov/legislation/76095) | [LegiScan](https://legiscan.com/GA/bill/SB168/2025)
- **Sponsor**: Sen. Bo Hatchett (R)
- **Status**: Passed Senate, referred to House Ways & Means
- **Analysis years**: 2026-2031

## Summary

SB168 accelerates Georgia's income tax elimination by increasing the annual rate reduction from 0.10 percentage points to 1.0 percentage point per year, removes the revenue trigger conditions, and eliminates the 4.99% rate floor. This would reduce the flat income tax rate from 5.09% to 0% by 2031.

## Rate Schedule

| Year | Rate | Cut from baseline |
|------|------|-------------------|
| Baseline | 5.09% | - |
| 2026 | 4.19% | -0.90pp |
| 2027 | 3.19% | -1.90pp |
| 2028 | 2.19% | -2.90pp |
| 2029 | 1.19% | -3.90pp |
| 2030 | 0.19% | -4.90pp |
| 2031 | 0.00% | -5.09pp (full elimination) |

## Reform Parameters

All 30 bracket rates (5 filing statuses x 6 brackets) are set to the same value per year:

```
gov.states.ga.tax.income.main.{filing_status}.brackets[0-5].rate
```

Filing statuses: `joint`, `single`, `separate`, `surviving_spouse`, `head_of_household`

Year-specific values:
| Period | Rate |
|--------|------|
| 2026-01-01.2026-12-31 | 0.0419 |
| 2027-01-01.2027-12-31 | 0.0319 |
| 2028-01-01.2028-12-31 | 0.0219 |
| 2029-01-01.2029-12-31 | 0.0119 |
| 2030-01-01.2030-12-31 | 0.0019 |
| 2031-01-01.2100-12-31 | 0.0000 |

## Multi-Year Impacts

### Revenue Impact

| Year | Rate | Revenue Impact | Avg Benefit/HH |
|------|------|----------------|-----------------|
| 2026 | 4.19% | **-$2.82B** | $741 |
| 2027 | 3.19% | **-$5.86B** | $1,531 |
| 2028 | 2.19% | **-$9.18B** | $2,385 |
| 2029 | 1.19% | **-$13.16B** | $3,407 |
| 2030 | 0.19% | **-$17.49B** | $4,511 |
| 2031 | 0.00% | **-$18.97B** | $4,874 |

### Poverty Impact

| Year | Baseline Poverty | Reform Poverty | Change |
|------|------------------|----------------|--------|
| 2026 | 24.56% | 24.47% | -0.38% |
| 2027 | 23.38% | 23.19% | -0.83% |
| 2028 | 23.10% | 22.86% | -1.04% |
| 2029 | 22.80% | 22.51% | -1.29% |
| 2030 | 22.61% | 22.20% | -1.79% |
| 2031 | 22.34% | 21.83% | -2.29% |

### Child Poverty Impact

| Year | Baseline | Reform | Change |
|------|----------|--------|--------|
| 2026 | 24.37% | 24.28% | -0.36% |
| 2027 | 23.01% | 22.74% | -1.18% |
| 2028 | 22.61% | 22.33% | -1.26% |
| 2029 | 22.18% | 21.87% | -1.40% |
| 2030 | 22.00% | 21.57% | -1.96% |
| 2031 | 21.63% | 21.02% | -2.81% |

### Winners & Losers

| Year | Winners | No Change | Losers |
|------|---------|-----------|--------|
| 2026 | 64.8% | 34.7% | 0.4% |
| 2027 | 67.7% | 31.9% | 0.5% |
| 2028 | 68.6% | 30.9% | 0.4% |
| 2029 | 70.1% | 29.5% | 0.4% |
| 2030 | 70.7% | 29.0% | 0.3% |
| 2031 | 71.4% | 28.3% | 0.3% |

Note: ~0.3-0.5% of households lose due to the SALT deduction interaction. When state taxes decrease, itemizers' SALT deduction shrinks, which can increase federal taxes by more than the state tax savings. 100% of losers are itemizers, concentrated in income deciles 5-8.

### Decile Impact (Relative Change in Net Income, 2031)

| Decile | Change | Avg Benefit |
|--------|--------|-------------|
| 1 | +0.72% | $138 |
| 2 | +1.25% | $538 |
| 3 | +1.46% | $890 |
| 4 | +1.74% | $1,305 |
| 5 | +1.83% | $1,613 |
| 6 | +2.08% | $2,193 |
| 7 | +2.55% | $3,240 |
| 8 | +2.43% | $3,778 |
| 9 | +3.33% | $6,709 |
| 10 | +5.69% | $40,980 |

### District Impacts (2026, first year)

| District | Avg Benefit | Winners | Losers | Poverty Change |
|----------|-------------|---------|--------|----------------|
| GA-1 | $551 | 63% | 0% | -0.62% |
| GA-2 | $335 | 58% | 1% | -0.05% |
| GA-3 | $680 | 66% | 0% | -0.13% |
| GA-4 | $1,002 | 69% | 0% | -0.35% |
| GA-5 | $1,205 | 70% | 0% | -0.83% |
| GA-6 | $905 | 69% | 0% | -0.97% |
| GA-7 | $1,185 | 71% | 1% | -0.46% |
| GA-8 | $431 | 60% | 1% | -0.00% |
| GA-9 | $457 | 61% | 0% | -0.27% |
| GA-10 | $606 | 65% | 0% | -0.66% |
| GA-11 | $1,423 | 70% | 0% | -0.55% |
| GA-12 | $538 | 63% | 1% | -0.12% |
| GA-13 | $389 | 59% | 0% | -0.11% |
| GA-14 | $543 | 65% | 1% | -0.02% |

## Benchmark Validation

| Source | Estimate | Notes |
|--------|----------|-------|
| **PolicyEngine (2026)** | -$2.82B | 0.90pp cut, 5.09% to 4.19% |
| **GBPI fiscal note** | ~$3.4B | Extrapolated from $748M per 0.20pp (2024 analysis) |
| **Difference** | ~17% | Within acceptable range given different methodologies, base years, and extrapolation |

The GBPI (Georgia Budget and Policy Institute) estimate is based on their 2024 analysis of the previous incremental rate cuts. The extrapolation assumes a linear relationship between rate cuts and revenue loss, which may overestimate at larger cuts due to behavioral responses.

## Versions

- PolicyEngine US: `1.555.0`
- Dataset: `1.61.2`
- Computed: 2026-02-12
