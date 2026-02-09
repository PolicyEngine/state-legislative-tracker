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
from pathlib import Path

import numpy as np
import yaml

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

# Winners/losers thresholds for district-level classification
# (Statewide uses BOUNDS/LABELS matching API intra_decile_impact)
GAIN_LESS_5PCT_THRESHOLD = 0.001     # > 0.1% = winner
NO_CHANGE_THRESHOLD = -0.001         # <= -0.1% = loser


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

    Matches API budgetary_impact() approach:
    - Weighted sums for revenue
    - sum(household_weight) for household count

    Note: State-specific datasets already filtered to target state.
    """
    from microdf import MicroSeries

    # Get state income tax (at tax_unit level)
    baseline_tax = baseline.calculate("state_income_tax", year).values
    reform_tax = reformed.calculate("state_income_tax", year).values
    tax_unit_weight = baseline.calculate("tax_unit_weight", year).values

    # Compute weighted sum of tax change
    baseline_revenue = MicroSeries(baseline_tax, weights=tax_unit_weight).sum()
    reform_revenue = MicroSeries(reform_tax, weights=tax_unit_weight).sum()

    revenue_change = float(reform_revenue - baseline_revenue)

    # Household count: sum(household_weight) matching API approach
    household_weight = baseline.calculate("household_weight", year).values
    total_households = int(np.sum(household_weight))

    return format_budgetary_impact(
        state_revenue_impact=revenue_change,
        households=total_households,
    )


def compute_poverty_impact(baseline, reformed, state: str, year: int = 2026, child_only: bool = False) -> dict:
    """
    Compute poverty rate change.

    Matches API poverty_impact() exactly:
    - Variable: person_in_poverty (person-level)
    - Weighted by person_weight
    - Child filter: age < 18 (matching API)
    """
    from microdf import MicroSeries

    # API uses person_in_poverty (person-level variable)
    baseline_poverty = MicroSeries(
        baseline.calculate("person_in_poverty", year).values.astype(float),
        weights=baseline.calculate("person_weight", year).values,
    )
    reform_poverty = MicroSeries(
        reformed.calculate("person_in_poverty", year).values.astype(float),
        weights=baseline_poverty.weights,
    )

    if child_only:
        # API uses age < 18, not is_child
        age = MicroSeries(baseline.calculate("age", year).values)
        baseline_rate = float(baseline_poverty[age < 18].mean())
        reform_rate = float(reform_poverty[age < 18].mean())
    else:
        baseline_rate = float(baseline_poverty.mean())
        reform_rate = float(reform_poverty.mean())

    return format_poverty_impact(
        baseline_rate=baseline_rate,
        reform_rate=reform_rate,
    )


def compute_winners_losers(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute winners/losers breakdown.

    Matches API intra_decile_impact() exactly:
    - BOUNDS/LABELS loop with (income_change > lower) & (income_change <= upper)
    - Single people MicroSeries for all households
    - people[in_both].sum() / people[in_decile].sum() proportions
    - "all" = arithmetic mean of 10 decile proportions
    """
    from microdf import MicroSeries

    # Create MicroSeries exactly as API does
    baseline_income = MicroSeries(
        baseline.calculate("household_net_income", year).values,
        weights=baseline.calculate("household_weight", year).values,
    )
    reform_income = MicroSeries(
        reformed.calculate("household_net_income", year).values,
        weights=baseline_income.weights,
    )
    people = MicroSeries(
        baseline.calculate("household_count_people", year).values,
        weights=baseline_income.weights,
    )
    decile = MicroSeries(
        baseline.calculate("household_income_decile", year).values,
    ).values

    # Relative change formula (matching API exactly)
    absolute_change = (reform_income - baseline_income).values
    capped_baseline_income = np.maximum(baseline_income.values, 1)
    capped_reform_income = np.maximum(reform_income.values, 1) + absolute_change
    income_change = (capped_reform_income - capped_baseline_income) / capped_baseline_income

    # BOUNDS/LABELS approach matching API intra_decile_impact()
    outcome_groups = {}
    all_outcomes = {}
    BOUNDS = [-np.inf, -0.05, -1e-3, 1e-3, 0.05, np.inf]
    LABELS = [
        "Lose more than 5%",
        "Lose less than 5%",
        "No change",
        "Gain less than 5%",
        "Gain more than 5%",
    ]
    for lower, upper, label in zip(BOUNDS[:-1], BOUNDS[1:], LABELS):
        outcome_groups[label] = []
        for i in range(1, 11):
            in_decile = decile == i
            in_group = (income_change > lower) & (income_change <= upper)
            in_both = in_decile & in_group

            people_in_both = people[in_both].sum()
            people_in_decile = people[in_decile].sum()

            if people_in_decile == 0 and people_in_both == 0:
                people_in_proportion = 0.0
            else:
                people_in_proportion = float(people_in_both / people_in_decile)

            outcome_groups[label].append(people_in_proportion)

        all_outcomes[label] = sum(outcome_groups[label]) / 10

    # Map API labels to our frontend camelCase format
    return format_winners_losers(
        gain_more_5pct=all_outcomes["Gain more than 5%"],
        gain_less_5pct=all_outcomes["Gain less than 5%"],
        no_change=all_outcomes["No change"],
        lose_less_5pct=all_outcomes["Lose less than 5%"],
        lose_more_5pct=all_outcomes["Lose more than 5%"],
        decile_breakdown={
            "gain_more_5pct": outcome_groups["Gain more than 5%"],
            "gain_less_5pct": outcome_groups["Gain less than 5%"],
            "no_change": outcome_groups["No change"],
            "lose_less_5pct": outcome_groups["Lose less than 5%"],
            "lose_more_5pct": outcome_groups["Lose more than 5%"],
        },
    )


def compute_decile_impact(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute average income change by decile.

    Matches API decile_impact() exactly:
    - MicroSeries + groupby approach
    - Filter out negative decile values (decile >= 0)
    - Compute both relative and average keys
    """
    from microdf import MicroSeries

    baseline_income = MicroSeries(
        baseline.calculate("household_net_income", year).values,
        weights=baseline.calculate("household_weight", year).values,
    )
    reform_income = MicroSeries(
        reformed.calculate("household_net_income", year).values,
        weights=baseline_income.weights,
    )

    # Filter out negative decile values (matching API)
    decile = MicroSeries(baseline.calculate("household_income_decile", year).values)
    baseline_income_filtered = baseline_income[decile >= 0]
    reform_income_filtered = reform_income[decile >= 0]

    income_change = reform_income_filtered - baseline_income_filtered

    # Relative: weighted sum of change / weighted sum of baseline income
    rel_income_change_by_decile = (
        income_change.groupby(decile).sum()
        / baseline_income_filtered.groupby(decile).sum()
    )

    # Average: weighted sum of change / weighted count (sum of weights)
    avg_income_change_by_decile = (
        income_change.groupby(decile).sum()
        / baseline_income_filtered.groupby(decile).count()
    )

    rel_decile_dict = rel_income_change_by_decile.to_dict()
    avg_decile_dict = avg_income_change_by_decile.to_dict()

    return format_decile_impact(
        relative={int(k): v for k, v in rel_decile_dict.items()},
        average={int(k): v for k, v in avg_decile_dict.items()},
    )


def compute_district_impacts(baseline, reformed, state: str, year: int = 2026) -> dict:
    """
    Compute impacts by congressional district.

    Matches API approach:
    - MicroSeries for avg benefit: (reform.sum() - baseline.sum()) / baseline.count()
    - person_in_poverty (person-level variable, matching API poverty_impact)
    - age < 18 for child filter (matching API)
    - Winners/losers per decile using same BOUNDS pattern as intra_decile_impact
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

    # Get household-level variables
    baseline_income = baseline.calculate("household_net_income", year).values
    reform_income = reformed.calculate("household_net_income", year).values
    household_weight = baseline.calculate("household_weight", year).values
    household_count_people = baseline.calculate("household_count_people", year).values
    household_income_decile = baseline.calculate("household_income_decile", year).values
    cd_geoid = baseline.calculate("congressional_district_geoid", year).values

    # Person-level variables for poverty (matching API: person_in_poverty, age < 18)
    baseline_poverty_person = baseline.calculate("person_in_poverty", year).values.astype(float)
    reform_poverty_person = reformed.calculate("person_in_poverty", year).values.astype(float)
    person_weight = baseline.calculate("person_weight", year).values
    person_age = baseline.calculate("age", year).values
    person_cd_geoid = baseline.calculate("congressional_district_geoid", year, map_to="person").values

    # Check if congressional district data is available
    unique_geoids = np.unique(cd_geoid)
    if len(unique_geoids) == 1 and unique_geoids[0] == 0:
        print("    Warning: Congressional district data not available")
        return {}

    # Compute relative change for winners calculation (matching API intra_decile_impact)
    absolute_change = reform_income - baseline_income
    capped_baseline = np.maximum(baseline_income, 1)
    capped_reform = np.maximum(reform_income, 1) + absolute_change
    relative_change = (capped_reform - capped_baseline) / capped_baseline

    district_impacts = {}

    for district_num in range(1, num_districts + 1):
        district_geoid = state_fips * 100 + district_num
        in_district = cd_geoid == district_geoid

        if not np.any(in_district):
            continue

        # Average benefit using MicroSeries (matching API district approach)
        baseline_district_income = MicroSeries(
            baseline_income[in_district], weights=household_weight[in_district],
        )
        reform_district_income = MicroSeries(
            reform_income[in_district], weights=household_weight[in_district],
        )
        # API: (reform.sum() - baseline.sum()) / baseline.count()
        total_benefit = float(reform_district_income.sum() - baseline_district_income.sum())
        total_households = float(baseline_district_income.count())
        avg_benefit = total_benefit / total_households if total_households > 0 else 0

        # Winners/losers using same pattern as intra_decile_impact
        district_people = MicroSeries(
            household_count_people[in_district],
            weights=household_weight[in_district],
        )
        district_decile = household_income_decile[in_district]
        district_relative = relative_change[in_district]
        is_winner = district_relative > GAIN_LESS_5PCT_THRESHOLD
        is_loser = district_relative <= NO_CHANGE_THRESHOLD

        winner_proportions = []
        loser_proportions = []
        for decile in range(1, 11):
            in_decile = district_decile == decile
            if not np.any(in_decile):
                winner_proportions.append(0.0)
                loser_proportions.append(0.0)
                continue
            people_in_decile = district_people[in_decile].sum()
            winners_in_decile = district_people[in_decile & is_winner].sum()
            losers_in_decile = district_people[in_decile & is_loser].sum()
            if people_in_decile == 0 and winners_in_decile == 0:
                winner_proportions.append(0.0)
            else:
                winner_proportions.append(float(winners_in_decile / people_in_decile))
            if people_in_decile == 0 and losers_in_decile == 0:
                loser_proportions.append(0.0)
            else:
                loser_proportions.append(float(losers_in_decile / people_in_decile))

        winners_share = sum(winner_proportions) / 10
        losers_share = sum(loser_proportions) / 10

        # Poverty using person_in_poverty and age < 18 (matching API poverty_impact)
        in_district_person = person_cd_geoid == district_geoid
        district_person_weight = person_weight[in_district_person]
        district_baseline_poverty = baseline_poverty_person[in_district_person]
        district_reform_poverty = reform_poverty_person[in_district_person]

        if np.sum(district_person_weight) > 0:
            bp = MicroSeries(district_baseline_poverty, weights=district_person_weight)
            rp = MicroSeries(district_reform_poverty, weights=district_person_weight)
            poverty_baseline = float(bp.mean())
            poverty_reform = float(rp.mean())
            poverty_pct_change = ((poverty_reform - poverty_baseline) / poverty_baseline * 100) if poverty_baseline > 0 else 0

            # Child poverty: age < 18 (matching API)
            district_age = person_age[in_district_person]
            child_mask = district_age < 18
            if np.any(child_mask):
                bp_child = MicroSeries(district_baseline_poverty[child_mask], weights=district_person_weight[child_mask])
                rp_child = MicroSeries(district_reform_poverty[child_mask], weights=district_person_weight[child_mask])
                child_poverty_baseline = float(bp_child.mean())
                child_poverty_reform = float(rp_child.mean())
                child_poverty_pct_change = ((child_poverty_reform - child_poverty_baseline) / child_poverty_baseline * 100) if child_poverty_baseline > 0 else 0
            else:
                child_poverty_pct_change = 0
        else:
            poverty_pct_change = 0
            child_poverty_pct_change = 0

        district_id = f"{state_upper}-{district_num}"
        district_impacts[district_id] = format_district_impact(
            district_id=district_id,
            district_name=f"Congressional District {district_num}",
            avg_benefit=avg_benefit,
            households_affected=int(total_households),
            total_benefit=total_benefit,
            winners_share=winners_share,
            losers_share=losers_share,
            poverty_pct_change=poverty_pct_change,
            child_poverty_pct_change=child_poverty_pct_change,
        )

        print(f"    District {district_num}: ${avg_benefit:.0f} avg, {winners_share:.1%} winners, {losers_share:.1%} losers")

    return district_impacts


# =============================================================================
# DATABASE WRITE
# =============================================================================

def get_changelog_version(repo_path: str) -> str:
    """Read version from a PolicyEngine repo's changelog.yaml."""
    changelog = Path(repo_path) / "changelog.yaml"
    if not changelog.exists():
        return "unknown"
    with open(changelog) as f:
        entries = yaml.safe_load(f)
    version = [0, 0, 1]
    for entry in entries:
        if "version" in entry:
            version = [int(x) for x in str(entry["version"]).split(".")]
        elif "bump" in entry:
            bump = entry["bump"]
            if bump == "major":
                version = [version[0] + 1, 0, 0]
            elif bump == "minor":
                version = [version[0], version[1] + 1, 0]
            elif bump == "patch":
                version = [version[0], version[1], version[2] + 1]
    return f"{version[0]}.{version[1]}.{version[2]}"


# Repo paths (sibling directories of this project)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_PE_US_REPO = _PROJECT_ROOT / "policyengine-us"
_PE_US_DATA_REPO = _PROJECT_ROOT / "policyengine-us-data"


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
        "policyengine_us_version": get_changelog_version(str(_PE_US_REPO)),
        "dataset_name": "policyengine-us-data",
        "dataset_version": get_changelog_version(str(_PE_US_DATA_REPO)),
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
