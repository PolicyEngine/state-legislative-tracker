# Fiscal Finder Agent

Finds official fiscal notes and external analyses for validation.

## Purpose

Given a bill identifier, this agent:
1. Finds the official fiscal note/fiscal impact statement
2. Searches for think tank analyses (Tax Foundation, ITEP, CBPP, state policy centers)
3. Extracts revenue/cost estimates for comparison with PolicyEngine results

## Inputs

- `state`: Two-letter state code
- `bill_number`: Bill identifier
- `bill_title`: (optional) Title for better search results

## Process

### Step 1: Find Official Fiscal Note

Each state has a legislative fiscal office. Common patterns:

| State | Fiscal Note Source |
|-------|-------------------|
| UT | `le.utah.gov/~{year}/fiscalnotes/{bill}.pdf` |
| SC | `www.scstatehouse.gov` → Bill page → "Fiscal Impact" |
| OK | `oklegislature.gov` → Bill page → "Fiscal Analysis" |
| NY | `nyassembly.gov` → Bill page → "Fiscal Note" |
| CA | Legislative Analyst's Office (lao.ca.gov) |

### Step 2: Search Think Tanks

Search for external analyses:

```
"{bill_number}" "{state}" fiscal analysis site:taxfoundation.org
"{bill_number}" "{state}" site:itep.org
"{bill_number}" "{state}" site:cbpp.org
"{state}" "{bill_title}" tax analysis
```

State-specific policy centers:
- Utah: Utah Foundation, Kem C. Gardner Policy Institute
- South Carolina: SC Policy Council
- Oklahoma: Oklahoma Policy Institute
- New York: Fiscal Policy Institute
- California: California Budget & Policy Center

### Step 3: Extract Estimates

From each source, extract:
- Revenue impact (cost/savings to state)
- Time period (annual, 5-year, 10-year)
- Key assumptions
- Methodology notes

### Step 4: Back-of-Envelope Check

Do quick sanity math:
- If tax rate cut: `rate_change × tax_base ≈ revenue_impact`
- If credit expansion: `new_beneficiaries × avg_credit ≈ cost`

## Output Format

```json
{
  "fiscal_note": {
    "source": "Utah Office of the Legislative Fiscal Analyst",
    "url": "https://le.utah.gov/~2026/fiscalnotes/SB0060.pdf",
    "estimate": -83600000,
    "period": "annual",
    "effective_date": "2026-01-01",
    "methodology": "Static scoring based on tax return data",
    "notes": "Does not account for behavioral responses"
  },
  "external_analyses": [
    {
      "source": "Tax Foundation",
      "url": "https://taxfoundation.org/...",
      "estimate": -80000000,
      "period": "annual",
      "notes": "Estimates slightly lower due to dynamic scoring"
    }
  ],
  "back_of_envelope": {
    "calculation": "4.5% - 4.45% = 0.05% reduction × $16.7B tax base = $83.5M",
    "result": -83500000,
    "notes": "Matches fiscal note closely"
  },
  "consensus_range": {
    "low": -80000000,
    "high": -85000000,
    "midpoint": -82500000
  }
}
```

## Validation Thresholds

When comparing PolicyEngine results to fiscal notes:

| Difference | Status |
|------------|--------|
| < 10% | Excellent match |
| 10-25% | Acceptable (note methodology differences) |
| 25-50% | Review needed (check parameters) |
| > 50% | Likely error (re-check mapping) |

## Tools Available

- `WebSearch`: Find fiscal notes and analyses
- `WebFetch`: Fetch and extract content from URLs
- `Read`: Read cached documents

## Tips

- Fiscal notes may be PDFs - WebFetch can handle these
- Look for "dynamic" vs "static" scoring differences
- State fiscal notes often assume no behavioral response
- Think tanks may use different baseline years
- Check if estimate is annual or multi-year
