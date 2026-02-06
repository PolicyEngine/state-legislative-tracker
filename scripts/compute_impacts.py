#!/usr/bin/env python3
"""
Compute aggregate impacts for reforms using PolicyEngine API and Microsimulation.

This is the ONLY entry point for computing reform impacts. All computation goes
through this script for reproducibility and auditability.

Usage:
    python scripts/compute_impacts.py --reform-id sc-h4216
    python scripts/compute_impacts.py --list
    python scripts/compute_impacts.py --force --reform-id ut-sb60

The script:
1. Reads reform configs from Supabase (reform_impacts.reform_params)
2. Calls PolicyEngine API for economy-wide impacts
3. Runs local Microsimulation for district-level impacts
4. Writes results back to Supabase
"""

import argparse
import os
import time
from datetime import datetime

import numpy as np
import requests

# Import schema utilities for consistent data formatting
from db_schema import (
    format_budgetary_impact,
    format_poverty_impact,
    format_winners_losers,
    format_decile_impact,
    format_district_impact,
)

# =============================================================================
# CONFIGURATION
# =============================================================================

API_BASE = "https://api.policyengine.org"

# State FIPS codes for district filtering
STATE_FIPS = {
    "AL": 1, "AK": 2, "AZ": 4, "AR": 5, "CA": 6, "CO": 8, "CT": 9, "DE": 10,
    "FL": 12, "GA": 13, "HI": 15, "ID": 16, "IL": 17, "IN": 18, "IA": 19,
    "KS": 20, "KY": 21, "LA": 22, "ME": 23, "MD": 24, "MA": 25, "MI": 26,
    "MN": 27, "MS": 28, "MO": 29, "MT": 30, "NE": 31, "NV": 32, "NH": 33,
    "NJ": 34, "NM": 35, "NY": 36, "NC": 37, "ND": 38, "OH": 39, "OK": 40,
    "OR": 41, "PA": 42, "RI": 44, "SC": 45, "SD": 46, "TN": 47, "TX": 48,
    "UT": 49, "VT": 50, "VA": 51, "WA": 53, "WV": 54, "WI": 55, "WY": 56,
    "DC": 11,
}

# Number of congressional districts per state (2023 apportionment)
STATE_DISTRICTS = {
    "AL": 7, "AK": 1, "AZ": 9, "AR": 4, "CA": 52, "CO": 8, "CT": 5, "DE": 1,
    "FL": 28, "GA": 14, "HI": 2, "ID": 2, "IL": 17, "IN": 9, "IA": 4,
    "KS": 4, "KY": 6, "LA": 6, "ME": 2, "MD": 8, "MA": 9, "MI": 13,
    "MN": 8, "MS": 4, "MO": 8, "MT": 2, "NE": 3, "NV": 4, "NH": 2,
    "NJ": 12, "NM": 3, "NY": 26, "NC": 14, "ND": 1, "OH": 15, "OK": 5,
    "OR": 6, "PA": 17, "RI": 2, "SC": 7, "SD": 1, "TN": 9, "TX": 38,
    "UT": 4, "VT": 1, "VA": 11, "WA": 10, "WV": 2, "WI": 8, "WY": 1,
    "DC": 0,  # DC has no voting representative
}


# =============================================================================
# SUPABASE CLIENT
# =============================================================================

def get_supabase_client():
    """Get Supabase client. Returns None if credentials not set."""
    try:
        from supabase import create_client
    except ImportError:
        print("Error: supabase package not installed")
        print("Run: pip install supabase")
        return None

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        return None

    return create_client(url, key)


def load_reforms_from_db(supabase, reform_id=None):
    """
    Load reform configs from database.

    Returns list of reform dicts with: id, state, label, reform, computed
    """
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

        # Handle both single object and array responses from Supabase
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


# =============================================================================
# POLICYENGINE API
# =============================================================================

def create_policy(reform_data: dict) -> int:
    """
    Create a policy in PolicyEngine and return the policy ID.

    Raises:
        requests.HTTPError: If API request fails
        KeyError: If response doesn't contain policy_id
    """
    response = requests.post(
        f"{API_BASE}/us/policy",
        json={"data": reform_data},
        headers={"Content-Type": "application/json"}
    )
    response.raise_for_status()
    result = response.json()

    if "result" not in result or "policy_id" not in result["result"]:
        raise KeyError(f"Unexpected API response: {result}")

    return result["result"]["policy_id"]


def get_economy_impact(policy_id: int, region: str, time_period: int = 2026) -> dict:
    """
    Fetch economy-wide impact for a policy.

    Polls the API until computation is complete (up to 10 minutes).

    Args:
        policy_id: PolicyEngine policy ID
        region: State code (e.g., "ut", "sc")
        time_period: Year for simulation

    Returns:
        Economy impact data from API

    Raises:
        TimeoutError: If computation doesn't complete in time
        requests.HTTPError: If API request fails
    """
    url = f"{API_BASE}/us/economy/{policy_id}/over/2"
    params = {"region": region, "time_period": time_period}
    max_retries = 60  # 10 minutes at 10s intervals

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
            raise RuntimeError(f"API error: {result.get('message', 'Unknown error')}")

    raise TimeoutError(f"Economy computation timed out after {max_retries * 10} seconds")


def extract_impacts(economy_data: dict) -> dict:
    """
    Extract key impact metrics from economy API response.

    Uses schema utilities to ensure frontend-compatible format.

    Raises:
        KeyError: If required data is missing from API response
    """
    # Budget impact - REQUIRED
    if "budget" not in economy_data:
        raise KeyError("API response missing 'budget' data")

    budget = economy_data["budget"]
    # Try state_tax_revenue_impact first (state-level), fall back to budgetary_impact
    revenue_impact = budget.get("state_tax_revenue_impact")
    if revenue_impact is None:
        revenue_impact = budget.get("budgetary_impact")
    if revenue_impact is None:
        raise KeyError("API response missing revenue impact in 'budget'")

    budgetary_impact = format_budgetary_impact(
        state_revenue_impact=revenue_impact,
        households=budget.get("households"),
    )

    # Poverty impact - REQUIRED
    if "poverty" not in economy_data:
        raise KeyError("API response missing 'poverty' data")

    poverty_data = economy_data["poverty"].get("poverty", {})

    if "all" not in poverty_data:
        raise KeyError("API response missing 'poverty.poverty.all'")
    all_pov = poverty_data["all"]
    poverty_impact = format_poverty_impact(
        baseline_rate=all_pov["baseline"],
        reform_rate=all_pov["reform"],
    )

    if "child" not in poverty_data:
        raise KeyError("API response missing 'poverty.poverty.child'")
    child_pov = poverty_data["child"]
    child_poverty_impact = format_poverty_impact(
        baseline_rate=child_pov["baseline"],
        reform_rate=child_pov["reform"],
    )

    # Winners/Losers - REQUIRED
    if "intra_decile" not in economy_data:
        raise KeyError("API response missing 'intra_decile' data")

    intra = economy_data["intra_decile"].get("all", {})
    winners_losers = format_winners_losers(
        gain_more_5pct=intra["Gain more than 5%"],
        gain_less_5pct=intra["Gain less than 5%"],
        no_change=intra["No change"],
        lose_less_5pct=intra["Lose less than 5%"],
        lose_more_5pct=intra["Lose more than 5%"],
    )

    # Decile impact - REQUIRED
    if "decile" not in economy_data:
        raise KeyError("API response missing 'decile' data")

    decile_data = economy_data["decile"]
    if "average" not in decile_data:
        raise KeyError("API response missing 'decile.average'")

    # Extract average values for deciles 1-10
    avg = decile_data["average"]
    decile_values = [avg[str(i)] for i in range(1, 11)]
    decile_impact = format_decile_impact(decile_values)

    # Inequality - optional but log if missing
    inequality = None
    if "inequality" in economy_data:
        ineq = economy_data["inequality"]
        gini = ineq.get("gini", {})
        inequality = {
            "giniBaseline": gini.get("baseline"),
            "giniReform": gini.get("reform"),
        }

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


# =============================================================================
# DISTRICT-LEVEL COMPUTATION (Local Microsimulation)
# =============================================================================

def get_state_dataset(state: str) -> str:
    """
    Download state-specific dataset from Hugging Face.

    Returns path to the downloaded H5 file.

    Raises:
        ImportError: If huggingface_hub not installed
        Exception: If download fails
    """
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        raise ImportError(
            "huggingface_hub not installed. Run: pip install huggingface_hub"
        )

    state_upper = state.upper()
    filename = f"states/{state_upper}.h5"

    print(f"    Downloading {state_upper} dataset from Hugging Face...")
    dataset_path = hf_hub_download(
        repo_id="policyengine/policyengine-us-data",
        filename=filename,
        repo_type="model",
    )
    print(f"    Dataset ready: {dataset_path}")
    return dataset_path


def compute_district_impacts(state: str, reform_dict: dict, year: int = 2026) -> dict:
    """
    Compute district-level impacts using PolicyEngine Microsimulation.

    Runs a full microsimulation with state-specific data to get impacts
    by congressional district.

    Args:
        state: State code (e.g., "ut", "sc")
        reform_dict: PolicyEngine reform parameters
        year: Simulation year

    Returns:
        Dict mapping district IDs (e.g., "SC-1") to impact data
    """
    # Check dependencies
    try:
        from policyengine_us import Microsimulation
        from policyengine_core.reforms import Reform
        from policyengine_core.periods import instant
        from microdf import MicroSeries
    except ImportError as e:
        print(f"  Skipping district impacts: {e}")
        return {}

    state_upper = state.upper()

    if state_upper not in STATE_FIPS:
        print(f"  Skipping district impacts: state {state_upper} not in STATE_FIPS")
        return {}

    num_districts = STATE_DISTRICTS.get(state_upper, 0)
    if num_districts == 0:
        print(f"  Skipping district impacts: {state_upper} has no districts")
        return {}

    state_fips = STATE_FIPS[state_upper]

    print("  Computing district-level impacts...")

    # Download state-specific dataset
    try:
        state_dataset = get_state_dataset(state)
    except Exception as e:
        print(f"  Error downloading state dataset: {e}")
        return {}

    # Create reform class dynamically
    def create_reform_class(parameters):
        def modify_params(params):
            for param_path, values in parameters.items():
                param = params
                for key in param_path.split("."):
                    param = getattr(param, key)
                for period, value in values.items():
                    # Handle period format "2026-01-01.2100-12-31" or just "2026"
                    if "." in period and len(period) > 10:
                        start_str, stop_str = period.split(".")
                    else:
                        start_str = period if "-" in period else f"{period}-01-01"
                        stop_str = "2100-12-31"
                    param.update(
                        start=instant(start_str),
                        stop=instant(stop_str),
                        value=value
                    )
            return params

        class DynamicReform(Reform):
            def apply(self):
                self.modify_parameters(modify_params)

        return DynamicReform

    try:
        ReformClass = create_reform_class(reform_dict)

        # Run simulations
        print("    Running baseline simulation...")
        baseline = Microsimulation(dataset=state_dataset)

        print("    Running reform simulation...")
        reformed = Microsimulation(reform=ReformClass, dataset=state_dataset)

        # Extract variables
        baseline_income = baseline.calculate("household_net_income", year).values
        reform_income = reformed.calculate("household_net_income", year).values
        income_change = reform_income - baseline_income

        household_weight = baseline.calculate("household_weight", year).values
        household_count_people = baseline.calculate("household_count_people", year).values
        household_income_decile = baseline.calculate("household_income_decile", year).values
        state_code = baseline.calculate("state_code_str", year).values
        cd_geoid = baseline.calculate("congressional_district_geoid", year).values

        # Verify congressional district data exists
        unique_geoids = np.unique(cd_geoid)
        if len(unique_geoids) == 1 and unique_geoids[0] == 0:
            print("    Warning: Congressional district data not available")
            return {}

        # Filter to state
        in_state = state_code == state_upper

        # Compute per-district impacts
        district_impacts = {}

        for district_num in range(1, num_districts + 1):
            district_geoid = state_fips * 100 + district_num
            in_district = (cd_geoid == district_geoid) & in_state

            if not np.any(in_district):
                continue

            district_weights = household_weight[in_district]
            district_income_change = income_change[in_district]

            # Basic metrics
            total_households = float(np.sum(district_weights))
            total_benefit = float(np.sum(district_income_change * district_weights))
            avg_benefit = total_benefit / total_households if total_households > 0 else 0

            # Winners share calculation (matching API methodology)
            district_baseline = baseline_income[in_district]
            district_reform = reform_income[in_district]
            absolute_change = district_reform - district_baseline
            capped_baseline = np.maximum(district_baseline, 1)
            capped_reform = np.maximum(district_reform, 1) + absolute_change
            relative_change = (capped_reform - capped_baseline) / capped_baseline

            district_people = MicroSeries(
                household_count_people[in_district],
                weights=district_weights
            )
            district_decile = household_income_decile[in_district]

            # API threshold: > 0.1% gain = winner
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

            winners_share = sum(decile_proportions) / 10

            district_id = f"{state_upper}-{district_num}"
            district_impacts[district_id] = format_district_impact(
                district_id=district_id,
                district_name=f"Congressional District {district_num}",
                avg_benefit=avg_benefit,
                households_affected=int(total_households),
                total_benefit=total_benefit,
                winners_share=winners_share,
            )

            print(f"    District {district_num}: ${avg_benefit:.0f} avg benefit, {winners_share:.1%} winners")

        return district_impacts

    except Exception as e:
        print(f"  Error computing district impacts: {e}")
        import traceback
        traceback.print_exc()
        return {}


# =============================================================================
# DATABASE WRITE
# =============================================================================

def write_to_supabase(supabase, reform_id: str, impacts: dict, reform_params: dict):
    """
    Write impacts to Supabase reform_impacts table.

    Converts camelCase keys to snake_case for database columns.
    """
    record = {
        "id": reform_id,
        "computed": True,
        "computed_at": impacts["computedAt"],
        "policy_id": impacts.get("policyId"),
        "budgetary_impact": impacts["budgetaryImpact"],
        "poverty_impact": impacts["povertyImpact"],
        "child_poverty_impact": impacts["childPovertyImpact"],
        "winners_losers": impacts["winnersLosers"],
        "decile_impact": impacts["decileImpact"],
        "inequality": impacts.get("inequality"),
        "district_impacts": impacts.get("districtImpacts"),
        "reform_params": reform_params,
    }

    result = supabase.table("reform_impacts").upsert(record).execute()
    return result


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Compute aggregate impacts for reforms stored in Supabase",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # List all reforms
    python scripts/compute_impacts.py --list

    # Compute impacts for a specific reform
    python scripts/compute_impacts.py --reform-id sc-h4216

    # Force recomputation
    python scripts/compute_impacts.py --force --reform-id ut-sb60

    # Update only district impacts
    python scripts/compute_impacts.py --districts-only --reform-id sc-h4216
        """
    )
    parser.add_argument(
        "--reform-id",
        type=str,
        help="Only process a specific reform ID (e.g., 'sc-h4216')"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force recomputation even if already computed"
    )
    parser.add_argument(
        "--districts-only",
        action="store_true",
        help="Only compute district impacts (skip API call)"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available reforms and exit"
    )
    args = parser.parse_args()

    # Require Supabase
    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
        print("Run: source .env")
        return 1

    print("=" * 60)
    print("PolicyEngine Impact Calculator")
    print("=" * 60)

    # Load reforms from database
    reforms = load_reforms_from_db(supabase, args.reform_id)

    if not reforms:
        if args.reform_id:
            print(f"\nError: Reform '{args.reform_id}' not found or has no reform_params")
        else:
            print("\nNo reforms found with type='bill' and reform_params set")
        return 1

    # List mode
    if args.list:
        print(f"\nFound {len(reforms)} reform(s):\n")
        for r in reforms:
            status = "computed" if r["computed"] else "pending"
            print(f"  {r['id']:30} [{r['state'].upper()}] ({status})")
        return 0

    print(f"\nProcessing {len(reforms)} reform(s)...")

    results = {}

    for reform in reforms:
        reform_id = reform["id"]
        state = reform["state"]

        print(f"\n{'─' * 60}")
        print(f"Reform: {reform['label']}")
        print(f"ID: {reform_id} | State: {state.upper()}")
        print(f"{'─' * 60}")

        # Skip if already computed (unless forced)
        if not args.force and reform["computed"]:
            print("  Already computed (use --force to recompute)")
            results[reform_id] = "skipped"
            continue

        # Districts-only mode
        if args.districts_only:
            if not reform["computed"]:
                print("  Not yet computed, cannot update districts only")
                results[reform_id] = "skipped"
                continue

            print("  Computing district impacts only...")
            district_impacts = compute_district_impacts(state, reform["reform"])

            if district_impacts:
                supabase.table("reform_impacts").update({
                    "district_impacts": district_impacts
                }).eq("id", reform_id).execute()
                print("  District impacts updated")
                results[reform_id] = "districts_updated"
            else:
                results[reform_id] = "no_districts"
            continue

        # Full computation
        try:
            print("  [1/4] Creating policy in PolicyEngine API...")
            policy_id = create_policy(reform["reform"])
            print(f"        Policy ID: {policy_id}")

            print("  [2/4] Fetching economy impact...")
            economy_data = get_economy_impact(policy_id, state)

            print("  [3/4] Processing results...")
            impacts = extract_impacts(economy_data)
            impacts["policyId"] = policy_id

            print("  [4/4] Computing district impacts...")
            district_impacts = compute_district_impacts(state, reform["reform"])
            if district_impacts:
                impacts["districtImpacts"] = district_impacts

            print("  Writing to Supabase...")
            write_to_supabase(supabase, reform_id, impacts, reform["reform"])

            revenue = impacts["budgetaryImpact"]["stateRevenueImpact"]
            print(f"\n  Complete!")
            print(f"    Revenue impact: ${revenue:,.0f}")
            print(f"    Policy ID: {policy_id}")

            results[reform_id] = "computed"

        except Exception as e:
            print(f"  Error: {e}")
            import traceback
            traceback.print_exc()
            results[reform_id] = f"error: {e}"

    # Summary
    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    for reform_id, status in results.items():
        print(f"  {reform_id}: {status}")

    # Return non-zero if any errors
    if any("error" in str(s) for s in results.values()):
        return 1
    return 0


if __name__ == "__main__":
    exit(main())
