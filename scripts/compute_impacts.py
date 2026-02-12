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
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml

# Load environment variables from .env.local
from dotenv import load_dotenv
_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / '.env.local'
if _env_path.exists():
    load_dotenv(_env_path)

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


def get_builtin_reform(reform_name: str):
    """Get a built-in reform class from policyengine-us by name."""
    # Map of supported built-in reforms
    builtin_reforms = {
        "ut_hb210_s2": "policyengine_us.reforms.states.ut.ut_hb210_s2",
        "ut_hb210": "policyengine_us.reforms.states.ut.ut_hb210",
        "va_hb979": "policyengine_us.reforms.states.va.hb979.va_hb979_reform",
    }

    if reform_name not in builtin_reforms:
        raise ValueError(f"Unknown built-in reform: {reform_name}")

    module_path = builtin_reforms[reform_name]
    import importlib
    module = importlib.import_module(module_path)

    # Get the reform class (usually named same as the reform or with _reform suffix)
    if hasattr(module, reform_name):
        return getattr(module, reform_name)
    elif hasattr(module, f"create_{reform_name}"):
        # Some reforms use a factory function
        return getattr(module, f"create_{reform_name}")()
    else:
        raise ValueError(f"Could not find reform class in {module_path}")


def create_reform_class(reform_params: dict):
    """Create a PolicyEngine Reform class from parameter dict.

    Special keys:
    - _use_reform: Name of a built-in policyengine-us reform to apply
    - _skip_params: List of parameter prefixes to skip (handled by built-in reform)
    """
    import re
    from policyengine_core.reforms import Reform
    from policyengine_core.periods import instant

    # Check for built-in reform
    builtin_reform_name = reform_params.pop("_use_reform", None)
    skip_prefixes = reform_params.pop("_skip_params", [])

    # Filter out parameters that the built-in reform handles
    filtered_params = {}
    for param_path, values in reform_params.items():
        should_skip = False
        for prefix in skip_prefixes:
            if param_path.startswith(prefix):
                should_skip = True
                break
        if not should_skip:
            filtered_params[param_path] = values

    def modify_params(params):
        for param_path, values in filtered_params.items():
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

    # If using a built-in reform, combine it with parameter modifications
    if builtin_reform_name:
        builtin_reform = get_builtin_reform(builtin_reform_name)

        class CombinedReform(Reform):
            def apply(self):
                # Apply the built-in reform first
                # Note: policyengine-us may have already applied this via structural
                # reforms if in_effect=true was set in parameters. We catch the
                # VariableNameConflictError to handle this gracefully.
                try:
                    builtin_reform.apply(self)
                except Exception as e:
                    if "already defined" in str(e):
                        # Variable already exists from structural reform - that's fine
                        pass
                    else:
                        raise
                # Then apply any additional parameter modifications
                if filtered_params:
                    self.modify_parameters(modify_params)

        return CombinedReform

    # Standard parameter-only reform
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

    Matches policyengine.py ProgramStatistics approach:
    - calculate() returns weighted MicroSeries, so .sum() is already weighted
    - sum(household_weight raw values) for household count
    """
    # calculate() returns MicroSeries with tax_unit_weight — .sum() is weighted
    baseline_revenue = baseline.calculate("state_income_tax", year).sum()
    reform_revenue = reformed.calculate("state_income_tax", year).sum()
    revenue_change = float(reform_revenue - baseline_revenue)

    # Household count: sum of raw weight values (not weighted sum)
    total_households = int(baseline.calculate("household_weight", year).values.sum())

    return format_budgetary_impact(
        state_revenue_impact=revenue_change,
        households=total_households,
    )


def compute_poverty_impact(baseline, reformed, state: str, year: int = 2026, child_only: bool = False) -> dict:
    """
    Compute poverty rate change.

    Matches policyengine.py poverty_impact() exactly:
    - calculate() returns weighted MicroSeries (person_weight)
    - .mean() gives weighted poverty rate
    - Child filter: age < 18
    """
    # calculate() returns MicroSeries with person_weight already attached
    baseline_poverty = baseline.calculate("person_in_poverty", year)
    reform_poverty = reformed.calculate("person_in_poverty", year)

    if child_only:
        age = baseline.calculate("age", year)
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

    Matches policyengine.py intra_decile_impact() exactly:
    - BOUNDS/LABELS loop with (income_change > lower) & (income_change <= upper)
    - people[in_both].sum() / people[in_decile].sum() proportions
    - "all" = arithmetic mean of 10 decile proportions
    """
    # calculate() returns weighted MicroSeries (household_weight)
    baseline_income = baseline.calculate("household_net_income", year)
    reform_income = reformed.calculate("household_net_income", year)
    people = baseline.calculate("household_count_people", year)
    decile = baseline.calculate("household_income_decile", year).values

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

    Matches policyengine.py decile_impact() exactly:
    - calculate() returns weighted MicroSeries (household_weight)
    - groupby decile for relative and average breakdowns
    - Filter out negative decile values (decile >= 0)
    """
    # calculate() returns weighted MicroSeries (household_weight)
    baseline_income = baseline.calculate("household_net_income", year)
    reform_income = reformed.calculate("household_net_income", year)

    # Filter out negative decile values (matching API)
    decile = baseline.calculate("household_income_decile", year)
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

    Uses raw .values arrays for per-district slicing, then MicroSeries
    for weighted aggregation within each district.
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

    # Extract raw arrays for per-district slicing (can't use MicroSeries here
    # because we need to create sub-arrays for each district)
    baseline_income = baseline.calculate("household_net_income", year).values
    reform_income = reformed.calculate("household_net_income", year).values
    household_weight = baseline.calculate("household_weight", year).values
    household_count_people = baseline.calculate("household_count_people", year).values
    household_income_decile = baseline.calculate("household_income_decile", year).values
    cd_geoid = baseline.calculate("congressional_district_geoid", year).values

    # Person-level raw arrays for per-district poverty
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


def get_effective_year_from_params(reform_params: dict) -> int:
    """Extract the earliest effective year from reform params."""
    earliest_year = 2100
    for param_path, values in reform_params.items():
        for period_str in values.keys():
            # Parse period string like "2027-01-01.2100-12-31" or "2027-01-01"
            if "." in period_str and len(period_str) > 10:
                start_str = period_str.split(".")[0]
            else:
                start_str = period_str if "-" in period_str else f"{period_str}-01-01"
            try:
                year = int(start_str.split("-")[0])
                if year < earliest_year:
                    earliest_year = year
            except (ValueError, IndexError):
                continue
    return earliest_year if earliest_year < 2100 else 2026


def write_to_supabase(supabase, reform_id: str, impacts: dict, reform_params: dict, analysis_year: int, multi_year: bool = False):
    """Write impacts to Supabase reform_impacts table.

    If multi_year=True, stores impacts in model_notes.impacts_by_year[year] instead of
    overwriting the main impact fields. This allows storing multiple years of impacts.
    """
    if multi_year:
        import json
        # Fetch existing record to preserve other years' data
        existing = supabase.table("reform_impacts").select("model_notes").eq("id", reform_id).execute()
        existing_notes = {}
        if existing.data and len(existing.data) > 0:
            notes = existing.data[0].get("model_notes")
            if isinstance(notes, dict):
                existing_notes = notes
            elif isinstance(notes, str):
                # Parse if stored as string
                try:
                    existing_notes = json.loads(notes)
                except json.JSONDecodeError:
                    existing_notes = {}
            elif notes is None:
                existing_notes = {}

        # Preserve existing impacts_by_year
        impacts_by_year = existing_notes.get("impacts_by_year", {})

        # Add this year's impacts
        year_str = str(analysis_year)
        impacts_by_year[year_str] = {
            "budgetaryImpact": impacts["budgetaryImpact"],
            "povertyImpact": impacts["povertyImpact"],
            "childPovertyImpact": impacts["childPovertyImpact"],
            "winnersLosers": impacts["winnersLosers"],
            "decileImpact": impacts["decileImpact"],
            "districtImpacts": impacts.get("districtImpacts"),
            "computedAt": impacts["computedAt"],
        }

        # Merge model_notes
        model_notes = {
            **existing_notes,
            "analysis_year": analysis_year,  # Most recent year computed
            "impacts_by_year": impacts_by_year,
        }

        record = {
            "id": reform_id,
            "computed": True,
            "computed_at": impacts["computedAt"],
            # Use the latest year's impacts as the default display
            "budgetary_impact": impacts["budgetaryImpact"],
            "poverty_impact": impacts["povertyImpact"],
            "child_poverty_impact": impacts["childPovertyImpact"],
            "winners_losers": impacts["winnersLosers"],
            "decile_impact": impacts["decileImpact"],
            "district_impacts": impacts.get("districtImpacts"),
            "reform_params": reform_params,
            "model_notes": model_notes,
            "policyengine_us_version": get_changelog_version(str(_PE_US_REPO)),
            "dataset_name": "policyengine-us-data",
            "dataset_version": get_changelog_version(str(_PE_US_DATA_REPO)),
        }
    else:
        model_notes = {
            "analysis_year": analysis_year,
        }

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
            "model_notes": model_notes,
            "policyengine_us_version": get_changelog_version(str(_PE_US_REPO)),
            "dataset_name": "policyengine-us-data",
            "dataset_version": get_changelog_version(str(_PE_US_DATA_REPO)),
        }

    result = supabase.table("reform_impacts").upsert(record).execute()
    return result


# =============================================================================
# STATUS UPDATE
# =============================================================================

def update_research_status(supabase, reform_id: str, status: str):
    """Update the research table status for a reform."""
    result = supabase.table("research").update({"status": status}).eq("id", reform_id).execute()
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
        default=None,
        help="Simulation year (auto-detects from reform params if not specified)"
    )
    parser.add_argument(
        "--multi-year",
        action="store_true",
        help="Store impacts in impacts_by_year structure (for multi-year analysis)"
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

        print(f"\n{'-' * 60}")
        print(f"Reform: {reform['label']}")
        print(f"ID: {reform_id} | State: {state.upper()}")
        print(f"{'-' * 60}")

        # Skip if already computed (unless forced)
        if not args.force and reform["computed"]:
            print("  Already computed (use --force to recompute)")
            results[reform_id] = "skipped"
            continue

        try:
            # Determine simulation year: use --year if provided, otherwise detect from reform params
            if args.year:
                sim_year = args.year
            else:
                sim_year = get_effective_year_from_params(reform["reform"])
            print(f"  Analysis year: {sim_year}")

            # Run simulations
            print("  [1/6] Running microsimulations...")
            baseline, reformed = run_simulations(state, reform["reform"], sim_year)

            # Compute all impacts
            print("  [2/6] Computing budgetary impact...")
            budgetary_impact = compute_budgetary_impact(baseline, reformed, state, sim_year)
            print(f"        Revenue change: ${budgetary_impact['stateRevenueImpact']:,.0f}")

            print("  [3/6] Computing poverty impact...")
            poverty_impact = compute_poverty_impact(baseline, reformed, state, sim_year)
            print(f"        Baseline: {poverty_impact['baselineRate']:.2%} -> Reform: {poverty_impact['reformRate']:.2%}")

            print("  [4/6] Computing child poverty impact...")
            child_poverty_impact = compute_poverty_impact(baseline, reformed, state, sim_year, child_only=True)

            print("  [5/6] Computing winners/losers...")
            winners_losers = compute_winners_losers(baseline, reformed, state, sim_year)
            gain_total = winners_losers['gainMore5Pct'] + winners_losers['gainLess5Pct']
            lose_total = winners_losers['loseLess5Pct'] + winners_losers['loseMore5Pct']
            print(f"        Winners: {gain_total:.1%} | No change: {winners_losers['noChange']:.1%} | Losers: {lose_total:.1%}")

            print("  [6/6] Computing decile and district impacts...")
            decile_impact = compute_decile_impact(baseline, reformed, state, sim_year)
            district_impacts = compute_district_impacts(baseline, reformed, state, sim_year)

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
            write_to_supabase(supabase, reform_id, impacts, reform["reform"], sim_year, args.multi_year)

            # Set status to in_review
            print("  Setting status to in_review...")
            update_research_status(supabase, reform_id, "in_review")

            print(f"\n  [OK] Complete!")
            results[reform_id] = "computed"

        except Exception as e:
            print(f"  [ERROR] {e}")
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
