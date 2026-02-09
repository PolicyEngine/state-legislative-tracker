#!/usr/bin/env python3
"""
Compute reform impacts locally using PolicyEngine Microsimulation.

This script runs everything locally (no API calls) for:
- Efficiency: single simulation pass for state + district results
- Consistency: uses same methodology as policyengine.py / policyengine-api

Methodology matches:
- policyengine.py/src/policyengine/outputs/ (poverty, decile, aggregate)
- policyengine-api/tests/unit/endpoints/economy/test_compare.py (winners/losers buckets)

Usage:
    python scripts/compute_impacts.py --reform-id sc-h4216
    python scripts/compute_impacts.py --list
    python scripts/compute_impacts.py --force --reform-id ut-sb60
"""

import argparse
import os
from datetime import datetime, timezone

import numpy as np

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
    "DC": 0,
}

# Winners/losers bucket thresholds (from policyengine-api test_compare.py)
# These match the API methodology exactly
GAIN_MORE_5PCT_THRESHOLD = 0.05      # > 5%
GAIN_LESS_5PCT_THRESHOLD = 0.001     # > 0.1%
NO_CHANGE_THRESHOLD = -0.001         # > -0.1%
LOSE_LESS_5PCT_THRESHOLD = -0.05     # > -5%


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
    """Load reform configs from database."""
    query = supabase.table("research").select(
        "id, state, title, description, url, reform_impacts(reform_params, computed)"
    ).in_("type", ["bill", "blog"])

    if reform_id:
        query = query.eq("id", reform_id)

    result = query.execute()

    reforms = []
    for r in result.data:
        impact_data = r.get("reform_impacts")
        if not impact_data:
            continue

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
# MICROSIMULATION
# =============================================================================

def get_state_dataset(state: str) -> str:
    """Download state-specific dataset from Hugging Face."""
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


def create_reform_class(reform_params: dict):
    """Create a PolicyEngine Reform class from parameter dict."""
    import re
    from policyengine_core.reforms import Reform
    from policyengine_core.periods import instant

    def modify_params(params):
        for param_path, values in reform_params.items():
            param = params
            # Split path and handle array indices like "brackets[0]"
            parts = param_path.split(".")
            for part in parts:
                # Check for array index notation: "brackets[0]"
                match = re.match(r"(\w+)\[(\d+)\]", part)
                if match:
                    attr_name = match.group(1)
                    index = int(match.group(2))
                    # Get the list attribute and index into it
                    param = getattr(param, attr_name)[index]
                else:
                    param = getattr(param, part)
            for period, value in values.items():
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


def run_simulations(state: str, reform_params: dict, year: int = 2026):
    """
    Run baseline and reform microsimulations.

    Returns tuple of (baseline, reformed) Microsimulation objects.
    """
    from policyengine_us import Microsimulation

    state_dataset = get_state_dataset(state)
    ReformClass = create_reform_class(reform_params)

    print("    Running baseline simulation...")
    baseline = Microsimulation(dataset=state_dataset)

    print("    Running reform simulation...")
    reformed = Microsimulation(reform=ReformClass, dataset=state_dataset)

    return baseline, reformed


# =============================================================================
# IMPACT CALCULATIONS (matching policyengine.py methodology)
# =============================================================================

def compute_budgetary_impact(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute state revenue impact.

    Methodology: Sum of state_income_tax change, weighted by tax_unit_weight.

    Note: Since we use state-specific datasets (e.g., SC.h5), all tax units
    in the dataset are already from the target state. No additional filtering needed.
    """
    from microdf import MicroSeries

    # Get state income tax (at tax_unit level)
    baseline_tax = baseline.calculate("state_income_tax", year).values
    reform_tax = reformed.calculate("state_income_tax", year).values
    tax_unit_weight = baseline.calculate("tax_unit_weight", year).values

    # Compute weighted sum of tax change (state dataset already filtered)
    baseline_revenue = MicroSeries(baseline_tax, weights=tax_unit_weight).sum()
    reform_revenue = MicroSeries(reform_tax, weights=tax_unit_weight).sum()

    revenue_change = float(reform_revenue - baseline_revenue)

    # Count affected households
    household_weight = baseline.calculate("household_weight", year).values
    hh_state_code = baseline.calculate("state_code_str", year).values
    in_state_hh = hh_state_code == state.upper()
    total_households = int(np.sum(household_weight[in_state_hh]))

    return format_budgetary_impact(
        state_revenue_impact=revenue_change,
        households=total_households,
    )


def compute_poverty_impact(baseline, reformed, state: str, year: int = 2026, child_only: bool = False) -> dict:
    """
    Compute poverty rate change.

    Methodology from policyengine.py/outputs/poverty.py:
    - Variable: spm_unit_is_in_spm_poverty (mapped to person level)
    - Weighted by person_weight
    - Optional filter by is_child for child poverty

    Note: Since we use state-specific datasets, no additional state filtering needed.
    """
    from microdf import MicroSeries

    # Get poverty status (SPM unit level, mapped to person level)
    baseline_poverty = baseline.calculate("spm_unit_is_in_spm_poverty", year, map_to="person").values
    reform_poverty = reformed.calculate("spm_unit_is_in_spm_poverty", year, map_to="person").values
    person_weight = baseline.calculate("person_weight", year).values

    # Optional child filter (state dataset already filtered to state)
    if child_only:
        is_child = baseline.calculate("is_child", year).values
        mask = is_child
    else:
        mask = np.ones(len(person_weight), dtype=bool)

    # Compute weighted poverty rates
    baseline_poor = MicroSeries(baseline_poverty[mask].astype(float), weights=person_weight[mask])
    reform_poor = MicroSeries(reform_poverty[mask].astype(float), weights=person_weight[mask])

    baseline_rate = float(baseline_poor.mean())
    reform_rate = float(reform_poor.mean())

    return format_poverty_impact(
        baseline_rate=baseline_rate,
        reform_rate=reform_rate,
    )


def compute_winners_losers(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute winners/losers breakdown using 5% threshold buckets.

    Methodology from policyengine-api/tests/unit/endpoints/economy/test_compare.py:
    - percent_change > 0.05 → "Gain more than 5%"
    - percent_change > 0.001 → "Gain less than 5%"
    - percent_change > -0.001 → "No change"
    - percent_change > -0.05 → "Lose less than 5%"
    - else → "Lose more than 5%"

    Computed per decile, then averaged (matching intra_decile methodology).
    """
    from microdf import MicroSeries

    # Get household income (state dataset already filtered)
    baseline_income = baseline.calculate("household_net_income", year).values
    reform_income = reformed.calculate("household_net_income", year).values
    household_weight = baseline.calculate("household_weight", year).values
    household_count_people = baseline.calculate("household_count_people", year).values
    household_income_decile = baseline.calculate("household_income_decile", year).values

    # Compute relative income change
    # Cap baseline at 1 to avoid division by zero (matching API)
    capped_baseline = np.maximum(baseline_income, 1)
    income_change = reform_income - baseline_income
    relative_change = income_change / capped_baseline

    # Assign to buckets
    gain_more_5pct = relative_change > GAIN_MORE_5PCT_THRESHOLD
    gain_less_5pct = (relative_change > GAIN_LESS_5PCT_THRESHOLD) & ~gain_more_5pct
    no_change = (relative_change > NO_CHANGE_THRESHOLD) & (relative_change <= GAIN_LESS_5PCT_THRESHOLD)
    lose_less_5pct = (relative_change > LOSE_LESS_5PCT_THRESHOLD) & (relative_change <= NO_CHANGE_THRESHOLD)
    lose_more_5pct = relative_change <= LOSE_LESS_5PCT_THRESHOLD

    # Compute proportions per decile, then average (matching intra_decile methodology)
    decile_results = {
        "gain_more_5pct": [],
        "gain_less_5pct": [],
        "no_change": [],
        "lose_less_5pct": [],
        "lose_more_5pct": [],
    }

    for decile in range(1, 11):
        in_decile = household_income_decile == decile
        if not np.any(in_decile):
            for key in decile_results:
                decile_results[key].append(0.0)
            continue

        people = MicroSeries(household_count_people[in_decile], weights=household_weight[in_decile])
        total_people = float(people.sum())

        if total_people == 0:
            for key in decile_results:
                decile_results[key].append(0.0)
            continue

        decile_results["gain_more_5pct"].append(
            float(people[gain_more_5pct[in_decile]].sum()) / total_people
        )
        decile_results["gain_less_5pct"].append(
            float(people[gain_less_5pct[in_decile]].sum()) / total_people
        )
        decile_results["no_change"].append(
            float(people[no_change[in_decile]].sum()) / total_people
        )
        decile_results["lose_less_5pct"].append(
            float(people[lose_less_5pct[in_decile]].sum()) / total_people
        )
        decile_results["lose_more_5pct"].append(
            float(people[lose_more_5pct[in_decile]].sum()) / total_people
        )

    # Average across deciles (matching API's intra_decile "all" calculation)
    return format_winners_losers(
        gain_more_5pct=sum(decile_results["gain_more_5pct"]) / 10,
        gain_less_5pct=sum(decile_results["gain_less_5pct"]) / 10,
        no_change=sum(decile_results["no_change"]) / 10,
        lose_less_5pct=sum(decile_results["lose_less_5pct"]) / 10,
        lose_more_5pct=sum(decile_results["lose_more_5pct"]) / 10,
        decile_breakdown=decile_results,
    )


def compute_decile_impact(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute average income change by decile.

    Methodology from policyengine.py/outputs/decile_impact.py:
    - Group households by baseline income decile
    - Compute mean income change per decile

    Note: Since we use state-specific datasets, no additional state filtering needed.
    """
    from microdf import MicroSeries

    baseline_income = baseline.calculate("household_net_income", year).values
    reform_income = reformed.calculate("household_net_income", year).values
    household_weight = baseline.calculate("household_weight", year).values
    household_income_decile = baseline.calculate("household_income_decile", year).values

    income_change = reform_income - baseline_income

    decile_values = []
    for decile in range(1, 11):
        in_decile = household_income_decile == decile
        if not np.any(in_decile):
            decile_values.append(0.0)
            continue

        change_series = MicroSeries(income_change[in_decile], weights=household_weight[in_decile])
        decile_values.append(float(change_series.mean()))

    return format_decile_impact(decile_values)


def compute_district_impacts(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute impacts by congressional district.

    Uses same methodology as state-level but filtered by district.
    """
    from microdf import MicroSeries

    state_upper = state.upper()

    if state_upper not in STATE_FIPS:
        print(f"  Skipping district impacts: state {state_upper} not in STATE_FIPS")
        return {}

    num_districts = STATE_DISTRICTS.get(state_upper, 0)
    if num_districts == 0:
        print(f"  Skipping district impacts: {state_upper} has no districts")
        return {}

    state_fips = STATE_FIPS[state_upper]

    # Get variables (state dataset already filtered to state)
    baseline_income = baseline.calculate("household_net_income", year).values
    reform_income = reformed.calculate("household_net_income", year).values
    income_change = reform_income - baseline_income
    household_weight = baseline.calculate("household_weight", year).values
    household_count_people = baseline.calculate("household_count_people", year).values
    household_income_decile = baseline.calculate("household_income_decile", year).values
    cd_geoid = baseline.calculate("congressional_district_geoid", year).values

    # Check if congressional district data is available
    unique_geoids = np.unique(cd_geoid)
    if len(unique_geoids) == 1 and unique_geoids[0] == 0:
        print("    Warning: Congressional district data not available")
        return {}

    # Compute relative change for winners calculation
    capped_baseline = np.maximum(baseline_income, 1)
    relative_change = income_change / capped_baseline

    district_impacts = {}

    for district_num in range(1, num_districts + 1):
        district_geoid = state_fips * 100 + district_num
        in_district = cd_geoid == district_geoid

        if not np.any(in_district):
            continue

        district_weights = household_weight[in_district]
        district_income_change = income_change[in_district]

        # Basic metrics
        total_households = float(np.sum(district_weights))
        total_benefit = float(np.sum(district_income_change * district_weights))
        avg_benefit = total_benefit / total_households if total_households > 0 else 0

        # Winners share (matching API methodology: > 0.1% = winner)
        district_people = MicroSeries(
            household_count_people[in_district],
            weights=district_weights
        )
        district_decile = household_income_decile[in_district]
        district_relative = relative_change[in_district]
        is_winner = district_relative > GAIN_LESS_5PCT_THRESHOLD  # > 0.1%

        # Calculate per decile, then average
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

        print(f"    District {district_num}: ${avg_benefit:.0f} avg, {winners_share:.1%} winners")

    return district_impacts


# =============================================================================
# DATABASE WRITE
# =============================================================================

def write_to_supabase(supabase, reform_id: str, impacts: dict, reform_params: dict):
    """Write impacts to Supabase reform_impacts table."""
    record = {
        "id": reform_id,
        "computed": True,
        "computed_at": impacts["computedAt"],
        "budgetary_impact": impacts["budgetaryImpact"],
        "poverty_impact": impacts["povertyImpact"],
        "child_poverty_impact": impacts["childPovertyImpact"],
        "winners_losers": impacts["winnersLosers"],
        "decile_impact": impacts["decileImpact"],
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
        description="Compute reform impacts locally using PolicyEngine Microsimulation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # List all reforms
    python scripts/compute_impacts.py --list

    # Compute impacts for a specific reform
    python scripts/compute_impacts.py --reform-id sc-h4216

    # Force recomputation
    python scripts/compute_impacts.py --force --reform-id ut-sb60
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
        "--list",
        action="store_true",
        help="List available reforms and exit"
    )
    parser.add_argument(
        "--year",
        type=int,
        default=2026,
        help="Simulation year (default: 2026)"
    )
    args = parser.parse_args()

    # Require Supabase
    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
        print("Run: source .env")
        return 1

    print("=" * 60)
    print("PolicyEngine Impact Calculator (Local)")
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

        try:
            # Run simulations
            print("  [1/6] Running microsimulations...")
            baseline, reformed = run_simulations(state, reform["reform"], args.year)

            # Compute all impacts
            print("  [2/6] Computing budgetary impact...")
            budgetary_impact = compute_budgetary_impact(baseline, reformed, state, args.year)
            print(f"        Revenue change: ${budgetary_impact['stateRevenueImpact']:,.0f}")

            print("  [3/6] Computing poverty impact...")
            poverty_impact = compute_poverty_impact(baseline, reformed, state, args.year)
            print(f"        Baseline: {poverty_impact['baselineRate']:.2%} → Reform: {poverty_impact['reformRate']:.2%}")

            print("  [4/6] Computing child poverty impact...")
            child_poverty_impact = compute_poverty_impact(baseline, reformed, state, args.year, child_only=True)

            print("  [5/6] Computing winners/losers...")
            winners_losers = compute_winners_losers(baseline, reformed, state, args.year)
            gain_total = winners_losers['gainMore5Pct'] + winners_losers['gainLess5Pct']
            lose_total = winners_losers['loseLess5Pct'] + winners_losers['loseMore5Pct']
            print(f"        Winners: {gain_total:.1%} | No change: {winners_losers['noChange']:.1%} | Losers: {lose_total:.1%}")

            print("  [6/6] Computing decile and district impacts...")
            decile_impact = compute_decile_impact(baseline, reformed, state, args.year)
            district_impacts = compute_district_impacts(baseline, reformed, state, args.year)

            # Assemble results
            impacts = {
                "computed": True,
                "computedAt": datetime.now(timezone.utc).isoformat(),
                "budgetaryImpact": budgetary_impact,
                "povertyImpact": poverty_impact,
                "childPovertyImpact": child_poverty_impact,
                "winnersLosers": winners_losers,
                "decileImpact": decile_impact,
            }
            if district_impacts:
                impacts["districtImpacts"] = district_impacts

            # Write to database
            print("  Writing to Supabase...")
            write_to_supabase(supabase, reform_id, impacts, reform["reform"])

            print(f"\n  ✓ Complete!")
            results[reform_id] = "computed"

        except Exception as e:
            print(f"  ✗ Error: {e}")
            import traceback
            traceback.print_exc()
            results[reform_id] = f"error: {e}"

    # Summary
    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    for reform_id, status in results.items():
        print(f"  {reform_id}: {status}")

    if any("error" in str(s) for s in results.values()):
        return 1
    return 0


if __name__ == "__main__":
    exit(main())
