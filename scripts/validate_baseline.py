#!/usr/bin/env python3
"""
Iterative baseline data diagnostic.

Decomposes the gap between PE and public data sources step by step,
where each finding informs what to check next. Like autoresearch
but for data: each iteration narrows the diagnosis until the gap
is fully attributed.

Usage:
    python scripts/validate_baseline.py --state GA --year 2026
    python scripts/validate_baseline.py --reform-id ga-hb1001
    python scripts/validate_baseline.py --state GA --year 2026 --json

Diagnostic chain:
    1. Total revenue gap → decompose into rate vs base
    2. Rate gap → check bracket population distribution
    3. Base gap → check income distribution by decile
    4. Weight gap → check population weights vs Census
    5. Attribution → sum up explained portions
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

from validation_harness import STATE_PIT_REVENUE, NO_INCOME_TAX_STATES

RESULTS_DIR = _script_dir.parent / "results"


# =============================================================================
# PUBLIC DATA
# =============================================================================

# IRS SOI state-level returns (2022 filing year, thousands)
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

# Census ACS median household income by state (2023)
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


# =============================================================================
# DIAGNOSTIC FINDING
# =============================================================================

class Finding:
    """One step in the diagnostic chain."""
    def __init__(self, step, check, pe_value, public_value, public_source,
                 pct_diff, attribution_pct, explanation, next_check=None):
        self.step = step
        self.check = check
        self.pe_value = pe_value
        self.public_value = public_value
        self.public_source = public_source
        self.pct_diff = pct_diff  # PE vs public
        self.attribution_pct = attribution_pct  # How much of total gap this explains
        self.explanation = explanation
        self.next_check = next_check  # What to investigate next

    def to_dict(self):
        return {
            "step": self.step,
            "check": self.check,
            "pe_value": self.pe_value,
            "public_value": self.public_value,
            "public_source": self.public_source,
            "pct_diff": round(self.pct_diff, 4) if self.pct_diff else None,
            "attribution_pct": round(self.attribution_pct, 4) if self.attribution_pct else None,
            "explanation": self.explanation,
            "next_check": self.next_check,
        }


class DiagnosticReport:
    """Full iterative diagnostic report."""
    def __init__(self, state, year):
        self.state = state
        self.year = year
        self.findings = []
        self.total_gap_pct = 0  # Set after step 1
        self.attributed_pct = 0  # Sum of attribution_pct across findings
        self.generated_at = datetime.now(timezone.utc).isoformat()

    def add(self, finding):
        self.findings.append(finding)
        if finding.attribution_pct:
            self.attributed_pct += abs(finding.attribution_pct)

    @property
    def unattributed_pct(self):
        return max(0, abs(self.total_gap_pct) - self.attributed_pct)

    @property
    def data_quality_factor(self):
        """PE runs this factor relative to public data."""
        if self.findings and self.findings[0].pct_diff is not None:
            return 1.0 + self.findings[0].pct_diff
        return 1.0

    def to_dict(self):
        return {
            "state": self.state,
            "year": self.year,
            "total_gap_pct": round(self.total_gap_pct, 4),
            "attributed_pct": round(self.attributed_pct, 4),
            "unattributed_pct": round(self.unattributed_pct, 4),
            "data_quality_factor": round(self.data_quality_factor, 3),
            "findings": [f.to_dict() for f in self.findings],
            "generated_at": self.generated_at,
        }

    def print_report(self):
        print(f"\n{'=' * 70}")
        print(f"Baseline Data Diagnostic: {self.state} ({self.year})")
        print(f"{'=' * 70}")

        for f in self.findings:
            status = "XX" if abs(f.pct_diff or 0) > 0.20 else "!!" if abs(f.pct_diff or 0) > 0.10 else "OK"
            attr = f"  → Explains {f.attribution_pct:.0%} of gap" if f.attribution_pct else ""
            print(f"\n  Step {f.step}: {f.check}")
            print(f"    [{status}] PE: {_fmt(f.pe_value)} vs Public: {_fmt(f.public_value)} ({f.pct_diff:+.1%})")
            print(f"    {f.explanation}{attr}")
            if f.next_check:
                print(f"    → Next: {f.next_check}")

        print(f"\n{'-' * 70}")
        print(f"  Total gap: {self.total_gap_pct:+.1%}")
        print(f"  Attributed: {self.attributed_pct:.1%}")
        print(f"  Unattributed: {self.unattributed_pct:.1%}")
        factor = self.data_quality_factor
        if abs(factor - 1.0) > 0.05:
            direction = "higher" if factor > 1 else "lower"
            print(f"  Data quality factor: {factor:.2f} (PE runs {abs(factor-1)*100:.0f}% {direction})")


def _fmt(v):
    """Format a number for display."""
    if v is None:
        return "N/A"
    if abs(v) >= 1e9:
        return f"${v/1e9:.2f}B"
    if abs(v) >= 1e6:
        return f"${v/1e6:.1f}M"
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:.4f}"


# =============================================================================
# DIAGNOSTIC STEPS
# =============================================================================

def step1_total_revenue(baseline, state, year, report):
    """Step 1: Compare total state income tax revenue."""
    state_upper = state.upper()
    census_revenue = STATE_PIT_REVENUE.get(state_upper)
    if not census_revenue:
        return None

    pe_revenue = float(baseline.calculate("state_income_tax", year).sum())
    pct_diff = (pe_revenue - census_revenue) / abs(census_revenue)
    report.total_gap_pct = pct_diff

    if abs(pct_diff) < 0.05:
        explanation = "PE baseline revenue closely matches Census. Data is well calibrated."
        next_check = None
    else:
        direction = "higher" if pct_diff > 0 else "lower"
        explanation = f"PE baseline revenue is {abs(pct_diff):.0%} {direction} than Census."
        next_check = "Decompose: is the gap from effective rate or taxable base?"

    report.add(Finding(
        step=1, check="Total state income tax revenue",
        pe_value=pe_revenue, public_value=census_revenue,
        public_source="Census Bureau State Tax Collections (FY2023)",
        pct_diff=pct_diff, attribution_pct=None,
        explanation=explanation, next_check=next_check,
    ))
    return pct_diff


def step2_rate_vs_base(baseline, state, year, report):
    """Step 2: Decompose revenue gap into effective rate × taxable base."""
    state_upper = state.upper()
    census_revenue = STATE_PIT_REVENUE.get(state_upper, 0)
    irs_returns = STATE_TAX_RETURNS_K.get(state_upper)

    pe_revenue = float(baseline.calculate("state_income_tax", year).sum())
    pe_agi = float(baseline.calculate("adjusted_gross_income", year).sum())
    pe_households = float(baseline.calculate("household_weight", year).values.sum())

    pe_effective_rate = pe_revenue / pe_agi if pe_agi > 0 else 0

    # Implied effective rate from Census data
    if irs_returns and census_revenue:
        # IRS SOI: avg AGI per return × returns = approx total AGI
        # Using $70K as rough national avg (adjustable)
        implied_agi = irs_returns * 1000 * 70000
        implied_rate = census_revenue / implied_agi if implied_agi > 0 else 0
    else:
        implied_agi = None
        implied_rate = None

    # Rate contribution to gap
    rate_diff = None
    base_diff = None
    if implied_rate and implied_rate > 0:
        rate_diff = (pe_effective_rate - implied_rate) / implied_rate
    if implied_agi and implied_agi > 0:
        base_diff = (pe_agi - implied_agi) / implied_agi

    # Attribute the total revenue gap
    total_gap = report.total_gap_pct
    rate_attribution = 0
    base_attribution = 0

    if rate_diff is not None and base_diff is not None and total_gap != 0:
        # Revenue = rate × base, so gap ≈ rate_gap + base_gap (first-order)
        total_parts = abs(rate_diff) + abs(base_diff)
        if total_parts > 0:
            rate_attribution = abs(total_gap) * (abs(rate_diff) / total_parts)
            base_attribution = abs(total_gap) * (abs(base_diff) / total_parts)

    report.add(Finding(
        step=2, check="Effective tax rate",
        pe_value=pe_effective_rate, public_value=implied_rate,
        public_source="Implied from Census revenue / (IRS returns × avg AGI)",
        pct_diff=rate_diff,
        attribution_pct=rate_attribution,
        explanation=f"PE effective rate: {pe_effective_rate:.2%} vs implied: {implied_rate:.2%}."
                    if implied_rate else "Could not compute implied rate.",
        next_check="Check income distribution by decile" if (base_diff and abs(base_diff) > 0.10)
                   else "Check bracket population distribution" if (rate_diff and abs(rate_diff) > 0.10)
                   else None,
    ))

    report.add(Finding(
        step=2, check="Taxable income base (total AGI)",
        pe_value=pe_agi, public_value=implied_agi,
        public_source="IRS SOI returns × national avg AGI ($70K)",
        pct_diff=base_diff,
        attribution_pct=base_attribution,
        explanation=f"PE total AGI: {_fmt(pe_agi)} vs implied: {_fmt(implied_agi)}."
                    if implied_agi else "Could not compute implied AGI.",
        next_check=None,
    ))

    return rate_diff, base_diff


def step3_income_distribution(baseline, state, year, report):
    """Step 3: Check income distribution by decile — where is the base off?"""
    decile = baseline.calculate("household_income_decile", year)
    income = baseline.calculate("household_net_income", year)
    weights = baseline.calculate("household_weight", year)

    pe_decile_avg = {}
    pe_decile_total = {}
    for d in range(1, 11):
        mask = decile.values == d
        if not np.any(mask):
            continue
        from microdf import MicroSeries
        inc_d = MicroSeries(income.values[mask], weights=weights.values[mask])
        pe_decile_avg[d] = float(inc_d.mean())
        pe_decile_total[d] = float(inc_d.sum())

    # Compare top decile (most impactful for revenue)
    pe_top_avg = pe_decile_avg.get(10, 0)
    pe_bottom_avg = pe_decile_avg.get(1, 0)

    acs_median = ACS_MEDIAN_INCOME.get(state.upper())
    pe_median_approx = pe_decile_avg.get(5, 0)

    median_diff = None
    if acs_median and acs_median > 0:
        median_diff = (pe_median_approx - acs_median) / acs_median

    # Top decile carries most of the revenue — check if it's inflated
    # Top decile typically has ~45% of total income
    total_income = sum(pe_decile_total.values())
    top_share = pe_decile_total.get(10, 0) / total_income if total_income > 0 else 0
    # National benchmark: top decile ≈ 45-50% of income
    expected_top_share = 0.47
    top_share_diff = (top_share - expected_top_share) / expected_top_share

    # Attribution: if top decile share is off, that distorts revenue
    total_gap = abs(report.total_gap_pct)
    top_attribution = min(abs(top_share_diff) * 0.5, total_gap * 0.3)  # Cap at 30% of gap

    report.add(Finding(
        step=3, check="Median income (decile 5 avg)",
        pe_value=pe_median_approx, public_value=acs_median,
        public_source="Census ACS 1-Year Estimates (2023)",
        pct_diff=median_diff,
        attribution_pct=None,
        explanation=f"PE median-area income: ${pe_median_approx:,.0f} vs ACS: ${acs_median:,.0f}."
                    if acs_median else "No ACS data available.",
        next_check=None,
    ))

    report.add(Finding(
        step=3, check="Top decile income share",
        pe_value=top_share, public_value=expected_top_share,
        public_source="National benchmark (~47% of total income)",
        pct_diff=top_share_diff,
        attribution_pct=top_attribution if abs(top_share_diff) > 0.05 else 0,
        explanation=f"PE top decile holds {top_share:.1%} of income (expected ~{expected_top_share:.0%}). "
                    + ("Higher concentration → higher revenue." if top_share > expected_top_share
                       else "Lower concentration → lower revenue."),
        next_check="Check household weights vs Census population" if abs(top_share_diff) > 0.10 else None,
    ))


def step4_population_weights(baseline, state, year, report):
    """Step 4: Check PE population weights against Census estimates."""
    state_upper = state.upper()
    irs_returns = STATE_TAX_RETURNS_K.get(state_upper)

    pe_households = float(baseline.calculate("household_weight", year).values.sum())
    public_hh = irs_returns * 1000 if irs_returns else None

    hh_diff = None
    if public_hh and public_hh > 0:
        hh_diff = (pe_households - public_hh) / public_hh

    # If PE has fewer households but higher revenue, income per HH is inflated
    total_gap = abs(report.total_gap_pct)
    weight_attribution = min(abs(hh_diff) * 0.3, total_gap * 0.2) if hh_diff else 0

    report.add(Finding(
        step=4, check="Household / filer count",
        pe_value=pe_households, public_value=public_hh,
        public_source="IRS SOI (2022 filing year, individual returns)",
        pct_diff=hh_diff,
        attribution_pct=weight_attribution if hh_diff and abs(hh_diff) > 0.05 else 0,
        explanation=f"PE: {pe_households:,.0f} households vs IRS: {public_hh:,.0f} returns."
                    if public_hh else "No IRS data available.",
        next_check=None,
    ))


def step5_summarize(report):
    """Step 5: Summarize attribution and remaining unattributed gap."""
    unattr = report.unattributed_pct
    total = abs(report.total_gap_pct)

    if total < 0.05:
        summary = "PE baseline closely matches public data. Minimal data-level gap."
    elif unattr < 0.05:
        summary = f"Gap of {total:.0%} fully attributed to data factors above."
    elif unattr < total * 0.5:
        summary = (f"Gap of {total:.0%}: {report.attributed_pct:.0%} attributed to data factors above, "
                   f"{unattr:.0%} remaining (likely CPS sampling variance, imputation, or uprating).")
    else:
        summary = (f"Gap of {total:.0%}: only {report.attributed_pct:.0%} attributed so far. "
                   f"Remaining {unattr:.0%} may reflect state-specific CPS limitations, "
                   f"missing deduction/credit variables, or data vintage differences.")

    report.add(Finding(
        step=5, check="Gap attribution summary",
        pe_value=report.attributed_pct, public_value=total,
        public_source="Computed from above checks",
        pct_diff=None,
        attribution_pct=None,
        explanation=summary,
        next_check=None,
    ))


# =============================================================================
# MAIN DIAGNOSTIC LOOP
# =============================================================================

def run_diagnostic(state, year=2026):
    """Run the iterative diagnostic chain for a state.

    Each step's findings drive the next step — like autoresearch but for data.
    """
    from compute_impacts import get_state_dataset
    from policyengine_us import Microsimulation

    state_upper = state.upper()
    if state_upper in NO_INCOME_TAX_STATES:
        print(f"  {state_upper} has no income tax — skipping diagnostic")
        return None

    print(f"  Loading {state_upper} dataset...")
    dataset_path = get_state_dataset(state)

    print(f"  Running baseline simulation for {year}...")
    baseline = Microsimulation(dataset=dataset_path)

    report = DiagnosticReport(state=state_upper, year=year)

    # Step 1: Total revenue
    print(f"  Step 1: Total revenue comparison...")
    gap = step1_total_revenue(baseline, state, year, report)

    if gap is None:
        print(f"  No Census revenue data for {state_upper}")
        return report

    if abs(gap) < 0.05:
        print(f"  Revenue gap < 5% — data is well calibrated, stopping early.")
        step5_summarize(report)
        return report

    # Step 2: Decompose into rate vs base
    print(f"  Step 2: Rate vs base decomposition...")
    rate_diff, base_diff = step2_rate_vs_base(baseline, state, year, report)

    # Step 3: Income distribution (always run — most informative)
    print(f"  Step 3: Income distribution by decile...")
    step3_income_distribution(baseline, state, year, report)

    # Step 4: Population weights
    print(f"  Step 4: Population weights...")
    step4_population_weights(baseline, state, year, report)

    # Step 5: Summarize
    print(f"  Step 5: Attribution summary...")
    step5_summarize(report)

    return report


def run_diagnostic_for_reform(reform_id, year=None):
    """Run diagnostic in context of a reform. Saves results."""
    state = reform_id.split("-")[0]

    if year is None:
        state_file = RESULTS_DIR / reform_id / "calibration_state.json"
        if state_file.exists():
            with open(state_file) as f:
                year = json.load(f).get("year", 2026)
        else:
            year = 2026

    report = run_diagnostic(state, year)
    if not report:
        return None

    # Save locally
    results_dir = RESULTS_DIR / reform_id
    results_dir.mkdir(parents=True, exist_ok=True)

    with open(results_dir / "baseline_diagnostic.json", "w") as f:
        json.dump(report.to_dict(), f, indent=2)

    # Also save the diagnostic log as TSV (like calibration.tsv)
    with open(results_dir / "data_diagnostic.tsv", "w", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["step", "check", "pe_value", "public_value", "pct_diff", "attribution", "explanation"])
        for finding in report.findings:
            writer.writerow([
                finding.step, finding.check,
                f"{finding.pe_value:,.0f}" if isinstance(finding.pe_value, (int, float)) else str(finding.pe_value),
                f"{finding.public_value:,.0f}" if isinstance(finding.public_value, (int, float)) else str(finding.public_value),
                f"{finding.pct_diff:+.1%}" if finding.pct_diff else "—",
                f"{finding.attribution_pct:.1%}" if finding.attribution_pct else "—",
                finding.explanation[:80],
            ])

    # Write to DB
    _write_diagnostic_to_db(reform_id, report)

    return report


def _write_diagnostic_to_db(reform_id, report):
    """Store diagnostic in model_notes."""
    try:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            return

        supabase = create_client(url, key)

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

        model_notes["baseline_diagnostic"] = {
            "state": report.state,
            "year": report.year,
            "total_gap_pct": round(report.total_gap_pct * 100, 1),
            "attributed_pct": round(report.attributed_pct * 100, 1),
            "unattributed_pct": round(report.unattributed_pct * 100, 1),
            "data_quality_factor": round(report.data_quality_factor, 3),
            "findings": [
                {
                    "check": f.check,
                    "pct_diff": round(f.pct_diff * 100, 1) if f.pct_diff else None,
                    "attribution": round(f.attribution_pct * 100, 1) if f.attribution_pct else None,
                    "explanation": f.explanation,
                }
                for f in report.findings
            ],
            "diagnosed_at": report.generated_at,
        }

        supabase.table("reform_impacts").update(
            {"model_notes": model_notes}
        ).eq("id", reform_id).execute()
        print(f"  Diagnostic written to model_notes")
    except Exception as e:
        print(f"  Note: DB write skipped ({e})")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Iterative baseline data diagnostic")
    parser.add_argument("--state", type=str, help="State code (e.g., GA)")
    parser.add_argument("--reform-id", type=str, help="Reform ID (extracts state)")
    parser.add_argument("--year", type=int, default=2026, help="Simulation year")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    if args.reform_id:
        report = run_diagnostic_for_reform(args.reform_id, args.year)
    elif args.state:
        report = run_diagnostic(args.state, args.year)
    else:
        print("Error: provide --state or --reform-id")
        return 1

    if not report:
        return 1

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        report.print_report()

    return 0


if __name__ == "__main__":
    exit(main())
