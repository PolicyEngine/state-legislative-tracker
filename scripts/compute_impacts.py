#!/usr/bin/env python3
"""
Compute aggregate impacts for reforms using PolicyEngine API and Microsimulation.

This script creates policies and fetches economy-wide impacts including:
- Budgetary impact (cost to state)
- Poverty rate change
- Child poverty rate change
- District-level impacts (using Microsimulation)

Results are saved to a JSON file for use in the frontend.
"""

import json
import time
import requests
import argparse
from pathlib import Path

# Try to import PolicyEngine for district-level calculations
try:
    from policyengine_us import Microsimulation
    from policyengine_core.reforms import Reform
    from policyengine_core.periods import instant
    import numpy as np
    HAS_POLICYENGINE = True
except ImportError:
    HAS_POLICYENGINE = False
    print("Warning: policyengine-us not installed. District-level impacts will be skipped.")

API_BASE = "https://api.policyengine.org"

# Congressional district names by state
CONGRESSIONAL_DISTRICTS = {
    "UT": {
        1: "Congressional District 1",
        2: "Congressional District 2",
        3: "Congressional District 3",
        4: "Congressional District 4",
    }
}

# Define reforms to compute
REFORMS = [
    {
        "id": "ut-sb60-rate-cut",
        "state": "ut",
        "label": "Utah Income Tax Rate Cut (SB60)",
        "reform": {
            "gov.states.ut.tax.income.rate": {
                "2026-01-01.2100-12-31": 0.0445
            }
        }
    }
]


def create_policy(reform_data: dict) -> int:
    """Create a policy in PolicyEngine and return the policy ID."""
    response = requests.post(
        f"{API_BASE}/us/policy",
        json={"data": reform_data},
        headers={"Content-Type": "application/json"}
    )
    response.raise_for_status()
    result = response.json()
    return result["result"]["policy_id"]


def get_economy_impact(policy_id: int, region: str, baseline_id: int = 2, time_period: int = 2026, max_retries: int = 60):
    """
    Fetch economy-wide impact for a policy.

    Polls the API until computation is complete.
    """
    url = f"{API_BASE}/us/economy/{policy_id}/over/{baseline_id}"
    params = {"region": region, "time_period": time_period}

    for attempt in range(max_retries):
        response = requests.get(url, params=params)
        response.raise_for_status()
        result = response.json()

        if result["status"] == "ok":
            return result["result"]
        elif result["status"] == "computing":
            print(f"  Computing... (attempt {attempt + 1}/{max_retries})")
            time.sleep(10)
        else:
            raise Exception(f"API error: {result.get('message', 'Unknown error')}")

    raise TimeoutError(f"Economy computation did not complete after {max_retries} attempts")


def extract_impacts(economy_data: dict) -> dict:
    """Extract key impact metrics from economy API response."""
    impacts = {
        "computed": True,
        "computedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    # Budget impact - budgetary_impact is a float (negative = revenue loss)
    if "budget" in economy_data:
        budget = economy_data["budget"]
        budgetary_impact = budget.get("budgetary_impact", 0)
        impacts["budgetaryImpact"] = {
            "netCost": budgetary_impact,  # Negative = state loses revenue
            "stateRevenueImpact": budget.get("state_tax_revenue_impact", 0),
            "households": budget.get("households", 0),
        }

    # Poverty impact
    if "poverty" in economy_data:
        poverty_data = economy_data["poverty"].get("poverty", {})

        # Overall poverty
        if "all" in poverty_data:
            all_pov = poverty_data["all"]
            baseline = all_pov.get("baseline", 0)
            reform = all_pov.get("reform", 0)
            impacts["povertyImpact"] = {
                "baselineRate": baseline,
                "reformRate": reform,
                "change": reform - baseline,
                "percentChange": ((reform - baseline) / baseline * 100) if baseline > 0 else 0,
            }

        # Child poverty
        if "child" in poverty_data:
            child_pov = poverty_data["child"]
            baseline = child_pov.get("baseline", 0)
            reform = child_pov.get("reform", 0)
            impacts["childPovertyImpact"] = {
                "baselineRate": baseline,
                "reformRate": reform,
                "change": reform - baseline,
                "percentChange": ((reform - baseline) / baseline * 100) if baseline > 0 else 0,
            }

    # Winners/Losers from intra_decile
    if "intra_decile" in economy_data:
        intra = economy_data["intra_decile"].get("all", {})
        impacts["winnersLosers"] = {
            "gainMore5Pct": intra.get("Gain more than 5%", 0),
            "gainLess5Pct": intra.get("Gain less than 5%", 0),
            "loseLess5Pct": intra.get("Lose less than 5%", 0),
            "loseMore5Pct": intra.get("Lose more than 5%", 0),
            "noChange": intra.get("No change", 0),
        }

    # Decile impact - average change per income decile
    if "decile" in economy_data:
        decile_data = economy_data["decile"]
        # Average income change by decile (relative)
        if "average" in decile_data:
            avg = decile_data["average"]
            impacts["decileImpact"] = {
                "relative": {
                    str(i): avg.get(str(i), 0) for i in range(1, 11)
                }
            }
        # Absolute income change by decile
        if "income" in decile_data:
            income = decile_data["income"]
            if "decileImpact" not in impacts:
                impacts["decileImpact"] = {}
            impacts["decileImpact"]["absolute"] = {
                str(i): income.get(str(i), 0) for i in range(1, 11)
            }

    # Inequality metrics
    if "inequality" in economy_data:
        ineq = economy_data["inequality"]
        gini = ineq.get("gini", {})
        impacts["inequality"] = {
            "giniBaseline": gini.get("baseline", 0),
            "giniReform": gini.get("reform", 0),
        }

    return impacts


def compute_district_impacts(state: str, reform_dict: dict, year: int = 2026) -> dict:
    """
    Compute district-level impacts using PolicyEngine Microsimulation.

    This runs a full microsimulation to get impacts by congressional district.
    """
    if not HAS_POLICYENGINE:
        print("  Skipping district impacts (policyengine-us not installed)")
        return {}

    state_upper = state.upper()
    state_lower = state.lower()

    # Get state FIPS code for filtering
    STATE_FIPS = {
        "UT": 49, "CA": 6, "NY": 36, "TX": 48, "FL": 12,
        # Add more as needed
    }

    if state_upper not in STATE_FIPS:
        print(f"  Skipping district impacts (state {state_upper} not configured)")
        return {}

    state_fips = STATE_FIPS[state_upper]

    print("  Computing district-level impacts...")

    try:
        # Create reform class dynamically
        def create_reform_class(parameters):
            def modify_params(params):
                for param_path, values in parameters.items():
                    param = params
                    for key in param_path.split("."):
                        param = getattr(param, key)
                    for period, value in values.items():
                        # Convert API period format "2026-01-01.2100-12-31" to Instant objects
                        if "." in period:
                            start_str, stop_str = period.split(".")
                        else:
                            start_str = period
                            stop_str = "2100-12-31"
                        param.update(start=instant(start_str), stop=instant(stop_str), value=value)
                return params

            class DynamicReform(Reform):
                def apply(self):
                    self.modify_parameters(modify_params)

            return DynamicReform

        ReformClass = create_reform_class(reform_dict)

        # Run baseline and reform simulations
        print("    Running baseline simulation...")
        baseline = Microsimulation()

        print("    Running reform simulation...")
        reformed = Microsimulation(reform=ReformClass)

        # Get relevant variables
        baseline_income = baseline.calculate("household_net_income", year).values
        reform_income = reformed.calculate("household_net_income", year).values
        income_change = reform_income - baseline_income

        household_weight = baseline.calculate("household_weight", year).values
        state_code = baseline.calculate("state_code_str", year).values
        cd_geoid = baseline.calculate("congressional_district_geoid", year).values

        # Check if congressional district data is available
        unique_geoids = np.unique(cd_geoid)
        if len(unique_geoids) == 1 and unique_geoids[0] == 0:
            print("    Warning: Congressional district data not available in dataset")
            print("    District-level impacts require enhanced CPS data with district geocoding")
            return {}

        # Filter to state
        in_state = state_code == state_upper

        # Get poverty variables (not currently used but kept for future district poverty calc)
        # baseline_poverty = baseline.calculate("in_poverty", year).values
        # reform_poverty = reformed.calculate("in_poverty", year).values
        # person_weight = baseline.calculate("person_weight", year).values

        # Compute district impacts
        districts = CONGRESSIONAL_DISTRICTS.get(state_upper, {})
        district_impacts = {}

        for district_num, district_name in districts.items():
            # District GEOID format: state_fips * 100 + district_num (e.g., 4901 for UT-1)
            district_geoid = state_fips * 100 + district_num

            # Filter households in this district
            in_district = (cd_geoid == district_geoid) & in_state

            if not np.any(in_district):
                continue

            district_weights = household_weight[in_district]
            district_income_change = income_change[in_district]

            # Compute metrics
            total_households = float(np.sum(district_weights))
            total_benefit = float(np.sum(district_income_change * district_weights))
            avg_benefit = total_benefit / total_households if total_households > 0 else 0

            # Winners share (households with positive income change)
            winners = district_income_change > 1  # More than $1 gain
            winners_share = float(np.sum(district_weights[winners]) / total_households) if total_households > 0 else 0

            district_impacts[f"{state_upper}-{district_num}"] = {
                "districtName": district_name,
                "avgBenefit": round(avg_benefit, 0),
                "householdsAffected": round(total_households, 0),
                "totalBenefit": round(total_benefit, 0),
                "povertyChange": 0.0,  # TODO: compute per-district poverty change
                "winnersShare": round(winners_share, 2),
            }

            print(f"    District {district_num}: ${avg_benefit:.0f} avg benefit")

        return district_impacts

    except Exception as e:
        print(f"  Error computing district impacts: {e}")
        return {}


def main():
    parser = argparse.ArgumentParser(description="Compute aggregate impacts for reforms")
    parser.add_argument("--force", action="store_true", help="Force recomputation of all impacts")
    parser.add_argument("--districts-only", action="store_true", help="Only compute district impacts for existing reforms")
    args = parser.parse_args()

    output_path = Path(__file__).parent.parent / "src" / "data" / "reformImpacts.json"

    # Load existing impacts if any
    impacts = {}
    if output_path.exists():
        with open(output_path) as f:
            impacts = json.load(f)

    print("Computing aggregate impacts for reforms...")
    print("=" * 50)

    for reform_config in REFORMS:
        reform_id = reform_config["id"]
        state = reform_config["state"]

        print(f"\nProcessing: {reform_config['label']}")
        print(f"  State: {state.upper()}")

        # Districts-only mode: just update district impacts for existing data
        if args.districts_only:
            if reform_id not in impacts or not impacts[reform_id].get("computed"):
                print("  Not yet computed, skipping district-only update...")
                continue
            print("  Computing district impacts only...")
            district_impacts = compute_district_impacts(
                state=state,
                reform_dict=reform_config["reform"],
            )
            if district_impacts:
                impacts[reform_id]["districtImpacts"] = district_impacts
                print(f"  Done! District impacts updated.")
            else:
                print("  Keeping existing district data (if any).")
            continue

        # Skip if already computed (unless forced)
        if not args.force and reform_id in impacts and impacts[reform_id].get("computed"):
            print("  Already computed, skipping...")
            continue

        try:
            # Create policy
            print("  Creating policy...")
            policy_id = create_policy(reform_config["reform"])
            print(f"  Policy ID: {policy_id}")

            # Get economy impact
            print("  Fetching economy impact (this may take a few minutes)...")
            economy_data = get_economy_impact(policy_id, state)

            # Extract and save impacts
            impacts[reform_id] = extract_impacts(economy_data)
            impacts[reform_id]["policyId"] = policy_id
            impacts[reform_id]["state"] = state.upper()

            # Compute district-level impacts
            district_impacts = compute_district_impacts(
                state=state,
                reform_dict=reform_config["reform"],
            )
            if district_impacts:
                impacts[reform_id]["districtImpacts"] = district_impacts

            print(f"  Done! Impacts computed.")

        except Exception as e:
            print(f"  Error: {e}")
            impacts[reform_id] = {
                "computed": False,
                "error": str(e),
                "state": state.upper(),
            }

    # Save results
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(impacts, f, indent=2)

    print(f"\nResults saved to: {output_path}")
    print("\nSummary:")
    for reform_id, data in impacts.items():
        status = "Computed" if data.get("computed") else "Failed"
        print(f"  {reform_id}: {status}")


if __name__ == "__main__":
    main()
