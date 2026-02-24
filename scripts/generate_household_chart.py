#!/usr/bin/env python3
"""
Generate a household earnings sweep chart for a bill reform.

Shows net benefit at each earnings level for a representative household,
making reform impacts concrete and verifiable for PR reviewers.

Usage:
    python scripts/generate_household_chart.py --reform-id ct-hb5134
    python scripts/generate_household_chart.py --reform-id ct-hb5134 --upload-to-pr 119
    python scripts/generate_household_chart.py --reform-id va-hb979 --earnings-max 2000000
    python scripts/generate_household_chart.py --reform-id ga-sb168 --output charts/ga-sb168.png
"""

import argparse
import copy
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

# Load environment variables from .env.local
from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

# Reuse helpers from compute_impacts
from compute_impacts import (
    create_reform_class,
    get_effective_year_from_params,
    get_supabase_client,
    load_reforms_from_db,
)

# Number of data points across the earnings sweep
NUM_POINTS = 200


# =============================================================================
# HOUSEHOLD ARCHETYPE SELECTION
# =============================================================================

def _extract_thresholds(reform_params: dict) -> list[float]:
    """Extract notable income thresholds from reform parameter values."""
    thresholds = []
    for param_path, values in reform_params.items():
        for period_str, value in values.items():
            if isinstance(value, (int, float)) and value > 1000:
                # Looks like an income threshold
                if any(
                    kw in param_path.lower()
                    for kw in [
                        "threshold",
                        "phase_out",
                        "phaseout",
                        "income_limit",
                        "amount",
                    ]
                ):
                    thresholds.append(float(value))
    return sorted(set(thresholds))


def classify_reform(reform_params: dict, provisions: list | None = None) -> dict:
    """Select the best household archetype based on reform type.

    Returns a config dict with:
        archetype: str description
        adults: list of ages
        children: list of ages
        is_married: bool
        earnings_max: float
        thresholds: list of income values to mark on chart
    """
    param_keys = " ".join(reform_params.keys()).lower()
    thresholds = _extract_thresholds(reform_params)

    # Check provision labels too
    prov_text = ""
    if provisions:
        prov_text = " ".join(
            p.get("label", "") + " " + p.get("explanation", "")
            for p in provisions
        ).lower()

    combined = param_keys + " " + prov_text

    # EITC reforms
    if "eitc" in combined or "earned_income" in combined:
        return {
            "archetype": "Single parent, 2 children (ages 5, 12)",
            "adults": [35],
            "children": [5, 12],
            "is_married": False,
            "earnings_max": 80_000,
            "thresholds": thresholds,
        }

    # CTC / child tax credit reforms
    if "ctc" in combined or "refundable_ctc" in combined or "child_tax_credit" in combined:
        return {
            "archetype": "Single parent, 2 children (ages 6, 14)",
            "adults": [35],
            "children": [6, 14],
            "is_married": False,
            "earnings_max": 250_000,
            "thresholds": thresholds,
        }

    # Marriage/joint-related reforms
    if "joint" in combined or "married" in combined or "filing_status" in combined:
        return {
            "archetype": "Married couple, no children",
            "adults": [40, 38],
            "children": [],
            "is_married": True,
            "earnings_max": 400_000,
            "thresholds": thresholds,
        }

    # High-threshold bracket reforms
    max_threshold = max(thresholds) if thresholds else 0
    if max_threshold > 500_000:
        return {
            "archetype": "Single filer, no children",
            "adults": [40],
            "children": [],
            "is_married": False,
            "earnings_max": max_threshold * 3,
            "thresholds": thresholds,
        }

    # General income tax rate / bracket reforms
    if "tax.income" in combined and ("rate" in combined or "bracket" in combined):
        return {
            "archetype": "Single filer, no children",
            "adults": [40],
            "children": [],
            "is_married": False,
            "earnings_max": 500_000,
            "thresholds": thresholds,
        }

    # Standard deduction reforms
    if "standard" in combined and "deduction" in combined:
        return {
            "archetype": "Single filer, no children",
            "adults": [40],
            "children": [],
            "is_married": False,
            "earnings_max": 200_000,
            "thresholds": thresholds,
        }

    # Fallback
    return {
        "archetype": "Single filer, no children",
        "adults": [40],
        "children": [],
        "is_married": False,
        "earnings_max": 300_000,
        "thresholds": thresholds,
    }


# =============================================================================
# SITUATION BUILDING
# =============================================================================

def build_situation(config: dict, state: str, year: int) -> dict:
    """Build a PE Simulation situation dict with an earnings axis.

    Creates the household with all required entity groups and uses the
    PE `axes` parameter to sweep employment_income from $0 to earnings_max.
    """
    state_upper = state.upper()
    earnings_max = config["earnings_max"]
    num_people = len(config["adults"]) + len(config["children"])

    # Members — all get age set, employment_income defaults to 0
    members = {}
    member_names = []

    for i, age in enumerate(config["adults"]):
        name = f"adult_{i + 1}" if len(config["adults"]) > 1 else "adult"
        members[name] = {"age": {year: age}}
        member_names.append(name)

    for i, age in enumerate(config["children"]):
        name = f"child_{i + 1}"
        members[name] = {"age": {year: age}}
        member_names.append(name)

    head = member_names[0]
    spouse = member_names[1] if config["is_married"] and len(config["adults"]) > 1 else None
    dependents = [n for n in member_names if n != head and n != spouse]

    tax_unit_members = [head]
    if spouse:
        tax_unit_members.append(spouse)
    tax_unit_members.extend(dependents)

    # Marital units
    marital_units = {}
    if spouse:
        marital_units[f"{head}_{spouse}_mu"] = {"members": [head, spouse]}
    else:
        marital_units[f"{head}_mu"] = {"members": [head]}
    for dep in dependents:
        marital_units[f"{dep}_mu"] = {"members": [dep]}

    situation = {
        "people": members,
        "families": {"family": {"members": member_names}},
        "marital_units": marital_units,
        "tax_units": {"tax_unit": {"members": tax_unit_members}},
        "spm_units": {"spm_unit": {"members": member_names}},
        "households": {
            "household": {
                "members": member_names,
                "state_name": {year: state_upper},
            },
        },
        "axes": [[{
            "name": "employment_income",
            "min": 0,
            "max": earnings_max,
            "count": NUM_POINTS,
            "period": year,
        }]],
    }

    # Store num_people so run_simulations can extract earnings correctly
    config["_num_people"] = num_people

    return situation


# =============================================================================
# SIMULATION
# =============================================================================

def run_simulations(situation: dict, reform_params: dict, year: int, num_people: int):
    """Run baseline and reform Simulations, return (earnings, baseline_net, reform_net, benefit).

    Uses PE-US Simulation (not Microsimulation) with axes for the earnings sweep.
    The axes create NUM_POINTS copies of the household. Person-level arrays have
    NUM_POINTS * num_people entries; household-level arrays have NUM_POINTS entries.
    """
    from policyengine_us import Simulation

    # reform_params is already a deepcopy from the caller
    ReformClass = create_reform_class(reform_params)

    print("  Running baseline simulation...")
    baseline_sim = Simulation(situation=situation)
    baseline_net = np.array(baseline_sim.calculate("household_net_income", year))

    # Extract earnings from person-level array: axes vary the first person,
    # so every num_people-th entry starting at 0 is the adult's income.
    all_earnings = np.array(baseline_sim.calculate("employment_income", year))
    earnings = all_earnings[::num_people]  # pick the adult (first person) from each copy

    print("  Running reform simulation...")
    reform_sim = Simulation(situation=situation, reform=ReformClass)
    reform_net = np.array(reform_sim.calculate("household_net_income", year))

    benefit = reform_net - baseline_net

    return earnings, baseline_net, reform_net, benefit


# =============================================================================
# CHART GENERATION
# =============================================================================

def generate_chart(
    earnings: np.ndarray,
    benefit: np.ndarray,
    config: dict,
    metadata: dict,
    output_path: str,
) -> str:
    """Generate a plotly chart of net benefit by earnings.

    Saves both a PNG (for PR comments) and an interactive HTML.
    Returns the path to the saved PNG.
    """
    import plotly.graph_objects as go

    # PE brand teal
    teal = "#2C7A7B"

    state_upper = metadata.get("state", "").upper()
    bill_title = metadata.get("title", metadata.get("id", ""))
    subtitle = f"{config['archetype']} | Year {metadata.get('year', '')}"

    fig = go.Figure()

    # Positive benefit fill (green)
    benefit_pos = np.where(benefit >= 0, benefit, 0)
    fig.add_trace(go.Scatter(
        x=earnings, y=benefit_pos,
        fill="tozeroy",
        fillcolor="rgba(56, 161, 105, 0.2)",
        line=dict(width=0),
        showlegend=False,
        hoverinfo="skip",
    ))

    # Negative benefit fill (red)
    benefit_neg = np.where(benefit < 0, benefit, 0)
    if np.any(benefit < 0):
        fig.add_trace(go.Scatter(
            x=earnings, y=benefit_neg,
            fill="tozeroy",
            fillcolor="rgba(229, 62, 62, 0.2)",
            line=dict(width=0),
            showlegend=False,
            hoverinfo="skip",
        ))

    # Main benefit line
    fig.add_trace(go.Scatter(
        x=earnings, y=benefit,
        mode="lines",
        line=dict(color=teal, width=2.5),
        name="Net benefit",
        hovertemplate="Earnings: $%{x:,.0f}<br>Benefit: $%{y:,.0f}<extra></extra>",
    ))

    # Threshold lines
    for thresh in config.get("thresholds", []):
        if thresh <= earnings[-1]:
            fig.add_vline(
                x=thresh,
                line_dash="dash",
                line_color="gray",
                opacity=0.6,
                annotation_text=f"${thresh:,.0f}",
                annotation_position="top",
                annotation_font_size=10,
                annotation_font_color="gray",
            )

    # Zero line
    fig.add_hline(y=0, line_color="gray", line_width=0.8)

    fig.update_layout(
        title=dict(
            text=(
                f"<b>{state_upper} {bill_title} Impact by Earnings</b>"
                f"<br><span style='font-size:13px;color:gray'>{subtitle}</span>"
            ),
            x=0.5,
            xanchor="center",
        ),
        xaxis=dict(
            title="Employment Income",
            tickformat="$,.0f",
            gridcolor="rgba(0,0,0,0.06)",
        ),
        yaxis=dict(
            title="Net Benefit from Reform",
            tickformat="$,.0f",
            gridcolor="rgba(0,0,0,0.06)",
            zeroline=False,
        ),
        plot_bgcolor="white",
        font=dict(family="Inter, Arial, sans-serif"),
        margin=dict(t=80, b=60, l=70, r=30),
        width=900,
        height=500,
        annotations=[
            dict(
                text="<i>PolicyEngine</i>",
                xref="paper", yref="paper",
                x=1, y=-0.12,
                showarrow=False,
                font=dict(size=11, color="gray"),
            )
        ],
        showlegend=False,
    )

    # Ensure output directory exists
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    # Save PNG
    fig.write_image(str(output), scale=2)
    print(f"  Chart saved: {output}")

    # Save interactive HTML alongside
    html_path = output.with_suffix(".html")
    fig.write_html(str(html_path), include_plotlyjs="cdn")
    print(f"  Interactive chart: {html_path}")

    return str(output)


# =============================================================================
# SUMMARY STATS
# =============================================================================

def print_summary_stats(earnings: np.ndarray, benefit: np.ndarray) -> dict:
    """Print summary statistics and return them as a dict for PR comments."""
    if len(earnings) == 0 or len(benefit) == 0:
        print("\n  Summary: No data from simulation sweep")
        return {}

    max_benefit = float(np.max(benefit))
    min_benefit = float(np.min(benefit))
    max_idx = int(np.argmax(benefit))
    min_idx = int(np.argmin(benefit))

    summary = {
        "max_benefit": max_benefit,
        "max_earnings": float(earnings[max_idx]),
        "max_loss": min_benefit if min_benefit < 0 else 0,
        "loss_earnings": float(earnings[min_idx]) if min_benefit < 0 else 0,
    }

    print(f"\n  Summary:")
    print(f"    Max benefit:  ${max_benefit:,.0f} at ${earnings[max_idx]:,.0f} earnings")
    if min_benefit < 0:
        print(f"    Max loss:     ${min_benefit:,.0f} at ${earnings[min_idx]:,.0f} earnings")
    else:
        print(f"    Min benefit:  ${min_benefit:,.0f} at ${earnings[min_idx]:,.0f} earnings")

    nonzero = np.where(np.abs(benefit) > 0.50)[0]
    if len(nonzero) > 0:
        summary["range_start"] = float(earnings[nonzero[0]])
        summary["range_end"] = float(earnings[nonzero[-1]])
        print(f"    Benefit range: ${summary['range_start']:,.0f} – ${summary['range_end']:,.0f}")
    else:
        print("    No meaningful benefit detected")

    return summary


# =============================================================================
# PR UPLOAD
# =============================================================================

def upload_to_pr(chart_path: str, pr_number: int, metadata: dict, summary: dict | None = None):
    """Post a PR comment with summary stats and instructions to attach the chart.

    The user drags the local PNG into the comment to embed the image.
    """
    chart_path = Path(chart_path)
    if not chart_path.exists():
        print(f"  Error: chart file not found: {chart_path}")
        return

    state_upper = metadata.get("state", "").upper()
    reform_id = metadata.get("id", "")
    archetype = metadata.get("archetype", "")
    year = metadata.get("year", "")

    try:
        subprocess.run(["gh", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("  Error: gh CLI not available. Install GitHub CLI.")
        return

    repo = _get_repo_name()
    if not repo:
        print("  Could not detect GitHub repo.")
        return

    # Build comment with summary stats
    comment_body = (
        f"## Household Earnings Sweep: {state_upper} {reform_id}\n\n"
        f"**Household**: {archetype}\n"
        f"**Year**: {year}\n\n"
    )

    if summary:
        if summary.get("max_benefit", 0) > 0:
            comment_body += f"- Max benefit: **${summary['max_benefit']:,.0f}** at ${summary['max_earnings']:,.0f} earnings\n"
        if summary.get("max_loss", 0) < 0:
            comment_body += f"- Max loss: **${summary['max_loss']:,.0f}** at ${summary['loss_earnings']:,.0f} earnings\n"
        if summary.get("range_start") is not None:
            comment_body += f"- Affected earnings range: ${summary['range_start']:,.0f} – ${summary['range_end']:,.0f}\n"

    comment_body += (
        f"\n> Drag and drop `{chart_path.resolve()}` below to embed the chart.\n\n"
        f"*Generated by `generate_household_chart.py`*\n"
    )

    result = subprocess.run(
        ["gh", "pr", "comment", str(pr_number), "--repo", repo, "--body", comment_body],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0:
        print(f"  PR comment posted to #{pr_number}")
        print(f"  Drag {chart_path.resolve()} into the comment to embed the chart.")
    else:
        print(f"  Failed to post PR comment: {result.stderr}")


def _get_repo_name() -> str | None:
    """Get the GitHub repo name (owner/repo) from git remote."""
    try:
        result = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except FileNotFoundError:
        pass
    return None


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate household earnings sweep chart for a bill reform",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python scripts/generate_household_chart.py --reform-id ct-hb5134
    python scripts/generate_household_chart.py --reform-id ct-hb5134 --upload-to-pr 119
    python scripts/generate_household_chart.py --reform-id va-hb979 --earnings-max 2000000
        """,
    )
    parser.add_argument(
        "--reform-id",
        type=str,
        required=True,
        help="Reform ID (e.g., 'ct-hb5134')",
    )
    parser.add_argument(
        "--earnings-max",
        type=float,
        default=None,
        help="Override max earnings for sweep (default: auto-detected)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output PNG path (default: charts/<reform-id>.png)",
    )
    parser.add_argument(
        "--upload-to-pr",
        type=int,
        default=None,
        help="Post chart as a comment on this PR number",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=None,
        help="Simulation year (auto-detects from reform params if not specified)",
    )
    args = parser.parse_args()

    # Connect to Supabase
    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
        print("Run: source .env")
        return 1

    # Load reform data
    reforms = load_reforms_from_db(supabase, args.reform_id)
    if not reforms:
        print(f"Error: Reform '{args.reform_id}' not found or has no reform_params")
        return 1

    reform = reforms[0]
    reform_id = reform["id"]
    state = reform["state"]
    reform_params = reform["reform"]

    print("=" * 60)
    print(f"Household Earnings Sweep: {reform['label']}")
    print(f"ID: {reform_id} | State: {state.upper()}")
    print("=" * 60)

    # Fetch provisions separately (load_reforms_from_db doesn't include them)
    provisions = []
    try:
        prov_result = (
            supabase.table("reform_impacts")
            .select("provisions")
            .eq("id", reform_id)
            .execute()
        )
        if prov_result.data and prov_result.data[0].get("provisions"):
            provisions = prov_result.data[0]["provisions"]
            if isinstance(provisions, str):
                provisions = json.loads(provisions)
    except Exception as e:
        print(f"  Warning: Could not fetch provisions: {e}")

    # Determine year
    sim_year = args.year or get_effective_year_from_params(reform_params)
    print(f"  Year: {sim_year}")

    # Classify reform → pick household archetype
    config = classify_reform(reform_params, provisions)
    if args.earnings_max:
        config["earnings_max"] = args.earnings_max
    print(f"  Archetype: {config['archetype']}")
    print(f"  Earnings sweep: $0 – ${config['earnings_max']:,.0f}")
    if config["thresholds"]:
        print(f"  Thresholds: {', '.join(f'${t:,.0f}' for t in config['thresholds'])}")

    # Build situation
    situation = build_situation(config, state, sim_year)

    # Run simulations
    num_people = config.get("_num_people", len(config["adults"]) + len(config["children"]))
    earnings, baseline_vals, reform_vals, benefit = run_simulations(
        situation, copy.deepcopy(reform_params), sim_year, num_people
    )

    # Summary stats
    summary = print_summary_stats(earnings, benefit)

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        output_path = f"charts/{reform_id}.png"

    # Generate chart
    metadata = {
        "id": reform_id,
        "state": state,
        "title": reform["label"],
        "year": sim_year,
        "archetype": config["archetype"],
    }
    chart_path = generate_chart(earnings, benefit, config, metadata, output_path)

    # Upload to PR if requested
    if args.upload_to_pr:
        upload_to_pr(chart_path, args.upload_to_pr, metadata, summary)

    print("\n  Done!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
