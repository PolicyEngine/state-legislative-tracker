# Browse PolicyEngine Parameters

Browse available PolicyEngine-US parameters for a state to understand what can be modeled.

## Arguments
- `$ARGUMENTS` - State code (e.g., "UT", "NY", "CA")

## Workflow

### Step 1: Fetch Parameter Tree
Fetch the parameter structure from PolicyEngine GitHub:

```
https://github.com/PolicyEngine/policyengine-us/tree/master/policyengine_us/parameters/gov/states/{state_lower}/
```

Or use the API to explore:
```
https://api.policyengine.org/us/parameters
```

### Step 2: Common Parameter Paths
For state income tax modeling, common parameters include:

**Income Tax Rates:**
- `gov.states.{state}.tax.income.rate` - Flat rate states
- `gov.states.{state}.tax.income.rates.rate` - Bracketed rate states
- `gov.states.{state}.tax.income.rates.thresholds` - Bracket thresholds

**Credits:**
- `gov.states.{state}.tax.income.credits.eitc.match` - State EITC match rate
- `gov.states.{state}.tax.income.credits.ctc.*` - Child Tax Credit
- `gov.states.{state}.tax.income.credits.cdcc.*` - Child/Dependent Care Credit

**Deductions:**
- `gov.states.{state}.tax.income.deductions.standard.*` - Standard deduction
- `gov.states.{state}.tax.income.deductions.itemized.*` - Itemized deductions

**Exemptions:**
- `gov.states.{state}.tax.income.exemptions.personal.*` - Personal exemption
- `gov.states.{state}.tax.income.exemptions.dependent.*` - Dependent exemption

### Step 3: Output Format
List available parameters with:
- Parameter path
- Current value(s)
- Description
- Unit (currency, percentage, etc.)

## Example Usage

```
/browse-parameters UT
/browse-parameters NY
```
