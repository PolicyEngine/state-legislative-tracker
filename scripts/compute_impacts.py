#!/usr/bin/env python3
"""
Compute aggregate impacts for reforms using PolicyEngine API and Microsimulation.

This script creates policies and fetches economy-wide impacts including:
- Budgetary impact (cost to state)
- Poverty rate change
- Child poverty rate change
- District-level impacts (using Microsimulation)

Results can be saved to:
- JSON file (legacy, for local development)
- Supabase (production, via --supabase flag)
"""

import json
import os
import time
import requests
import argparse
from pathlib import Path
from datetime import datetime

# Import schema utilities
from db_schema import (
    format_budgetary_impact,
    format_poverty_impact,
    format_winners_losers,
    format_decile_impact,
    format_district_impact,
    format_reform_impacts_record,
)

# Try to import PolicyEngine for district-level calculations
try:
    from policyengine_us import Microsimulation
    from policyengine_core.reforms import Reform
    from policyengine_core.periods import instant
    from microdf import MicroSeries
    import numpy as np
    HAS_POLICYENGINE = True
except ImportError:
    HAS_POLICYENGINE = False
    print("Warning: policyengine-us not installed. District-level impacts will be skipped.")

# Try to import huggingface_hub for downloading state datasets
try:
    from huggingface_hub import hf_hub_download
    HAS_HF_HUB = True
except ImportError:
    HAS_HF_HUB = False
    print("Warning: huggingface_hub not installed. Will use default dataset.")

API_BASE = "https://api.policyengine.org"


def get_supabase_client():
    """Get Supabase client."""
    try:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if url and key:
            return create_client(url, key)
    except ImportError:
        pass
    return None


def load_reforms_from_db(supabase, reform_id=None):
    """
    Load reform configs from database.

    Reads from reform_impacts table (reform_params column) joined with research table.
    """
    # Query research + reform_impacts
    query = supabase.table("research").select(
        "id, state, title, description, url, reform_impacts(reform_params, computed)"
    ).eq("type", "bill")

    if reform_id:
        query = query.eq("id", reform_id)

    result = query.execute()

    reforms = []
    for r in result.data:
        impact_data = r.get("reform_impacts")
        if not impact_data:
            continue

        # Handle both single object and array responses
        if isinstance(impact_data, list):
            impact_data = impact_data[0] if impact_data else {}

        reform_params = impact_data.get("reform_params")
        if not reform_params:
            continue

        reforms.append({
            "id": r["id"],
            "state": r["state"].lower(),
            "label": r["title"],
            "reform": reform_params,
            "description": r.get("description", ""),
            "bill_url": r.get("url"),
            "computed": impact_data.get("computed", False),
        })

    return reforms


# Congressional district names by state
CONGRESSIONAL_DISTRICTS = {
    "UT": {
        1: "Congressional District 1",
        2: "Congressional District 2",
        3: "Congressional District 3",
        4: "Congressional District 4",
    },
    "SC": {
        1: "Congressional District 1",
        2: "Congressional District 2",
        3: "Congressional District 3",
        4: "Congressional District 4",
        5: "Congressional District 5",
        6: "Congressional District 6",
        7: "Congressional District 7",
    },
    "OK": {
        1: "Congressional District 1",
        2: "Congressional District 2",
        3: "Congressional District 3",
        4: "Congressional District 4",
        5: "Congressional District 5",
    }
}



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
    """
    Extract key impact metrics from economy API response.

    Returns data in the format expected by the frontend, using schema utilities.
    """
    # Budget impact
    budgetary_impact = None
    if "budget" in economy_data:
        budget = economy_data["budget"]
        budgetary_impact = format_budgetary_impact(
            state_revenue_impact=budget.get("state_tax_revenue_impact", budget.get("budgetary_impact", 0)),
            net_cost=budget.get("budgetary_impact", 0),
            households=budget.get("households"),
        )

    # Poverty impact
    poverty_impact = None
    child_poverty_impact = None
    if "poverty" in economy_data:
        poverty_data = economy_data["poverty"].get("poverty", {})

        if "all" in poverty_data:
            all_pov = poverty_data["all"]
            poverty_impact = format_poverty_impact(
                baseline_rate=all_pov.get("baseline", 0),
                reform_rate=all_pov.get("reform", 0),
            )

        if "child" in poverty_data:
            child_pov = poverty_data["child"]
            child_poverty_impact = format_poverty_impact(
                baseline_rate=child_pov.get("baseline", 0),
                reform_rate=child_pov.get("reform", 0),
            )

    # Winners/Losers from intra_decile
    winners_losers = None
    if "intra_decile" in economy_data:
        intra = economy_data["intra_decile"].get("all", {})
        winners_losers = format_winners_losers(
            gain_more_5pct=intra.get("Gain more than 5%", 0),
            gain_less_5pct=intra.get("Gain less than 5%", 0),
            no_change=intra.get("No change", 0),
            lose_less_5pct=intra.get("Lose less than 5%", 0),
            lose_more_5pct=intra.get("Lose more than 5%", 0),
        )

    # Decile impact - average change per income decile
    decile_impact = None
    if "decile" in economy_data:
        decile_data = economy_data["decile"]
        relative = {}
        absolute = {}

        if "average" in decile_data:
            avg = decile_data["average"]
            relative = {str(i): avg.get(str(i), 0) for i in range(1, 11)}

        if "income" in decile_data:
            income = decile_data["income"]
            absolute = {str(i): income.get(str(i), 0) for i in range(1, 11)}

        if relative or absolute:
            decile_impact = {"relative": relative, "absolute": absolute}

    # Inequality metrics
    inequality = None
    if "inequality" in economy_data:
        ineq = economy_data["inequality"]
        gini = ineq.get("gini", {})
        inequality = {
            "giniBaseline": gini.get("baseline", 0),
            "giniReform": gini.get("reform", 0),
        }

    # Return in format compatible with both JSON and Supabase
    return {
        "computed": True,
        "computedAt": datetime.utcnow().isoformat(),
        "budgetaryImpact": budgetary_impact,
        "povertyImpact": poverty_impact,
        "childPovertyImpact": child_poverty_impact,
        "winnersLosers": winners_losers,
        "decileImpact": decile_impact,
        "inequality": inequality,
    }


def get_state_dataset(state: str) -> str:
    """
    Download state-specific dataset from Hugging Face.

    Returns path to the downloaded H5 file.
    Raises exception if unavailable (no fallback to national dataset).
    """
    if not HAS_HF_HUB:
        raise RuntimeError("huggingface_hub not installed - cannot download state dataset")

    state_upper = state.upper()
    filename = f"states/{state_upper}.h5"

    print(f"    Downloading {state_upper} dataset from Hugging Face...")
    dataset_path = hf_hub_download(
        repo_id="policyengine/policyengine-us-data",
        filename=filename,
        repo_type="model",  # It's a model repo, not dataset repo
    )
    print(f"    Dataset ready: {dataset_path}")
    return dataset_path


def compute_district_impacts(state: str, reform_dict: dict, year: int = 2026) -> dict:
    """
    Compute district-level impacts using PolicyEngine Microsimulation.

    This runs a full microsimulation to get impacts by congressional district.
    Uses state-specific datasets from Hugging Face which include district geocoding.
    """
    if not HAS_POLICYENGINE:
        print("  Skipping district impacts (policyengine-us not installed)")
        return {}

    state_upper = state.upper()
    state_lower = state.lower()

    # Get state FIPS code for filtering
    STATE_FIPS = {
        "UT": 49, "CA": 6, "NY": 36, "TX": 48, "FL": 12, "SC": 45, "OK": 40,
        # Add more as needed
    }

    if state_upper not in STATE_FIPS:
        print(f"  Skipping district impacts (state {state_upper} not configured)")
        return {}

    state_fips = STATE_FIPS[state_upper]

    print("  Computing district-level impacts...")

    # Download state-specific dataset (has congressional district geocoding)
    # No fallback to national dataset - it would give wrong results
    try:
        state_dataset = get_state_dataset(state)
    except Exception as e:
        print(f"  Error downloading state dataset: {e}")
        print("  Skipping district impacts (state dataset required)")
        return {}

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

        # Run baseline and reform simulations using state-specific dataset
        print("    Running baseline simulation...")
        baseline = Microsimulation(dataset=state_dataset)

        print("    Running reform simulation...")
        reformed = Microsimulation(reform=ReformClass, dataset=state_dataset)

        # Get relevant variables
        baseline_income = baseline.calculate("household_net_income", year).values
        reform_income = reformed.calculate("household_net_income", year).values
        income_change = reform_income - baseline_income

        household_weight = baseline.calculate("household_weight", year).values
        household_count_people = baseline.calculate("household_count_people", year).values
        household_income_decile = baseline.calculate("household_income_decile", year).values
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

            # Winners share - match API's intra_decile_impact calculation exactly
            # API methodology:
            # 1. Calculate relative income change using capped values
            # 2. Use MicroSeries with weights for proper weighted sums
            # 3. Calculate proportion of winners per decile
            # 4. Average across 10 deciles
            district_baseline = baseline_income[in_district]
            district_reform = reform_income[in_district]
            absolute_change = district_reform - district_baseline
            capped_baseline = np.maximum(district_baseline, 1)
            capped_reform = np.maximum(district_reform, 1) + absolute_change
            relative_change = (capped_reform - capped_baseline) / capped_baseline

            # Create MicroSeries with weights (matching API pattern)
            district_people = MicroSeries(
                household_count_people[in_district],
                weights=district_weights
            )
            district_decile = household_income_decile[in_district]

            # API threshold: > 0.001 (0.1%) = winner
            is_winner = relative_change > 0.001

            # Calculate proportion of winners per decile, then average
            decile_proportions = []
            for decile in range(1, 11):
                in_decile = district_decile == decile
                if not np.any(in_decile):
                    decile_proportions.append(0.0)
                    continue
                people_in_decile = float(district_people[in_decile].sum())
                winners_in_decile = float(district_people[in_decile & is_winner].sum())
                proportion = winners_in_decile / people_in_decile if people_in_decile > 0 else 0.0
                decile_proportions.append(proportion)

            # Average across deciles (matching API's sum / 10)
            winners_share = sum(decile_proportions) / 10

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


def get_supabase_client():
    """Get Supabase client if available."""
    try:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if url and key:
            return create_client(url, key)
    except ImportError:
        pass
    return None


def write_to_supabase(supabase, reform_id: str, impacts: dict, reform_params: dict):
    """Write impacts to Supabase reform_impacts table."""
    # Convert camelCase to snake_case for Supabase columns
    record = {
        "id": reform_id,
        "computed": impacts.get("computed", True),
        "computed_at": impacts.get("computedAt"),
        "policy_id": impacts.get("policyId"),
        "budgetary_impact": impacts.get("budgetaryImpact"),
        "poverty_impact": impacts.get("povertyImpact"),
        "child_poverty_impact": impacts.get("childPovertyImpact"),
        "winners_losers": impacts.get("winnersLosers"),
        "decile_impact": impacts.get("decileImpact"),
        "inequality": impacts.get("inequality"),
        "district_impacts": impacts.get("districtImpacts"),
        "reform_params": reform_params,
    }

    # Upsert to handle both insert and update
    result = supabase.table("reform_impacts").upsert(record).execute()
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Compute aggregate impacts for reforms stored in Supabase"
    )
    parser.add_argument("--force", action="store_true", help="Force recomputation even if already computed")
    parser.add_argument("--districts-only", action="store_true", help="Only compute district impacts")
    parser.add_argument("--reform-id", type=str, help="Only process a specific reform ID")
    parser.add_argument("--list", action="store_true", help="List available reforms and exit")
    args = parser.parse_args()

    # Always require Supabase - reforms are stored there
    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL/SUPABASE_KEY not set")
        print("Run: source .env")
        return

    print("=" * 60)
    print("PolicyEngine Impact Calculator")
    print("=" * 60)

    # Load reforms from database
    reforms_to_process = load_reforms_from_db(supabase, args.reform_id)

    if not reforms_to_process:
        if args.reform_id:
            print(f"Error: Reform '{args.reform_id}' not found or has no reform_params")
        else:
            print("No reforms found with type='bill' and reform_params set")
        return

    # List mode - just show what's available
    if args.list:
        print(f"\nFound {len(reforms_to_process)} reforms:\n")
        for r in reforms_to_process:
            status = "computed" if r.get("computed") else "pending"
            print(f"  {r['id']:30} [{r['state'].upper()}] ({status})")
        return

    print(f"\nProcessing {len(reforms_to_process)} reform(s)...")

    results = {}

    for reform_config in reforms_to_process:
        reform_id = reform_config["id"]
        state = reform_config["state"]

        print(f"\n{'─' * 60}")
        print(f"Reform: {reform_config['label']}")
        print(f"ID: {reform_id} | State: {state.upper()}")
        print(f"{'─' * 60}")

        # Skip if already computed (unless forced)
        if not args.force and reform_config.get("computed"):
            print("  Already computed, skipping (use --force to recompute)")
            results[reform_id] = "skipped"
            continue

        # Districts-only mode: just update district impacts
        if args.districts_only:
            if not reform_config.get("computed"):
                print("  Not yet computed, skipping district-only update...")
                results[reform_id] = "skipped"
                continue
            print("  Computing district impacts only...")
            district_impacts = compute_district_impacts(
                state=state,
                reform_dict=reform_config["reform"],
            )
            if district_impacts:
                # Update just the district_impacts in Supabase
                supabase.table("reform_impacts").update({
                    "district_impacts": district_impacts
                }).eq("id", reform_id).execute()
                print("  District impacts updated in Supabase")
                results[reform_id] = "districts_updated"
            else:
                results[reform_id] = "no_districts"
            continue

        try:
            # Step 1: Create policy in PolicyEngine
            print("  [1/4] Creating policy in PolicyEngine API...")
            policy_id = create_policy(reform_config["reform"])
            print(f"        Policy ID: {policy_id}")

            # Step 2: Get economy impact
            print("  [2/4] Fetching economy impact (this may take a few minutes)...")
            economy_data = get_economy_impact(policy_id, state)

            # Step 3: Extract impacts using schema utilities
            print("  [3/4] Processing results...")
            impacts = extract_impacts(economy_data)
            impacts["policyId"] = policy_id

            # Step 4: Compute district-level impacts (local microsimulation)
            print("  [4/4] Computing district impacts...")
            district_impacts = compute_district_impacts(
                state=state,
                reform_dict=reform_config["reform"],
            )
            if district_impacts:
                impacts["districtImpacts"] = district_impacts

            # Write to Supabase
            print("  Writing to Supabase...")
            write_to_supabase(supabase, reform_id, impacts, reform_config["reform"])

            # Show summary
            budgetary = impacts.get("budgetaryImpact", {}).get("stateRevenueImpact", 0)
            print(f"\n  ✓ Complete!")
            print(f"    Revenue impact: ${budgetary:,.0f}")
            print(f"    Policy ID: {policy_id}")

            results[reform_id] = "computed"

        except Exception as e:
            print(f"  ✗ Error: {e}")
            results[reform_id] = f"error: {e}"

    # Summary
    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    for reform_id, status in results.items():
        print(f"  {reform_id}: {status}")


if __name__ == "__main__":
    main()
