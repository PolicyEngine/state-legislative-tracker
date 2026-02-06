"""
Database schema utilities for state-research-tracker.

This module defines the expected data structures for the Supabase tables
and provides helper functions to ensure consistent data formatting.

IMPORTANT: Always use these functions when writing to the database to ensure
the frontend can read the data correctly.
"""

from typing import Optional
from datetime import datetime


def format_budgetary_impact(
    state_revenue_impact: float,
    net_cost: Optional[float] = None,
    households: Optional[int] = None,
) -> dict:
    """
    Format budgetary impact for the reform_impacts table.

    Args:
        state_revenue_impact: Change in state revenue (negative = revenue loss)
        net_cost: Alternative cost metric (defaults to state_revenue_impact)
        households: Number of households affected

    Returns:
        Dict matching frontend AggregateImpacts.jsx expectations:
        {stateRevenueImpact, netCost, households}
    """
    return {
        "stateRevenueImpact": state_revenue_impact,
        "netCost": net_cost if net_cost is not None else state_revenue_impact,
        "households": households,
    }


def format_poverty_impact(
    baseline_rate: float,
    reform_rate: float,
) -> dict:
    """
    Format poverty impact for the reform_impacts table.

    Args:
        baseline_rate: Poverty rate under baseline (0-1 scale)
        reform_rate: Poverty rate under reform (0-1 scale)

    Returns:
        Dict matching frontend AggregateImpacts.jsx expectations:
        {baselineRate, reformRate, change, percentChange}
    """
    change = reform_rate - baseline_rate
    percent_change = ((reform_rate - baseline_rate) / baseline_rate * 100) if baseline_rate > 0 else 0

    return {
        "baselineRate": baseline_rate,
        "reformRate": reform_rate,
        "change": change,
        "percentChange": percent_change,
    }


def format_winners_losers(
    gain_more_5pct: float = 0,
    gain_less_5pct: float = 0,
    no_change: float = 0,
    lose_less_5pct: float = 0,
    lose_more_5pct: float = 0,
    *,
    # Alternative simpler format
    better_off_pct: Optional[float] = None,
    worse_off_pct: Optional[float] = None,
    no_change_pct: Optional[float] = None,
) -> dict:
    """
    Format winners/losers for the reform_impacts table.

    Can accept either detailed breakdown (5% threshold) or simple percentages.

    Args:
        gain_more_5pct: Fraction gaining more than 5% income (0-1)
        gain_less_5pct: Fraction gaining less than 5% income (0-1)
        no_change: Fraction with no change (0-1)
        lose_less_5pct: Fraction losing less than 5% income (0-1)
        lose_more_5pct: Fraction losing more than 5% income (0-1)

        OR use simple format:
        better_off_pct: Percentage better off (0-100 scale)
        worse_off_pct: Percentage worse off (0-100 scale)
        no_change_pct: Percentage unchanged (0-100 scale)

    Returns:
        Dict matching frontend AggregateImpacts.jsx expectations:
        {gainMore5Pct, gainLess5Pct, noChange, loseLess5Pct, loseMore5Pct}
    """
    # If simple format provided, convert to detailed format
    if better_off_pct is not None:
        # Convert from 0-100 to 0-1 scale and split gains/losses roughly
        total_gain = better_off_pct / 100
        total_lose = worse_off_pct / 100 if worse_off_pct else 0
        no_change_frac = no_change_pct / 100 if no_change_pct else 0

        # Split gains: assume 50% gain more than 5%, 50% less
        gain_more_5pct = total_gain * 0.5
        gain_less_5pct = total_gain * 0.5

        # Split losses: assume 70% lose less than 5%, 30% more
        lose_less_5pct = total_lose * 0.7
        lose_more_5pct = total_lose * 0.3

        no_change = no_change_frac

    return {
        "gainMore5Pct": gain_more_5pct,
        "gainLess5Pct": gain_less_5pct,
        "noChange": no_change,
        "loseLess5Pct": lose_less_5pct,
        "loseMore5Pct": lose_more_5pct,
    }


def format_decile_impact(decile_values: list) -> dict:
    """
    Format decile impact for the reform_impacts table.

    Args:
        decile_values: List of 10 values (average $ benefit per decile)

    Returns:
        Dict with relative and absolute impacts by decile string key.
        Note: DecileChart.jsx checks 'relative' first, so we put values there.
    """
    if not decile_values or len(decile_values) != 10:
        return {}

    # DecileChart uses: const data = decileData.relative || decileData.absolute
    # So we put values in 'relative' to ensure they display
    values_dict = {str(i): decile_values[i-1] for i in range(1, 11)}

    return {
        "relative": values_dict,  # Used by DecileChart for display
        "absolute": values_dict,  # Same values, kept for compatibility
    }


def format_district_impact(
    district_id: str,
    district_name: str,
    avg_benefit: float,
    households_affected: int,
    total_benefit: Optional[float] = None,
    winners_share: float = 0,
    poverty_change: float = 0,
) -> dict:
    """
    Format a single district impact.

    Args:
        district_id: District identifier (e.g., "SC-1")
        district_name: Human-readable name
        avg_benefit: Average $ benefit per household
        households_affected: Number of households
        total_benefit: Total $ benefit (computed if not provided)
        winners_share: Fraction of households that benefit (0-1)
        poverty_change: Change in poverty rate

    Returns:
        Dict matching frontend DistrictMap.jsx expectations
    """
    if total_benefit is None:
        total_benefit = avg_benefit * households_affected

    return {
        "districtName": district_name,
        "avgBenefit": round(avg_benefit, 0),
        "householdsAffected": round(households_affected, 0),
        "totalBenefit": round(total_benefit, 0),
        "winnersShare": round(winners_share, 2),
        "povertyChange": poverty_change,
    }


def format_reform_impacts_record(
    reform_id: str,
    budgetary_impact: dict,
    poverty_impact: dict,
    child_poverty_impact: dict,
    winners_losers: dict,
    decile_impact: dict,
    district_impacts: dict,
    reform_params: dict,
    policy_id: Optional[int] = None,
    computed: bool = True,
    limitations: Optional[str] = None,
) -> dict:
    """
    Format a complete reform_impacts record for Supabase insertion.

    This is the main function to use when writing to the reform_impacts table.
    It ensures all fields are in the correct format for the frontend.

    Args:
        reform_id: Unique identifier (e.g., "sc-h4216")
        budgetary_impact: From format_budgetary_impact()
        poverty_impact: From format_poverty_impact()
        child_poverty_impact: From format_poverty_impact()
        winners_losers: From format_winners_losers()
        decile_impact: From format_decile_impact()
        district_impacts: Dict of district_id -> format_district_impact()
        reform_params: PolicyEngine reform JSON
        policy_id: PolicyEngine policy ID
        computed: Whether impacts have been computed
        limitations: Any limitations/caveats about the model

    Returns:
        Dict ready for Supabase insert/update (snake_case column names,
        but nested JSON values in camelCase for frontend compatibility)
    """
    return {
        "id": reform_id,
        "computed": computed,
        "computed_at": datetime.utcnow().isoformat() if computed else None,
        "policy_id": policy_id,
        "budgetary_impact": budgetary_impact,
        "poverty_impact": poverty_impact,
        "child_poverty_impact": child_poverty_impact,
        "winners_losers": winners_losers,
        "decile_impact": decile_impact,
        "district_impacts": district_impacts,
        "reform_params": reform_params,
        # Note: limitations stored in research table description, not here
    }


# Example usage in encode-bill workflow:
"""
from scripts.db_schema import (
    format_budgetary_impact,
    format_poverty_impact,
    format_winners_losers,
    format_decile_impact,
    format_district_impact,
    format_reform_impacts_record,
)

# After getting PE API results:
record = format_reform_impacts_record(
    reform_id="sc-h4216",
    budgetary_impact=format_budgetary_impact(
        state_revenue_impact=-967884160,
    ),
    poverty_impact=format_poverty_impact(
        baseline_rate=0.217,
        reform_rate=0.2171,
    ),
    child_poverty_impact=format_poverty_impact(
        baseline_rate=0.2052,
        reform_rate=0.2052,
    ),
    winners_losers=format_winners_losers(
        better_off_pct=50.32,
        worse_off_pct=2.97,
        no_change_pct=46.72,
    ),
    decile_impact=format_decile_impact([1.85, 39.5, 76.06, 160.45, 276.01, 323.94, 447.23, 631.84, 807.12, 3393.84]),
    district_impacts={
        "SC-1": format_district_impact("SC-1", "Congressional District 1", 779, 271928, winners_share=0.62),
        # ... more districts
    },
    reform_params=reform_json,
    policy_id=95888,
)

# Then insert to Supabase:
supabase.table("reform_impacts").upsert(record).execute()
"""
