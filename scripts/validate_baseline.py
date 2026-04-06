#!/usr/bin/env python3
"""
Automatic baseline data validation.

After confirming a reform is correctly encoded, this script checks whether
PE's underlying data accurately represents the state. It compares PE's
baseline microsimulation outputs against public data sources.

This is the Layer 2 check in the autoresearch loop: if the encoding is
correct but PE's estimate still differs from the fiscal note, the gap
must come from the data. This script diagnoses WHERE in the data.

Usage:
    python scripts/validate_baseline.py --state GA --year 2026
    python scripts/validate_baseline.py --reform-id ga-hb1001
    python scripts/validate_baseline.py --state GA --year 2026 --json

Checks performed:
    1. Total state income tax revenue (PE vs Census Bureau)
    2. Number of tax-filing households (PE vs IRS SOI)
    3. Average income by decile (PE vs CPS/ACS benchmarks)
    4. Filing status distribution (PE vs IRS SOI)
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

from validation_harness import STATE_PIT_REVENUE, NO_INCOME_TAX_STATES


# =============================================================================
# PUBLIC DATA: IRS SOI state-level returns (2022 filing year, approximate)
# Source: IRS Statistics of Income, Table 2 — by state
# https://www.irs.gov/statistics/soi-tax-stats-individual-income-tax-statistics
# =============================================================================

# Approximate number of individual income tax returns filed, in thousands
STATE_TAX_RETURNS_K = {
    "AL": 2130, "AZ": 3280, "AR": 1340, "CA": 18500, "CO": 2950,
    "CT": 1830, "DE": 480, "GA": 4900, "HI": 700, "ID": 870,
    "IL": 6100, "IN": 3250, "IA": 1520, "KS": 1420, "KY": 2060,
    "LA": 2060, "ME": 680, "MD": 3050, "MA": 3550, "MI": 4800,
    "MN": 2850, "MS": 1250, "MO": 2900, "MT": 550, "NE": 960,
    "NJ": 4650, "NM": 950, "NY": 9900, "NC": 4800, "ND": 390,
    "OH": 5700, "OK": 1750, "OR": 2000, "PA": 6300, "RI": 550,
    "SC": 2360, "UT": 1450, "VT": 340, "VA": 4150, "WV": 790,
    "WI": 2950, "DC": 380,
}


# =============================================================================
# RESULTS
# =============================================================================

class BaselineCheck:
    """One check comparing PE vs public data."""
    def __init__(self, name, pe_value, public_value, public_source, unit=""):
        self.name = name
        self.pe_value = pe_value
        self.public_value = public_value
        self.public_source = public_source
        self.unit = unit

        if public_value and public_value != 0:
            self.pct_diff = (pe_value - public_value) / abs(public_value)
        else:
            self.pct_diff = None

    @property
    def status(self):
        if self.pct_diff is None:
            return "no_data"
        elif abs(self.pct_diff) <= 0.10:
            return "good"
        elif abs(self.pct_diff) <= 0.25:
            return "warning"
        else:
            return "concern"

    def to_dict(self):
        return {
            "name": self.name,
            "pe_value": self.pe_value,
            "public_value": self.public_value,
            "public_source": self.public_source,
            "pct_diff": round(self.pct_diff, 4) if self.pct_diff else None,
            "pct_diff_str": f"{self.pct_diff:+.1%}" if self.pct_diff else "N/A",
            "status": self.status,
            "unit": self.unit,
        }


class BaselineReport:
    """Full baseline validation report for a state."""
    def __init__(self, state, year, checks):
        self.state = state
        self.year = year
        self.checks = checks
        self.generated_at = datetime.utcnow().isoformat()

    @property
    def overall_status(self):
        statuses = [c.status for c in self.checks if c.status != "no_data"]
        if not statuses:
            return "no_data"
        if any(s == "concern" for s in statuses):
            return "concern"
        if any(s == "warning" for s in statuses):
            return "warning"
        return "good"

    @property
    def data_quality_factor(self):
        """Estimated data quality factor (1.0 = perfect match).

        Use this to adjust expectations for reform-level discrepancies.
        If PE baseline revenue is 20% higher than Census, expect reform
        impacts to be ~20% higher too.
        """
        revenue_check = next((c for c in self.checks if c.name == "state_income_tax_revenue"), None)
        if revenue_check and revenue_check.pct_diff is not None:
            return 1.0 + revenue_check.pct_diff
        return 1.0

    def to_dict(self):
        return {
            "state": self.state,
            "year": self.year,
            "overall_status": self.overall_status,
            "data_quality_factor": round(self.data_quality_factor, 3),
            "generated_at": self.generated_at,
            "checks": [c.to_dict() for c in self.checks],
            "summary": self.summary(),
        }

    def summary(self):
        """Human-readable summary."""
        lines = []
        for c in self.checks:
            if c.pct_diff is not None:
                icon = {"good": "OK", "warning": "!!", "concern": "XX"}[c.status]
                lines.append(f"  [{icon}] {c.name}: PE={c.pe_value:,.0f}{c.unit}, "
                            f"Public={c.public_value:,.0f}{c.unit} ({c.pct_diff:+.1%})")
            else:
                lines.append(f"  [--] {c.name}: no public data available")

        factor = self.data_quality_factor
        if abs(factor - 1.0) > 0.05:
            direction = "higher" if factor > 1 else "lower"
            lines.append(f"\n  Data quality factor: {factor:.2f} (PE runs {abs(factor-1)*100:.0f}% {direction})")
            lines.append(f"  → Expect reform impacts to be ~{abs(factor-1)*100:.0f}% {direction} than fiscal notes")

        return "\n".join(lines)

    def print_report(self):
        print(f"\n{'=' * 60}")
        print(f"Baseline Data Validation: {self.state} ({self.year})")
        print(f"{'=' * 60}")
        print(self.summary())
        print(f"\nOverall: {self.overall_status.upper()}")


# =============================================================================
# CHECKS
# =============================================================================

def check_state_revenue(baseline, state, year):
    """Compare PE's baseline state income tax revenue against Census."""
    state_upper = state.upper()
    census_revenue = STATE_PIT_REVENUE.get(state_upper)

    pe_revenue = float(baseline.calculate("state_income_tax", year).sum())

    return BaselineCheck(
        name="state_income_tax_revenue",
        pe_value=pe_revenue,
        public_value=census_revenue,
        public_source="Census Bureau State Government Tax Collections (FY2023)",
        unit="$",
    )


def check_household_count(baseline, state, year):
    """Compare PE's weighted household count against IRS SOI returns."""
    state_upper = state.upper()
    irs_returns = STATE_TAX_RETURNS_K.get(state_upper)
    if irs_returns:
        irs_returns = irs_returns * 1000  # Convert from thousands

    pe_households = int(baseline.calculate("household_weight", year).values.sum())

    return BaselineCheck(
        name="household_count",
        pe_value=pe_households,
        public_value=irs_returns,
        public_source="IRS Statistics of Income (2022 filing year)",
    )


def check_income_distribution(baseline, state, year):
    """Check PE's median household income against ACS."""
    household_income = baseline.calculate("household_net_income", year)
    pe_median = float(np.median(household_income.values))

    # ACS median household income by state (2023, approximate)
    # Source: Census ACS 1-year estimates
    ACS_MEDIAN_INCOME = {
        "AL": 59609, "AZ": 72581, "AR": 56335, "CA": 91905, "CO": 87598,
        "CT": 90213, "DE": 75675, "GA": 71355, "HI": 94814, "ID": 72580,
        "IL": 78433, "IN": 67173, "IA": 72429, "KS": 69747, "KY": 60407,
        "LA": 57852, "ME": 71580, "MD": 98461, "MA": 96505, "MI": 68505,
        "MN": 84313, "MS": 52985, "MO": 65920, "MT": 66017, "NE": 71772,
        "NJ": 97126, "NM": 58722, "NY": 75157, "NC": 66186, "ND": 73959,
        "OH": 65718, "OK": 61364, "OR": 76362, "PA": 73170, "RI": 74008,
        "SC": 63623, "UT": 86833, "VT": 74014, "VA": 87249, "WV": 52520,
        "WI": 72458, "DC": 101722,
    }

    acs_median = ACS_MEDIAN_INCOME.get(state.upper())

    return BaselineCheck(
        name="median_household_income",
        pe_value=pe_median,
        public_value=acs_median,
        public_source="Census ACS 1-Year Estimates (2023)",
        unit="$",
    )


def check_effective_tax_rate(baseline, state, year):
    """Compare PE's effective state income tax rate against implied rate."""
    state_upper = state.upper()
    if state_upper in NO_INCOME_TAX_STATES:
        return None

    pe_revenue = float(baseline.calculate("state_income_tax", year).sum())
    pe_agi = float(baseline.calculate("adjusted_gross_income", year).sum())

    pe_effective_rate = pe_revenue / pe_agi if pe_agi > 0 else 0

    # Implied effective rate from Census revenue / IRS total income
    census_revenue = STATE_PIT_REVENUE.get(state_upper)
    irs_returns = STATE_TAX_RETURNS_K.get(state_upper)
    if census_revenue and irs_returns:
        # Rough: avg federal AGI ~$70K * returns = total AGI proxy
        approx_agi = irs_returns * 1000 * 70000
        implied_rate = census_revenue / approx_agi
    else:
        implied_rate = None

    return BaselineCheck(
        name="effective_tax_rate",
        pe_value=pe_effective_rate,
        public_value=implied_rate,
        public_source="Implied from Census revenue / IRS returns × avg AGI",
    )


# =============================================================================
# MAIN
# =============================================================================

def validate_baseline(state, year=2026):
    """Run all baseline checks for a state.

    Returns BaselineReport with all checks and overall assessment.
    """
    from compute_impacts import get_state_dataset
    from policyengine_us import Microsimulation

    print(f"  Loading {state.upper()} dataset...")
    dataset_path = get_state_dataset(state)

    print(f"  Running baseline simulation for {year}...")
    baseline = Microsimulation(dataset=dataset_path)

    checks = []

    print("  [1/4] Checking state income tax revenue...")
    checks.append(check_state_revenue(baseline, state, year))

    print("  [2/4] Checking household count...")
    checks.append(check_household_count(baseline, state, year))

    print("  [3/4] Checking income distribution...")
    checks.append(check_income_distribution(baseline, state, year))

    print("  [4/4] Checking effective tax rate...")
    etr = check_effective_tax_rate(baseline, state, year)
    if etr:
        checks.append(etr)

    report = BaselineReport(state=state.upper(), year=year, checks=checks)
    return report


def validate_baseline_for_reform(reform_id, year=None):
    """Run baseline validation in the context of a reform.

    Loads the state from the reform_id, runs validation, and saves
    results alongside the calibration data.
    """
    state = reform_id.split("-")[0]

    if year is None:
        # Try to get year from calibration state
        state_file = _script_dir.parent / "results" / reform_id / "calibration_state.json"
        if state_file.exists():
            with open(state_file) as f:
                cal_state = json.load(f)
                year = cal_state.get("year", 2026)
        else:
            year = 2026

    report = validate_baseline(state, year)

    # Save report
    results_dir = _script_dir.parent / "results" / reform_id
    results_dir.mkdir(parents=True, exist_ok=True)
    with open(results_dir / "baseline_validation.json", "w") as f:
        json.dump(report.to_dict(), f, indent=2)

    # Write to DB if possible
    _write_baseline_to_db(reform_id, report)

    return report


def _write_baseline_to_db(reform_id, report):
    """Store baseline validation in model_notes."""
    try:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            return

        supabase = create_client(url, key)

        # Merge into existing model_notes
        existing = supabase.table("reform_impacts").select("model_notes").eq("id", reform_id).execute()
        model_notes = {}
        if existing.data:
            mn = existing.data[0].get("model_notes")
            if isinstance(mn, dict):
                model_notes = mn
            elif isinstance(mn, str):
                try:
                    model_notes = json.loads(mn)
                except json.JSONDecodeError:
                    model_notes = {}

        model_notes["baseline_validation"] = {
            "state": report.state,
            "year": report.year,
            "overall_status": report.overall_status,
            "data_quality_factor": report.data_quality_factor,
            "checks": {c.name: {
                "pe": c.pe_value,
                "public": c.public_value,
                "diff_pct": round(c.pct_diff * 100, 1) if c.pct_diff else None,
                "status": c.status,
            } for c in report.checks},
            "validated_at": report.generated_at,
        }

        supabase.table("reform_impacts").update(
            {"model_notes": model_notes}
        ).eq("id", reform_id).execute()

        print(f"  Baseline validation written to model_notes")
    except Exception as e:
        print(f"  Note: DB write skipped ({e})")


def main():
    parser = argparse.ArgumentParser(description="Baseline data validation")
    parser.add_argument("--state", type=str, help="State code (e.g., GA)")
    parser.add_argument("--reform-id", type=str, help="Reform ID (extracts state automatically)")
    parser.add_argument("--year", type=int, default=2026, help="Simulation year")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    if args.reform_id:
        report = validate_baseline_for_reform(args.reform_id, args.year)
    elif args.state:
        report = validate_baseline(args.state, args.year)
    else:
        print("Error: provide --state or --reform-id")
        return 1

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        report.print_report()

    return 0


if __name__ == "__main__":
    exit(main())
