#!/usr/bin/env python3
"""
Cross-bill residual analysis (outer loop).

Analyzes calibration results across all bills to detect:
- State-level systematic biases
- Harness strategy accuracy (when fiscal notes exist alongside other strategies)
- Common failure patterns
- Data-level vs parameter-level residual sources

This is the "review overnight results" step in the autoresearch pattern.

Usage:
    # Analyze all calibrated bills
    python scripts/analyze_residuals.py

    # Filter by state
    python scripts/analyze_residuals.py --state GA

    # Output as JSON for downstream use
    python scripts/analyze_residuals.py --json

    # Update harness correction factors
    python scripts/analyze_residuals.py --update-corrections
"""

import argparse
import csv
import json
import os
from collections import defaultdict
from pathlib import Path
from statistics import mean, median, stdev

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

RESULTS_DIR = _script_dir.parent / "results"


# =============================================================================
# DATA LOADING
# =============================================================================

def load_all_calibrations() -> list[dict]:
    """Load calibration results for all reforms that have been calibrated."""
    if not RESULTS_DIR.exists():
        return []

    all_results = []

    for reform_dir in sorted(RESULTS_DIR.iterdir()):
        if not reform_dir.is_dir():
            continue

        reform_id = reform_dir.name
        state_path = reform_dir / "calibration_state.json"
        log_path = reform_dir / "calibration.tsv"
        harness_path = reform_dir / "harness_output.json"
        diagnosis_path = reform_dir / "diagnosis.json"

        if not log_path.exists():
            continue

        # Load calibration log
        history = []
        with open(log_path) as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                try:
                    history.append({
                        "attempt": int(row["attempt"]),
                        "pe_estimate": float(row["pe_estimate"]),
                        "target": float(row["target"]),
                        "pct_diff": float(row["pct_diff"].rstrip("%")) / 100,
                        "status": row["status"],
                        "description": row.get("description", ""),
                    })
                except (ValueError, KeyError):
                    continue

        if not history:
            continue

        # Extract state from reform_id
        state = reform_id.split("-")[0].upper()

        # Load harness output
        harness = {}
        if harness_path.exists():
            with open(harness_path) as f:
                harness = json.load(f)

        # Load diagnosis
        diagnosis = {}
        if diagnosis_path.exists():
            with open(diagnosis_path) as f:
                diagnosis = json.load(f)

        # Compute summary stats
        kept = [h for h in history if h["status"] in ("keep", "accept")]
        discarded = [h for h in history if h["status"] == "discard"]
        crashed = [h for h in history if h["status"] == "crash"]

        final = kept[-1] if kept else history[-1]
        initial = history[0] if history else None

        all_results.append({
            "reform_id": reform_id,
            "state": state,
            "target": final["target"],
            "initial_pe": initial["pe_estimate"] if initial else 0,
            "initial_diff": initial["pct_diff"] if initial else 0,
            "final_pe": final["pe_estimate"],
            "final_diff": final["pct_diff"],
            "final_status": final["status"],
            "total_attempts": len(history),
            "kept": len(kept),
            "discarded": len(discarded),
            "crashed": len(crashed),
            "improvement": (initial["pct_diff"] - final["pct_diff"]) if initial else 0,
            "harness_confidence": harness.get("confidence", "unknown"),
            "harness_strategies": [s["name"] for s in harness.get("strategies", [])],
            "diagnosis_category": diagnosis.get("category", ""),
            "diagnosis_explanation": diagnosis.get("explanation", ""),
        })

    return all_results


# =============================================================================
# STATE-LEVEL BIAS ANALYSIS
# =============================================================================

def analyze_state_biases(results: list[dict]) -> dict:
    """Detect systematic state-level biases.

    Returns:
        {
            "GA": {"count": 8, "avg_residual": 0.032, "direction": "mixed", "pattern": "no systematic bias"},
            "MD": {"count": 6, "avg_residual": -0.152, "direction": "PE low", "pattern": "consistent"},
        }
    """
    by_state = defaultdict(list)
    for r in results:
        if r["final_diff"] > 0:
            # Determine direction: is PE above or below target?
            sign = 1 if r["final_pe"] > r["target"] else -1
            by_state[r["state"]].append(sign * r["final_diff"])

    state_analysis = {}
    for state, diffs in sorted(by_state.items()):
        count = len(diffs)
        avg = mean(diffs)
        if count >= 2:
            sd = stdev(diffs)
        else:
            sd = 0

        # Determine direction
        positive = sum(1 for d in diffs if d > 0)
        negative = sum(1 for d in diffs if d < 0)

        if positive > count * 0.7:
            direction = "PE high"
        elif negative > count * 0.7:
            direction = "PE low"
        else:
            direction = "mixed"

        # Determine pattern
        if count >= 3 and abs(avg) > 0.10 and direction != "mixed":
            pattern = "consistent systematic bias"
        elif count >= 3 and abs(avg) < 0.05:
            pattern = "no systematic bias"
        else:
            pattern = "insufficient data or mixed"

        state_analysis[state] = {
            "count": count,
            "avg_residual": round(avg, 4),
            "avg_residual_pct": f"{avg:+.1%}",
            "direction": direction,
            "pattern": pattern,
            "stdev": round(sd, 4) if count >= 2 else None,
        }

    return state_analysis


# =============================================================================
# HARNESS STRATEGY ACCURACY
# =============================================================================

def analyze_strategy_accuracy(results: list[dict]) -> dict:
    """When fiscal notes exist alongside other strategies, compare accuracy.

    This calibrates the harness itself — are revenue-base estimates consistently
    off by a certain factor?
    """
    # Load harness outputs for reforms that have fiscal notes + other strategies
    strategy_errors = defaultdict(list)

    for r in results:
        harness_path = RESULTS_DIR / r["reform_id"] / "harness_output.json"
        if not harness_path.exists():
            continue

        with open(harness_path) as f:
            harness = json.load(f)

        strategies = harness.get("strategies", [])
        fiscal = next((s for s in strategies if s["name"] == "fiscal_note"), None)
        if not fiscal:
            continue

        fiscal_est = fiscal["estimate"]
        for s in strategies:
            if s["name"] == "fiscal_note":
                continue
            if fiscal_est != 0:
                error = (s["estimate"] - fiscal_est) / abs(fiscal_est)
                strategy_errors[s["name"]].append(error)

    analysis = {}
    for strategy_name, errors in strategy_errors.items():
        if not errors:
            continue
        analysis[strategy_name] = {
            "count": len(errors),
            "avg_error": round(mean(errors), 4),
            "avg_error_pct": f"{mean(errors):+.1%}",
            "median_error": round(median(errors), 4),
            "correction_factor": round(1 / (1 + mean(errors)), 4) if abs(mean(errors)) < 0.9 else None,
        }

    return analysis


# =============================================================================
# COMMON FAILURE PATTERNS
# =============================================================================

def analyze_failure_patterns(results: list[dict]) -> dict:
    """Identify common reasons calibrations fail or plateau."""
    categories = defaultdict(int)
    for r in results:
        cat = r.get("diagnosis_category", "")
        if cat:
            categories[cat] += 1
        elif r["final_status"] == "accept":
            categories["converged"] += 1
        elif r["final_diff"] <= 0.25:
            categories["acceptable_without_diagnosis"] += 1
        else:
            categories["unknown"] += 1

    # Improvement statistics
    improvements = [r["improvement"] for r in results if r["improvement"] > 0]

    return {
        "outcome_distribution": dict(categories),
        "total_reforms": len(results),
        "converged_count": categories.get("converged", 0),
        "avg_improvement": round(mean(improvements), 4) if improvements else 0,
        "median_improvement": round(median(improvements), 4) if improvements else 0,
    }


# =============================================================================
# OUTPUT
# =============================================================================

def print_report(results: list[dict], state_filter: str = None):
    """Print human-readable analysis report."""
    if state_filter:
        results = [r for r in results if r["state"] == state_filter.upper()]

    if not results:
        print("No calibration results found.")
        return

    # Overview
    print("=" * 80)
    print("CROSS-BILL RESIDUAL ANALYSIS")
    print("=" * 80)
    print(f"\nTotal calibrated reforms: {len(results)}")
    converged = sum(1 for r in results if r["final_status"] == "accept")
    print(f"Converged (within tolerance): {converged} ({converged/len(results):.0%})")

    # Per-reform table
    print(f"\n{'Reform':<20} {'State':<6} {'Initial':<10} {'Final':<10} {'Improve':<10} {'Status':<10} {'Diagnosis'}")
    print("-" * 80)
    for r in sorted(results, key=lambda x: x["state"]):
        print(
            f"{r['reform_id']:<20} "
            f"{r['state']:<6} "
            f"{r['initial_diff']:.1%}{'':>4} "
            f"{r['final_diff']:.1%}{'':>4} "
            f"{r['improvement']:+.1%}{'':>3} "
            f"{r['final_status']:<10} "
            f"{r['diagnosis_category'][:20]}"
        )

    # State biases
    state_biases = analyze_state_biases(results)
    if state_biases:
        print(f"\n{'=' * 80}")
        print("STATE-LEVEL BIAS ANALYSIS")
        print(f"{'=' * 80}")
        print(f"\n{'State':<6} {'Bills':<7} {'Avg Residual':<14} {'Direction':<10} {'Pattern'}")
        print("-" * 60)
        for state, data in sorted(state_biases.items()):
            print(
                f"{state:<6} "
                f"{data['count']:<7} "
                f"{data['avg_residual_pct']:<14} "
                f"{data['direction']:<10} "
                f"{data['pattern']}"
            )

    # Strategy accuracy
    strategy_accuracy = analyze_strategy_accuracy(results)
    if strategy_accuracy:
        print(f"\n{'=' * 80}")
        print("HARNESS STRATEGY ACCURACY (vs fiscal notes)")
        print(f"{'=' * 80}")
        print(f"\n{'Strategy':<20} {'Count':<7} {'Avg Error':<12} {'Correction Factor'}")
        print("-" * 60)
        for name, data in sorted(strategy_accuracy.items()):
            cf = f"{data['correction_factor']:.3f}" if data['correction_factor'] else "N/A"
            print(
                f"{name:<20} "
                f"{data['count']:<7} "
                f"{data['avg_error_pct']:<12} "
                f"{cf}"
            )

    # Failure patterns
    patterns = analyze_failure_patterns(results)
    print(f"\n{'=' * 80}")
    print("OUTCOME DISTRIBUTION")
    print(f"{'=' * 80}")
    for category, count in sorted(patterns["outcome_distribution"].items(), key=lambda x: -x[1]):
        pct = count / patterns["total_reforms"]
        bar = "#" * int(pct * 40)
        print(f"  {category:<35} {count:>3} ({pct:.0%}) {bar}")

    if patterns["avg_improvement"] > 0:
        print(f"\n  Avg improvement from calibration: {patterns['avg_improvement']:.1%}")
        print(f"  Median improvement: {patterns['median_improvement']:.1%}")


def save_corrections(results: list[dict]):
    """Save harness correction factors for future use."""
    strategy_accuracy = analyze_strategy_accuracy(results)
    state_biases = analyze_state_biases(results)

    corrections = {
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "reform_count": len(results),
        "strategy_corrections": {},
        "state_bias_corrections": {},
    }

    for name, data in strategy_accuracy.items():
        if data["correction_factor"] and data["count"] >= 3:
            corrections["strategy_corrections"][name] = {
                "factor": data["correction_factor"],
                "based_on": data["count"],
                "avg_error": data["avg_error"],
            }

    for state, data in state_biases.items():
        if data["count"] >= 3 and data["pattern"] == "consistent systematic bias":
            corrections["state_bias_corrections"][state] = {
                "avg_residual": data["avg_residual"],
                "direction": data["direction"],
                "based_on": data["count"],
            }

    corrections_path = RESULTS_DIR / "harness_corrections.json"
    with open(corrections_path, "w") as f:
        json.dump(corrections, f, indent=2)

    print(f"\nCorrections saved to: {corrections_path}")
    if corrections["strategy_corrections"]:
        print("Strategy corrections:")
        for name, c in corrections["strategy_corrections"].items():
            print(f"  {name}: multiply by {c['factor']:.3f} (based on {c['based_on']} bills)")
    if corrections["state_bias_corrections"]:
        print("State bias corrections:")
        for state, c in corrections["state_bias_corrections"].items():
            print(f"  {state}: expected {c['avg_residual']:+.1%} {c['direction']} (based on {c['based_on']} bills)")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Cross-bill residual analysis (outer loop)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--state", type=str, help="Filter by state (e.g., GA)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--update-corrections", action="store_true", help="Update harness correction factors")

    args = parser.parse_args()

    results = load_all_calibrations()

    if args.json:
        output = {
            "reforms": results,
            "state_biases": analyze_state_biases(results),
            "strategy_accuracy": analyze_strategy_accuracy(results),
            "failure_patterns": analyze_failure_patterns(results),
        }
        print(json.dumps(output, indent=2))
        return 0

    print_report(results, args.state)

    if args.update_corrections:
        save_corrections(results)

    return 0


if __name__ == "__main__":
    exit(main())
