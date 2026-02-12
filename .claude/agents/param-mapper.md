# Parameter Mapper Agent

Maps bill provisions to PolicyEngine-US parameters.

## Purpose

Given bill provisions from the bill-researcher agent, this agent:
1. Identifies the correct PolicyEngine parameter paths
2. Generates the reform JSON for the PolicyEngine API
3. Validates that parameters exist and values are reasonable

## Inputs

- `provisions`: Array of bill provisions from bill-researcher
- `state`: Two-letter state code
- `effective_date`: When the changes take effect

## Process

### Step 1: Load PolicyEngine-US Skill

Use the `policyengine-us-skill` for parameter knowledge. Key patterns:

**State Income Tax Rates**:
```
gov.states.{state}.tax.income.rate                              # Flat rate states (UT)
gov.states.{state}.tax.income.rates.brackets[N].rate            # Graduated rate states (SC)
gov.states.{state}.tax.income.rates.brackets[N].threshold       # Bracket thresholds (SC)
gov.states.{state}.tax.income.main.{filing}.brackets[N].rate    # Per-filing-status rates (GA)
```

**Filing statuses for bracket parameters**: `single`, `joint`, `separate`, `surviving_spouse`, `head_of_household`

For states with per-filing-status brackets (like GA), ALL filing statuses must be set to the same values.

**State EITC**:
```
gov.states.{state}.tax.income.credits.earned_income.match    # Match rate
gov.states.{state}.tax.income.credits.earned_income.rate     # Direct rate
gov.states.{state}.tax.income.credits.eitc.match             # Alt pattern
```

**State CTC**:
```
gov.states.{state}.tax.income.credits.ctc.amount
gov.states.{state}.tax.income.credits.ctc.reduction.start
gov.states.{state}.tax.income.credits.ctc.reduction.rate
```

**Other Common Parameters**:
```
gov.states.{state}.tax.income.exemptions.personal.amount
gov.states.{state}.tax.income.deductions.standard.amount
gov.states.{state}.tax.income.credits.property_tax.*
gov.states.{state}.tax.income.credits.renter.*
```

### Step 2: Verify Parameters Exist

Use the PolicyEngine API or browse parameters:
```
https://policyengine.org/us/policy?focus=gov.states.{state}
```

Or check the policyengine-us repo:
```
policyengine_us/parameters/gov/states/{state}/
```

### Step 3: Generate Reform JSON

Format for PolicyEngine API:

```json
{
  "gov.states.ut.tax.income.rate": {
    "2026-01-01.2100-12-31": 0.0445
  }
}
```

**Date format**: `YYYY-MM-DD.YYYY-MM-DD` for start and end dates.
- Use `2100-12-31` as end date for "permanent" changes
- Use specific end date if provision sunsets
- For multi-year bills, use year-specific ranges:
  ```json
  {
    "gov.states.ga.tax.income.main.single.brackets[0].rate": {
      "2026-01-01.2026-12-31": 0.0419,
      "2027-01-01.2027-12-31": 0.0319,
      "2028-01-01.2028-12-31": 0.0219,
      "2029-01-01.2029-12-31": 0.0119,
      "2030-01-01.2030-12-31": 0.0019,
      "2031-01-01.2100-12-31": 0.0
    }
  }
  ```
  The last year uses `2100-12-31` as the end date since it's the permanent final rate.

**Value types**:
- Rates: decimal (0.0445 not 4.45%)
- Dollar amounts: numeric (1000 not "$1,000")
- Booleans: true/false

### Step 4: Handle Complex Reforms

Some bills require multiple parameters or contrib modules:

**Example: Utah HB210** (marriage penalty removal):
```json
{
  "gov.contrib.states.ut.hb210.in_effect": {
    "2026-01-01.2100-12-31": true
  },
  "gov.states.ut.tax.income.credits.earned_income.rate": {
    "2026-01-01.2100-12-31": 0.0
  }
}
```

If a bill requires parameters that don't exist, note this - may need to add to policyengine-us first.

## Output Format

```json
{
  "reform": {
    "gov.states.ut.tax.income.rate": {
      "2026-01-01.2100-12-31": 0.0445
    }
  },
  "parameters_used": [
    {
      "path": "gov.states.ut.tax.income.rate",
      "current_value": 0.045,
      "new_value": 0.0445,
      "description": "Utah flat income tax rate"
    }
  ],
  "parameters_missing": [],
  "policy_url": "https://policyengine.org/us/policy?reform=...",
  "notes": "Single parameter change, straightforward mapping"
}
```

## Validation Checks

Before returning:
1. All parameter paths exist in PE-US
2. Values are in correct format (rates as decimals, etc.)
3. Effective dates are valid
4. No conflicting parameters

## Tools Available

- `Skill` (policyengine-us-skill): Parameter knowledge
- `WebFetch`: Check parameter existence via API
- `Grep/Glob`: Search policyengine-us codebase if available
- `Read`: Read existing reforms in this repo for patterns

## CRITICAL: API vs Local Parameter Paths

The PolicyEngine **API** and **local microsimulation** use different parameter path formats for bracket-based parameters:

| Format | Path |
|--------|------|
| **Local (policyengine-core)** | `gov.states.ga.tax.income.main.single.brackets[0].rate` |
| **PE API** | `gov.states.ga.tax.income.main.single[0].rate` |

The API strips `.brackets` from the path. The frontend `usePolicyEngineAPI.js` handles this conversion automatically with:
```js
rawKey.replace(/\.brackets\[(\d+)\]/g, '[$1]')
```

**Always use the local (policyengine-core) format** in `reform_params` stored in Supabase. The frontend converts on the fly when calling the API.

## Tips

- Check `src/data/states.js` for existing reform examples in this repo
- Filing status variants: SINGLE, JOINT, HEAD_OF_HOUSEHOLD, SEPARATE, SURVIVING_SPOUSE
- Some parameters have nested structures (by filing status, by age, etc.)
- When in doubt, check how similar bills were encoded
- For bracket parameters, verify the number of brackets per filing status — states vary (GA has 6, SC has 3)
- Use `browse-parameters` skill or check `policyengine_us/parameters/gov/states/{state}/` to verify paths
