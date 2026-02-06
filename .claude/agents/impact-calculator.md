# Impact Calculator Agent

Computes policy impacts using the PolicyEngine API.

## Purpose

Given a reform JSON, this agent:
1. Calls the PolicyEngine API to compute impacts
2. Extracts budgetary, poverty, distributional, and district-level impacts
3. Formats results for the database

## Inputs

- `reform`: Reform JSON from param-mapper
- `state`: Two-letter state code
- `year`: Tax year for simulation (default: 2026)

## Process

### Step 1: Create Policy in PolicyEngine

Use the PolicyEngine API or web interface:

**Option A: Web Interface**
1. Go to `https://policyengine.org/us/policy`
2. Navigate to the parameters
3. Set values
4. Copy policy_id from URL: `?reform=95604`

**Option B: API** (preferred for automation)
```python
import requests

# Create reform
response = requests.post(
    "https://api.policyengine.org/us/policy",
    json={"data": reform}
)
policy_id = response.json()["result"]["policy_id"]
```

### Step 2: Compute State-Level Impacts

```python
# Get economy-wide impacts for state
response = requests.get(
    f"https://api.policyengine.org/us/economy/{policy_id}/over/1",
    params={
        "region": state.lower(),  # e.g., "ut", "sc"
        "time_period": year
    }
)
```

Extract from response:
- `budgetary_impact`: Net cost to government
- `poverty_impact`: Change in poverty rate
- `inequality_impact`: Gini coefficient change
- `decile_impact`: Average benefit by income decile
- `winners_losers`: Share gaining/losing

### Step 3: Compute District-Level Impacts

For each congressional district:

```python
for district in range(1, num_districts + 1):
    response = requests.get(
        f"https://api.policyengine.org/us/economy/{policy_id}/over/1",
        params={
            "region": f"{state.lower()}-{district}",  # e.g., "ut-1"
            "time_period": year
        }
    )
```

Note: Some states have at-large districts (1 district total).

### Step 4: Format Results

Structure for database:

```python
{
    "id": "ut-sb60",
    "policy_id": 95604,
    "computed": True,
    "computed_at": "2026-02-06T12:00:00Z",
    "policyengine_us_version": "1.250.0",  # Get from API
    "dataset_name": "enhanced_cps_2024",
    "dataset_version": "1.0.0",
    "budgetary_impact": {
        "netCost": -68584763.34,
        "households": 1058819.89,
        "stateRevenueImpact": -69871183.91
    },
    "poverty_impact": {
        "change": -0.00057,
        "reformRate": 0.1534,
        "baselineRate": 0.1540,
        "percentChange": -0.372
    },
    "child_poverty_impact": {
        "change": -0.00049,
        "reformRate": 0.138,
        "baselineRate": 0.1385,
        "percentChange": -0.358
    },
    "winners_losers": {
        "noChange": 0.5545,
        "gainLess5Pct": 0.4454,
        "gainMore5Pct": 0.0,
        "loseLess5Pct": 0.0,
        "loseMore5Pct": 0.0
    },
    "decile_impact": {
        "relative": {
            "1": 5.95,
            "2": 14.70,
            "3": 23.58,
            "4": 29.75,
            "5": 35.54,
            "6": 44.69,
            "7": 54.23,
            "8": 64.21,
            "9": 94.75,
            "10": 429.92
        }
    },
    "inequality": {
        "giniReform": 0.4504,
        "giniBaseline": 0.4504
    },
    "district_impacts": {
        "UT-1": {
            "avgBenefit": 68.0,
            "districtName": "Congressional District 1",
            "totalBenefit": 18166908.0,
            "winnersShare": 0.46,
            "povertyChange": 0.0,
            "householdsAffected": 268102.0
        }
        # ... more districts
    }
}
```

## Congressional Districts by State

| State | Districts |
|-------|-----------|
| UT | 4 |
| SC | 7 |
| OK | 5 |
| NY | 26 |
| CA | 52 |
| TX | 38 |

At-large states (1 district): AK, DE, ND, SD, VT, WY

## Output Format

Return the complete impact data structure ready for database insertion.

## Tools Available

- `Bash`: Run Python scripts for API calls
- `WebFetch`: Alternative for simple API calls
- `Skill` (policyengine-api-skill): API patterns

## Tips

- API calls can be slow - budget 30-60 seconds per computation
- Cache results to avoid re-computation
- Check API status if getting errors
- Some metrics may return null for small populations
- District computations are optional but valuable for visualization
