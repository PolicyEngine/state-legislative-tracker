#!/usr/bin/env python3
"""
Reform-specific, durable data diagnostic engine.

Instead of generic checks, this engine:
1. Detects what kind of reform is being scored (rate change, EITC, CTC, etc.)
2. Selects diagnostic checks relevant to THAT reform's variables
3. Checks the data_findings table for cached results (skip if fresh)
4. Runs fresh checks only where needed, stores findings durably
5. Produces reform-specific attribution of the PE vs external gap

Findings persist across reforms: "GA AGI is 19% above IRS SOI" is a fact
about the data, not about any one bill. Every future GA reform that depends
on AGI gets this finding for free.

Usage:
    python scripts/validate_baseline.py --reform-id ga-hb1001
    python scripts/validate_baseline.py --state GA --year 2026
    python scripts/validate_baseline.py --state GA --year 2026 --json
"""

import argparse
import json
import os
import re
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
MAX_FINDING_AGE_DAYS = 30


# =============================================================================
# PUBLIC BENCHMARKS
# =============================================================================

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
# REFORM TYPE DETECTION
# =============================================================================

def detect_reform_type(reform_params, provisions=None):
    """Classify reform from params to select relevant diagnostics."""
    types = set()
    for path in reform_params.keys():
        if path.startswith("_"):
            continue
        p = path.lower()
        if "rate" in p and "bracket" in p:
            types.add("rate_change")
            # Detect top vs bottom bracket
            bracket_match = re.search(r"brackets\[(\d+)\]", p)
            if bracket_match and int(bracket_match.group(1)) >= 4:
                types.add("top_bracket_change")
            if bracket_match and int(bracket_match.group(1)) <= 1:
                types.add("bottom_bracket_change")
        elif "rate" in p:
            types.add("rate_change")
        if "eitc" in p or "earned_income" in p:
            types.add("eitc_change")
        if "ctc" in p or "child_tax_credit" in p or ("child" in p and "credit" in p):
            types.add("ctc_change")
        if "deduction" in p or "standard" in p:
            types.add("deduction_change")
        if "exemption" in p:
            types.add("exemption_change")
        if "property" in p:
            types.add("property_tax_change")
        if "threshold" in p or "bracket" in p:
            types.add("bracket_change")

    if not types:
        types.add("general")
    return types


# =============================================================================
# FINDING
# =============================================================================

class Finding:
    def __init__(self, variable, pe_value, benchmark_value, benchmark_source,
                 pct_diff, finding_text, relevant_to=None, cached=False):
        self.variable = variable
        self.pe_value = pe_value
        self.benchmark_value = benchmark_value
        self.benchmark_source = benchmark_source
        self.pct_diff = pct_diff
        self.finding_text = finding_text
        self.relevant_to = relevant_to or []
        self.cached = cached

    def to_dict(self):
        return {
            "variable": self.variable,
            "pe_value": self.pe_value,
            "benchmark_value": self.benchmark_value,
            "benchmark_source": self.benchmark_source,
            "pct_diff": round(self.pct_diff, 4) if self.pct_diff is not None else None,
            "finding": self.finding_text,
            "cached": self.cached,
        }


# =============================================================================
# DIAGNOSTIC CHECKS (the registry)
# =============================================================================

def check_total_revenue(baseline, state, year):
    """Total state income tax revenue: PE vs Census Bureau."""
    census = STATE_PIT_REVENUE.get(state.upper())
    if not census:
        return None
    pe = float(baseline.calculate("state_income_tax", year).sum())
    diff = (pe - census) / abs(census)
    direction = "higher" if diff > 0 else "lower"
    return Finding(
        variable="state_income_tax_total",
        pe_value=pe, benchmark_value=census,
        benchmark_source="Census Bureau State Tax Collections (FY2023)",
        pct_diff=diff,
        finding_text=f"PE total state income tax {abs(diff):.0%} {direction} than Census ({_fmt(pe)} vs {_fmt(census)})",
        relevant_to=["rate_change", "bracket_change", "deduction_change", "general"],
    )


def check_household_count(baseline, state, year):
    """Number of households: PE vs IRS SOI returns."""
    irs = STATE_TAX_RETURNS_K.get(state.upper())
    if not irs:
        return None
    irs_total = irs * 1000
    pe = float(baseline.calculate("household_weight", year).values.sum())
    diff = (pe - irs_total) / irs_total
    return Finding(
        variable="household_count",
        pe_value=pe, benchmark_value=irs_total,
        benchmark_source="IRS SOI (2022 filing year)",
        pct_diff=diff,
        finding_text=f"PE has {abs(diff):.0%} {'more' if diff > 0 else 'fewer'} households than IRS returns ({pe:,.0f} vs {irs_total:,.0f})",
        relevant_to=["rate_change", "eitc_change", "ctc_change", "deduction_change", "general"],
    )


def check_total_agi(baseline, state, year):
    """Total adjusted gross income: PE vs IRS SOI estimate."""
    irs_returns = STATE_TAX_RETURNS_K.get(state.upper())
    if not irs_returns:
        return None
    # IRS SOI: national avg AGI ~$75K per return (approximate)
    implied_agi = irs_returns * 1000 * 75000
    pe_agi = float(baseline.calculate("adjusted_gross_income", year).sum())
    diff = (pe_agi - implied_agi) / abs(implied_agi)
    return Finding(
        variable="adjusted_gross_income",
        pe_value=pe_agi, benchmark_value=implied_agi,
        benchmark_source="IRS SOI returns × national avg AGI (~$75K)",
        pct_diff=diff,
        finding_text=f"PE total AGI {abs(diff):.0%} {'above' if diff > 0 else 'below'} IRS estimate ({_fmt(pe_agi)} vs {_fmt(implied_agi)})",
        relevant_to=["rate_change", "bracket_change", "deduction_change", "general"],
    )


def check_top_decile_income(baseline, state, year):
    """Top decile income concentration."""
    income = baseline.calculate("household_net_income", year)
    decile = baseline.calculate("household_income_decile", year)
    weights = baseline.calculate("household_weight", year)

    total = float((income * weights).sum())
    top_mask = decile.values == 10
    if not np.any(top_mask):
        return None

    from microdf import MicroSeries
    top_income = MicroSeries(income.values[top_mask], weights=weights.values[top_mask])
    top_total = float(top_income.sum())
    top_share = top_total / total if total > 0 else 0

    benchmark = 0.47  # National avg: top decile ≈ 47% of income
    diff = (top_share - benchmark) / benchmark
    return Finding(
        variable="top_decile_income_share",
        pe_value=top_share, benchmark_value=benchmark,
        benchmark_source="National benchmark (~47%)",
        pct_diff=diff,
        finding_text=f"Top decile holds {top_share:.1%} of income (benchmark: {benchmark:.0%}). {'Concentrated' if diff > 0 else 'Dispersed'}.",
        relevant_to=["rate_change", "top_bracket_change", "bracket_change"],
    )


def check_bottom_decile_income(baseline, state, year):
    """Bottom decile income — relevant for EITC/poverty reforms."""
    income = baseline.calculate("household_net_income", year)
    decile = baseline.calculate("household_income_decile", year)
    weights = baseline.calculate("household_weight", year)

    bot_mask = decile.values == 1
    if not np.any(bot_mask):
        return None

    from microdf import MicroSeries
    bot_income = MicroSeries(income.values[bot_mask], weights=weights.values[bot_mask])
    pe_avg = float(bot_income.mean())

    # Rough benchmark: bottom decile avg ≈ 15-20% of median
    acs_median = ACS_MEDIAN_INCOME.get(state.upper(), 70000)
    benchmark = acs_median * 0.17
    diff = (pe_avg - benchmark) / abs(benchmark) if benchmark else None
    return Finding(
        variable="bottom_decile_avg_income",
        pe_value=pe_avg, benchmark_value=benchmark,
        benchmark_source=f"~17% of ACS median (${acs_median:,.0f})",
        pct_diff=diff,
        finding_text=f"Bottom decile avg: ${pe_avg:,.0f} (benchmark: ${benchmark:,.0f})",
        relevant_to=["eitc_change", "ctc_change", "bottom_bracket_change"],
    )


def check_median_income(baseline, state, year):
    """Median household income: PE vs ACS."""
    acs = ACS_MEDIAN_INCOME.get(state.upper())
    if not acs:
        return None
    income = baseline.calculate("household_net_income", year)
    pe_median = float(np.median(income.values))
    diff = (pe_median - acs) / abs(acs)
    return Finding(
        variable="median_household_income",
        pe_value=pe_median, benchmark_value=acs,
        benchmark_source="Census ACS 1-Year (2023)",
        pct_diff=diff,
        finding_text=f"PE median income: ${pe_median:,.0f} vs ACS: ${acs:,.0f} ({diff:+.0%})",
        relevant_to=["deduction_change", "bracket_change", "general"],
    )


def check_earned_income(baseline, state, year):
    """Earned income total — critical for EITC reforms."""
    pe_earned = float(baseline.calculate("earned_income", year).sum())
    # Benchmark: earned income ≈ 75-80% of AGI nationally
    pe_agi = float(baseline.calculate("adjusted_gross_income", year).sum())
    earned_share = pe_earned / pe_agi if pe_agi > 0 else 0
    benchmark_share = 0.77  # National avg
    diff = (earned_share - benchmark_share) / benchmark_share
    return Finding(
        variable="earned_income_share",
        pe_value=earned_share, benchmark_value=benchmark_share,
        benchmark_source="National avg earned/AGI ratio (~77%)",
        pct_diff=diff,
        finding_text=f"Earned income is {earned_share:.0%} of AGI (national avg: {benchmark_share:.0%})",
        relevant_to=["eitc_change", "rate_change"],
    )


def check_child_households(baseline, state, year):
    """Households with children — critical for CTC reforms."""
    # Count people under 18
    age = baseline.calculate("age", year)
    person_weight = baseline.calculate("person_weight", year)
    children = float(person_weight[age.values < 18].values.sum())
    total_pop = float(person_weight.values.sum())
    child_share = children / total_pop if total_pop > 0 else 0

    # National benchmark: ~22% of population is under 18
    benchmark = 0.22
    diff = (child_share - benchmark) / benchmark
    return Finding(
        variable="child_population_share",
        pe_value=child_share, benchmark_value=benchmark,
        benchmark_source="Census (~22% of population under 18)",
        pct_diff=diff,
        finding_text=f"Under-18 share: {child_share:.1%} (benchmark: {benchmark:.0%})",
        relevant_to=["ctc_change"],
    )


def check_effective_tax_rate(baseline, state, year):
    """Effective state income tax rate."""
    census_rev = STATE_PIT_REVENUE.get(state.upper())
    pe_revenue = float(baseline.calculate("state_income_tax", year).sum())
    pe_agi = float(baseline.calculate("adjusted_gross_income", year).sum())

    pe_rate = pe_revenue / pe_agi if pe_agi > 0 else 0

    irs_returns = STATE_TAX_RETURNS_K.get(state.upper())
    if census_rev and irs_returns:
        implied_agi = irs_returns * 1000 * 75000
        implied_rate = census_rev / implied_agi if implied_agi > 0 else 0
    else:
        implied_rate = None

    diff = (pe_rate - implied_rate) / implied_rate if implied_rate else None
    return Finding(
        variable="effective_tax_rate",
        pe_value=pe_rate, benchmark_value=implied_rate,
        benchmark_source="Census revenue / (IRS returns × avg AGI)",
        pct_diff=diff,
        finding_text=f"PE effective rate: {pe_rate:.2%} vs implied: {implied_rate:.2%}" if implied_rate else f"PE effective rate: {pe_rate:.2%}",
        relevant_to=["rate_change", "bracket_change"],
    )


# =============================================================================
# DIAGNOSTIC REGISTRY
# =============================================================================

DIAGNOSTIC_REGISTRY = {
    "state_income_tax_total": {
        "check": check_total_revenue,
        "relevant_to": {"rate_change", "bracket_change", "deduction_change", "exemption_change", "general"},
        "priority": 1,  # Always run first
    },
    "household_count": {
        "check": check_household_count,
        "relevant_to": {"rate_change", "eitc_change", "ctc_change", "deduction_change", "general"},
        "priority": 2,
    },
    "adjusted_gross_income": {
        "check": check_total_agi,
        "relevant_to": {"rate_change", "bracket_change", "deduction_change", "general"},
        "priority": 3,
    },
    "effective_tax_rate": {
        "check": check_effective_tax_rate,
        "relevant_to": {"rate_change", "bracket_change"},
        "priority": 4,
    },
    "top_decile_income_share": {
        "check": check_top_decile_income,
        "relevant_to": {"rate_change", "top_bracket_change", "bracket_change"},
        "priority": 5,
    },
    "bottom_decile_avg_income": {
        "check": check_bottom_decile_income,
        "relevant_to": {"eitc_change", "ctc_change", "bottom_bracket_change"},
        "priority": 5,
    },
    "median_household_income": {
        "check": check_median_income,
        "relevant_to": {"deduction_change", "bracket_change", "general"},
        "priority": 6,
    },
    "earned_income_share": {
        "check": check_earned_income,
        "relevant_to": {"eitc_change", "rate_change"},
        "priority": 6,
    },
    "child_population_share": {
        "check": check_child_households,
        "relevant_to": {"ctc_change"},
        "priority": 6,
    },
}

# Attribution weights: how much each variable matters for each reform type
ATTRIBUTION_WEIGHTS = {
    "rate_change": {
        "state_income_tax_total": 0.25,
        "adjusted_gross_income": 0.25,
        "effective_tax_rate": 0.20,
        "household_count": 0.15,
        "top_decile_income_share": 0.10,
        "median_household_income": 0.05,
    },
    "top_bracket_change": {
        "top_decile_income_share": 0.35,
        "adjusted_gross_income": 0.25,
        "state_income_tax_total": 0.15,
        "effective_tax_rate": 0.15,
        "household_count": 0.10,
    },
    "eitc_change": {
        "earned_income_share": 0.30,
        "bottom_decile_avg_income": 0.25,
        "household_count": 0.20,
        "state_income_tax_total": 0.15,
        "child_population_share": 0.10,
    },
    "ctc_change": {
        "child_population_share": 0.30,
        "bottom_decile_avg_income": 0.25,
        "household_count": 0.20,
        "median_household_income": 0.15,
        "state_income_tax_total": 0.10,
    },
    "deduction_change": {
        "adjusted_gross_income": 0.30,
        "median_household_income": 0.25,
        "household_count": 0.20,
        "state_income_tax_total": 0.15,
        "effective_tax_rate": 0.10,
    },
    "general": {
        "state_income_tax_total": 0.30,
        "adjusted_gross_income": 0.25,
        "household_count": 0.20,
        "median_household_income": 0.15,
        "effective_tax_rate": 0.10,
    },
}


# =============================================================================
# DATA FINDINGS CACHE (Supabase)
# =============================================================================

def _get_supabase():
    try:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if url and key:
            return create_client(url, key)
    except ImportError:
        pass
    return None


def _get_pe_us_version():
    try:
        from importlib.metadata import version
        return version("policyengine-us")
    except Exception:
        return "unknown"


def get_cached_findings(state, variables, year):
    """Check data_findings table for existing results."""
    sb = _get_supabase()
    if not sb:
        return {}

    pe_version = _get_pe_us_version()
    try:
        result = sb.table("data_findings").select("*").match({
            "state": state.upper(),
            "year": year,
            "pe_us_version": pe_version,
            "still_valid": True,
        }).in_("variable", variables).execute()

        cached = {}
        for row in (result.data or []):
            age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(
                row["last_verified"].replace("Z", "+00:00")
            )).days
            if age_days <= MAX_FINDING_AGE_DAYS:
                cached[row["variable"]] = row
        return cached
    except Exception:
        return {}


def store_finding(state, finding, reform_id, year):
    """Store a new finding in data_findings."""
    sb = _get_supabase()
    if not sb:
        return

    pe_version = _get_pe_us_version()
    try:
        sb.table("data_findings").upsert({
            "state": state.upper(),
            "variable": finding.variable,
            "year": year,
            "pe_value": finding.pe_value,
            "benchmark_value": finding.benchmark_value,
            "benchmark_source": finding.benchmark_source,
            "pct_diff": finding.pct_diff,
            "finding": finding.finding_text,
            "relevant_to": finding.relevant_to,
            "discovered_by": reform_id,
            "pe_us_version": pe_version,
            "dataset_version": _get_dataset_version(),
            "confirmed_by": [reform_id] if reform_id else [],
            "times_confirmed": 1,
            "last_verified": datetime.now(timezone.utc).isoformat(),
            "still_valid": True,
        }).execute()
    except Exception:
        pass  # Table may not exist yet


def confirm_finding(finding_id, reform_id):
    """Re-confirm an existing finding from a new reform."""
    sb = _get_supabase()
    if not sb:
        return
    try:
        sb.rpc("confirm_data_finding", {
            "p_finding_id": finding_id,
            "p_confirming_reform": reform_id,
        }).execute()
    except Exception:
        pass


def _get_dataset_version():
    try:
        from importlib.metadata import version
        return version("policyengine-us-data")
    except Exception:
        return "unknown"


# =============================================================================
# DIAGNOSTIC ENGINE
# =============================================================================

def select_diagnostics(reform_types):
    """Select checks relevant to this reform, sorted by priority."""
    selected = []
    for var_name, config in DIAGNOSTIC_REGISTRY.items():
        if reform_types & config["relevant_to"]:
            selected.append((var_name, config))
    selected.sort(key=lambda x: x[1]["priority"])
    return selected


def run_diagnostic(state, year, reform_params=None, provisions=None, reform_id=None):
    """Run reform-specific, cache-aware diagnostic.

    Returns list of Findings with attribution.
    """
    state_upper = state.upper()
    if state_upper in NO_INCOME_TAX_STATES:
        print(f"  {state_upper} has no income tax — skipping diagnostic")
        return []

    # Detect reform type
    reform_types = detect_reform_type(reform_params or {}, provisions)
    print(f"  Reform types detected: {reform_types}")

    # Select relevant checks
    diagnostics = select_diagnostics(reform_types)
    variables_needed = [v for v, _ in diagnostics]
    print(f"  Checks to run: {[v for v, _ in diagnostics]}")

    # Check cache
    cached = get_cached_findings(state, variables_needed, year)
    if cached:
        print(f"  Cache hits: {list(cached.keys())}")

    # Load simulation only if we have checks to run
    uncached = [(v, c) for v, c in diagnostics if v not in cached]
    baseline = None
    if uncached:
        from compute_impacts import get_state_dataset
        from policyengine_us import Microsimulation

        print(f"  Loading {state_upper} dataset + baseline simulation...")
        dataset_path = get_state_dataset(state)
        baseline = Microsimulation(dataset=dataset_path)

    # Run checks
    findings = []
    for var_name, config in diagnostics:
        if var_name in cached:
            row = cached[var_name]
            f = Finding(
                variable=var_name,
                pe_value=row["pe_value"],
                benchmark_value=row["benchmark_value"],
                benchmark_source=row["benchmark_source"],
                pct_diff=row["pct_diff"],
                finding_text=row["finding"],
                relevant_to=row.get("relevant_to", []),
                cached=True,
            )
            findings.append(f)
            if reform_id:
                confirm_finding(row["id"], reform_id)
            print(f"  [{var_name}] CACHED: {row['finding'][:60]}")
        else:
            print(f"  [{var_name}] Running fresh check...")
            f = config["check"](baseline, state, year)
            if f:
                findings.append(f)
                if reform_id:
                    store_finding(state, f, reform_id, year)
                status = "!!" if abs(f.pct_diff or 0) > 0.15 else "OK"
                print(f"  [{var_name}] {status}: {f.finding_text[:60]}")

    return findings


def build_attribution(findings, reform_types):
    """Compute weighted attribution of the gap by finding."""
    # Pick the most specific reform type for weights
    weight_key = "general"
    for rt in ["top_bracket_change", "eitc_change", "ctc_change", "deduction_change", "rate_change"]:
        if rt in reform_types:
            weight_key = rt
            break

    weights = ATTRIBUTION_WEIGHTS.get(weight_key, ATTRIBUTION_WEIGHTS["general"])
    attribution = []

    for f in findings:
        w = weights.get(f.variable, 0.05)
        contrib = (f.pct_diff or 0) * w
        attribution.append({
            "variable": f.variable,
            "pct_diff": f.pct_diff,
            "weight": w,
            "weighted_contribution": round(contrib, 4),
            "finding": f.finding_text,
            "cached": f.cached,
        })

    attribution.sort(key=lambda x: abs(x["weighted_contribution"]), reverse=True)
    return attribution


# =============================================================================
# REPORT
# =============================================================================

def print_diagnostic_report(findings, attribution, reform_types, state, year):
    """Print human-readable diagnostic."""
    print(f"\n{'=' * 70}")
    print(f"Data Diagnostic: {state.upper()} ({year})")
    print(f"Reform types: {reform_types}")
    print(f"{'=' * 70}")

    for a in attribution:
        cached_tag = " [cached]" if a["cached"] else ""
        sign = "+" if (a["pct_diff"] or 0) > 0 else ""
        print(f"\n  {a['variable']}")
        print(f"    Diff: {sign}{(a['pct_diff'] or 0):.1%}  Weight: {a['weight']:.0%}  Contribution: {a['weighted_contribution']:+.2%}{cached_tag}")
        print(f"    {a['finding'][:80]}")

    total_contrib = sum(a["weighted_contribution"] for a in attribution)
    print(f"\n{'-' * 70}")
    print(f"  Weighted data quality score: {total_contrib:+.1%}")
    direction = "higher" if total_contrib > 0 else "lower"
    print(f"  → PE reform estimates likely ~{abs(total_contrib)*100:.0f}% {direction} than fiscal notes for this reform type")


# =============================================================================
# ENTRY POINTS
# =============================================================================

def diagnose_reform(reform_id, year=None):
    """Full diagnostic for a specific reform. Saves results."""
    state = reform_id.split("-")[0]

    # Load reform data
    sb = _get_supabase()
    reform_params = {}
    provisions = []
    if sb:
        ri = sb.table("reform_impacts").select("reform_params, provisions").eq("id", reform_id).execute()
        if ri.data:
            reform_params = ri.data[0].get("reform_params", {})
            provs = ri.data[0].get("provisions", [])
            if isinstance(provs, str):
                try:
                    provisions = json.loads(provs)
                except json.JSONDecodeError:
                    provisions = []
            else:
                provisions = provs or []

    if year is None:
        state_file = RESULTS_DIR / reform_id / "calibration_state.json"
        if state_file.exists():
            with open(state_file) as f:
                year = json.load(f).get("year", 2026)
        else:
            year = 2026

    reform_types = detect_reform_type(reform_params, provisions)
    findings = run_diagnostic(state, year, reform_params, provisions, reform_id)
    attribution = build_attribution(findings, reform_types)

    # Save locally
    results_dir = RESULTS_DIR / reform_id
    results_dir.mkdir(parents=True, exist_ok=True)
    report_data = {
        "state": state.upper(),
        "year": year,
        "reform_types": list(reform_types),
        "findings": [f.to_dict() for f in findings],
        "attribution": attribution,
        "data_quality_score": sum(a["weighted_contribution"] for a in attribution),
        "diagnosed_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(results_dir / "data_diagnostic.json", "w") as f:
        json.dump(report_data, f, indent=2)

    # Write to DB model_notes
    if sb:
        try:
            existing = sb.table("reform_impacts").select("model_notes").eq("id", reform_id).execute()
            mn = {}
            if existing.data:
                raw = existing.data[0].get("model_notes")
                mn = raw if isinstance(raw, dict) else json.loads(raw) if isinstance(raw, str) else {}

            mn["data_diagnostic"] = {
                "reform_types": list(reform_types),
                "data_quality_score": round(report_data["data_quality_score"], 3),
                "findings_count": len(findings),
                "cached_count": sum(1 for f in findings if f.cached),
                "top_factors": [
                    {"variable": a["variable"], "diff_pct": round((a["pct_diff"] or 0) * 100, 1), "weight": a["weight"]}
                    for a in attribution[:3]
                ],
                "diagnosed_at": report_data["diagnosed_at"],
            }
            sb.table("reform_impacts").update({"model_notes": mn}).eq("id", reform_id).execute()
            print(f"\n  Diagnostic written to model_notes")
        except Exception as e:
            print(f"\n  Note: DB write skipped ({e})")

    print_diagnostic_report(findings, attribution, reform_types, state, year)
    return findings, attribution


def diagnose_state(state, year=2026):
    """Run diagnostic for a state without a specific reform."""
    findings = run_diagnostic(state, year)
    reform_types = {"general"}
    attribution = build_attribution(findings, reform_types)
    print_diagnostic_report(findings, attribution, reform_types, state, year)
    return findings, attribution


def _fmt(v):
    if abs(v) >= 1e9:
        return f"${v/1e9:.2f}B"
    if abs(v) >= 1e6:
        return f"${v/1e6:.1f}M"
    return f"${v:,.0f}"


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Reform-specific data diagnostic")
    parser.add_argument("--state", type=str, help="State code (e.g., GA)")
    parser.add_argument("--reform-id", type=str, help="Reform ID")
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--json", action="store_true")

    args = parser.parse_args()

    if args.reform_id:
        findings, attribution = diagnose_reform(args.reform_id, args.year)
    elif args.state:
        findings, attribution = diagnose_state(args.state, args.year)
    else:
        print("Error: provide --state or --reform-id")
        return 1

    if args.json:
        print(json.dumps({
            "findings": [f.to_dict() for f in findings],
            "attribution": attribution,
        }, indent=2))

    return 0


if __name__ == "__main__":
    exit(main())
