#!/usr/bin/env python3
"""
Meta-Harness: Optimize the scoring harness itself.

Inspired by "Meta-Harness: End-to-End Optimization of Model Harnesses"
(Lee et al., 2026). Instead of optimizing reform_params against the harness,
this optimizes THE HARNESS CODE against accumulated calibration data.

The harness has tunable settings:
  - Attribution weights (how much each data variable matters per reform type)
  - Tolerance thresholds (acceptance bands per confidence level)
  - Strategy correction factors (bias adjustments for each estimation strategy)

The meta-loop:
  1. Load all past bills with known fiscal data (the "training set")
  2. Score current harness settings against this data
  3. Agent proposes changes to harness settings
  4. Re-evaluate — did aggregate prediction quality improve?
  5. Keep/discard

Usage:
    # Evaluate current harness settings
    python scripts/meta_harness.py --evaluate

    # Show per-bill breakdown
    python scripts/meta_harness.py --evaluate --verbose

    # Run meta-optimization (agent proposes + tests changes)
    python scripts/meta_harness.py --optimize --max-iterations 10

    # Test a specific settings file
    python scripts/meta_harness.py --evaluate --settings harness_settings.json
"""

import argparse
import json
import os
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

RESULTS_DIR = _script_dir.parent / "results"
META_DIR = RESULTS_DIR / "_meta_harness"


# =============================================================================
# HARNESS SETTINGS (the tunable artifact — like train.py in autoresearch)
# =============================================================================

DEFAULT_SETTINGS = {
    "tolerance_table": {
        "high": 0.15,
        "medium": 0.25,
        "low": 0.40,
        "very_low": 0.50,
    },
    "attribution_weights": {
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
    },
    "strategy_corrections": {},
}


def load_settings(path=None):
    """Load harness settings from file or return defaults."""
    if path and Path(path).exists():
        with open(path) as f:
            return json.load(f)
    settings_path = META_DIR / "current_settings.json"
    if settings_path.exists():
        with open(settings_path) as f:
            return json.load(f)
    return deepcopy(DEFAULT_SETTINGS)


def save_settings(settings, label="current"):
    """Save harness settings."""
    META_DIR.mkdir(parents=True, exist_ok=True)
    with open(META_DIR / f"{label}_settings.json", "w") as f:
        json.dump(settings, f, indent=2)


# =============================================================================
# TRAINING DATA: Bills with known fiscal estimates
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


def _extract_fiscal_estimate(key_findings):
    """Parse a fiscal revenue estimate from key_findings strings.

    STRICT: Only extracts from lines that look like actual fiscal/revenue
    estimates, not bill descriptions that happen to contain dollar amounts.
    A key_finding must contain a source indicator (fiscal note, estimate,
    revenue, back-of-envelope, ITEP, etc.) to be considered.
    """
    if not key_findings:
        return None

    # Source indicators — line must contain one of these to be a fiscal estimate
    SOURCE_INDICATORS = [
        "fiscal note", "fiscal impact", "revenue", "cost", "estimate",
        "back-of-envelope", "itep", "tax foundation", "budget", "policy institute",
        "policy center", "comptroller", "ola", "lfa", "dls", "opb", "hfa",
        "lbo", "lsa", "ols", "ofa", "analysis", "policyengine",
        "pe estimate", "annual", "/year",
    ]

    # Lines that are bill descriptions, not estimates — skip these
    SKIP_INDICATORS = [
        "bracket rate from", "bracket on $", "new %", "increases $",
        "standard deduction:", "effective tax year", "no official fiscal",
        "no fiscal note", "no ols", "no external", "no lbo", "warns of",
        "sponsor claims",  # unverified claims
    ]

    for kf in key_findings:
        kf_str = str(kf)
        kf_lower = kf_str.lower()

        # Skip non-estimate lines
        if any(skip in kf_lower for skip in SKIP_INDICATORS):
            continue

        # Must have a source indicator
        if not any(src in kf_lower for src in SOURCE_INDICATORS):
            continue

        # Now extract the dollar amount
        # Match patterns like: ~$778M, $2.7B, -$17.7M, $50-60M (take first)
        match = re.search(r'[-~]?\$?([\d,]+\.?\d*)\s*([BMbm])\b', kf_str)
        if not match:
            # Try "million" / "billion" spelled out
            match = re.search(r'[-~]?\$?([\d,]+\.?\d*)\s*(million|billion)', kf_str, re.IGNORECASE)

        if not match:
            continue

        num_str = match.group(1).replace(",", "")
        try:
            value = float(num_str)
        except ValueError:
            continue

        # Multiplier
        unit = match.group(2).upper()
        if unit in ("B", "BILLION"):
            value *= 1e9
        elif unit in ("M", "MILLION"):
            value *= 1e6

        # Sign: look for loss/cost/reduction language in the FULL line
        if any(word in kf_lower for word in ["loss", "reduc", "cost", "lower", "decrease", "cut", "negative"]):
            value = -abs(value)

        return value

    return None


def load_training_data():
    """Load all bills with both PE estimates and fiscal references."""
    sb = _get_supabase()
    if not sb:
        return []

    # Get all research with key_findings + reform_impacts
    res = sb.table("research").select(
        "id, state, title, type, key_findings, "
        "reform_impacts(budgetary_impact, reform_params, provisions, model_notes)"
    ).in_("type", ["bill"]).not_.is_("key_findings", "null").execute()

    training = []
    for r in res.data:
        ri = r.get("reform_impacts")
        if isinstance(ri, list):
            ri = ri[0] if ri else None
        if not ri:
            continue

        budgetary = ri.get("budgetary_impact")
        if not budgetary:
            continue

        pe_estimate = budgetary.get("stateRevenueImpact")
        if pe_estimate is None:
            continue

        fiscal_estimate = _extract_fiscal_estimate(r.get("key_findings"))
        if fiscal_estimate is None:
            continue

        # Detect reform type
        reform_params = ri.get("reform_params", {})
        from validate_baseline import detect_reform_type
        reform_types = detect_reform_type(reform_params, ri.get("provisions"))

        actual_diff = abs(pe_estimate - fiscal_estimate) / abs(fiscal_estimate) if fiscal_estimate != 0 else None

        training.append({
            "reform_id": r["id"],
            "state": r["state"].upper(),
            "title": r["title"],
            "pe_estimate": pe_estimate,
            "fiscal_estimate": fiscal_estimate,
            "actual_diff_pct": actual_diff,
            "reform_types": list(reform_types),
            "reform_params": reform_params,
            "provisions": ri.get("provisions", []),
            "model_notes": ri.get("model_notes", {}),
        })

    return training


# =============================================================================
# EVALUATION: Score harness settings against training data
# =============================================================================

def evaluate_settings(settings, training_data, verbose=False):
    """Score harness settings against all training bills.

    For each bill, compute what the harness WOULD have predicted:
    - Which tolerance band applies?
    - Would it have correctly classified within/outside tolerance?
    - How well do attribution weights predict the actual gap?

    Returns aggregate score and per-bill breakdown.
    """
    results = []
    for bill in training_data:
        actual_diff = bill["actual_diff_pct"]
        if actual_diff is None:
            continue

        # What reform type is this?
        reform_types = set(bill["reform_types"])

        # What tolerance would the harness assign?
        # (Assume high confidence if fiscal note exists — which it does in training data)
        tolerance = settings["tolerance_table"]["high"]

        # Would the harness correctly classify this?
        would_accept = actual_diff <= tolerance
        actually_close = actual_diff <= 0.15  # Ground truth: is PE "close enough"?

        correct_classification = would_accept == actually_close

        # Attribution weight quality: for this reform type, do the weights
        # predict which variables matter?
        weight_key = "general"
        for rt in ["top_bracket_change", "eitc_change", "ctc_change", "deduction_change", "rate_change"]:
            if rt in reform_types:
                weight_key = rt
                break

        weights = settings["attribution_weights"].get(weight_key, settings["attribution_weights"]["general"])

        results.append({
            "reform_id": bill["reform_id"],
            "state": bill["state"],
            "pe_estimate": bill["pe_estimate"],
            "fiscal_estimate": bill["fiscal_estimate"],
            "actual_diff_pct": round(actual_diff, 4),
            "tolerance": tolerance,
            "would_accept": would_accept,
            "correct_classification": correct_classification,
            "reform_type": weight_key,
            "weight_key": weight_key,
        })

    if not results:
        return {"score": 0, "bills": 0, "results": []}

    # Aggregate metrics
    n = len(results)
    classification_accuracy = sum(1 for r in results if r["correct_classification"]) / n
    avg_diff = np.mean([r["actual_diff_pct"] for r in results])
    median_diff = np.median([r["actual_diff_pct"] for r in results])

    # Tolerance calibration: what % of bills fall within tolerance?
    within_tolerance = sum(1 for r in results if r["would_accept"]) / n

    # Ideal: tolerance should accept ~70% of bills (not too tight, not too loose)
    tolerance_calibration = 1.0 - abs(within_tolerance - 0.70)

    # Combined score (higher is better)
    score = (
        classification_accuracy * 0.40 +
        tolerance_calibration * 0.30 +
        (1.0 - min(avg_diff, 1.0)) * 0.30
    )

    if verbose:
        print(f"\n{'Reform':<25} {'State':<5} {'PE':<12} {'Fiscal':<12} {'Diff':<8} {'Tol':<6} {'Accept':<8} {'Correct'}")
        print("-" * 90)
        for r in sorted(results, key=lambda x: x["actual_diff_pct"]):
            pe_str = f"${r['pe_estimate']/1e6:,.0f}M"
            fis_str = f"${r['fiscal_estimate']/1e6:,.0f}M"
            print(
                f"{r['reform_id']:<25} {r['state']:<5} {pe_str:<12} {fis_str:<12} "
                f"{r['actual_diff_pct']:.1%}{'':>2} {r['tolerance']:.0%}{'':>2} "
                f"{'Y' if r['would_accept'] else 'N':^8} "
                f"{'OK' if r['correct_classification'] else 'XX'}"
            )

    return {
        "score": round(score, 4),
        "bills": n,
        "classification_accuracy": round(classification_accuracy, 4),
        "avg_diff": round(avg_diff, 4),
        "median_diff": round(median_diff, 4),
        "within_tolerance_pct": round(within_tolerance, 4),
        "tolerance_calibration": round(tolerance_calibration, 4),
        "results": results,
    }


# =============================================================================
# META-OPTIMIZATION LOG
# =============================================================================

def init_meta_log():
    """Initialize the meta-harness optimization log."""
    META_DIR.mkdir(parents=True, exist_ok=True)
    log_path = META_DIR / "meta_log.jsonl"
    return log_path


def append_meta_log(iteration, settings_label, eval_result, change_description):
    """Append to the meta-harness log."""
    log_path = init_meta_log()
    entry = {
        "iteration": iteration,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "settings_label": settings_label,
        "score": eval_result["score"],
        "bills": eval_result["bills"],
        "classification_accuracy": eval_result["classification_accuracy"],
        "avg_diff": eval_result["avg_diff"],
        "within_tolerance_pct": eval_result["within_tolerance_pct"],
        "change_description": change_description,
    }
    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def load_meta_history():
    """Load meta-optimization history."""
    log_path = META_DIR / "meta_log.jsonl"
    if not log_path.exists():
        return []
    entries = []
    with open(log_path) as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


# =============================================================================
# META-OPTIMIZATION STEP
# =============================================================================

def run_meta_step(current_settings, proposed_settings, training_data, iteration, change_description):
    """Run one meta-optimization step.

    Evaluate proposed settings against training data.
    Keep if score improves, discard if not.
    """
    current_eval = evaluate_settings(current_settings, training_data)
    proposed_eval = evaluate_settings(proposed_settings, training_data)

    current_score = current_eval["score"]
    proposed_score = proposed_eval["score"]

    if proposed_score > current_score:
        decision = "keep"
        save_settings(proposed_settings, f"iteration_{iteration}")
        save_settings(proposed_settings, "current")
        result_settings = proposed_settings
    else:
        decision = "discard"
        result_settings = current_settings

    entry = append_meta_log(
        iteration=iteration,
        settings_label=f"iteration_{iteration}" if decision == "keep" else "discarded",
        eval_result=proposed_eval if decision == "keep" else current_eval,
        change_description=f"{decision}: {change_description}",
    )

    print(f"\n  Meta-step {iteration}: {change_description}")
    print(f"    Current score: {current_score:.4f}")
    print(f"    Proposed score: {proposed_score:.4f}")
    print(f"    Decision: {decision.upper()}")

    return {
        "decision": decision,
        "current_score": current_score,
        "proposed_score": proposed_score,
        "settings": result_settings,
        "eval": proposed_eval if decision == "keep" else current_eval,
    }


# =============================================================================
# FULL TRACE EXPORT (for the meta-agent to inspect)
# =============================================================================

def export_full_traces(training_data, eval_result):
    """Export full traces for the meta-harness agent to inspect.

    Following Meta-Harness paper's key finding: uncompressed access
    to execution traces enables causal reasoning about failures.
    """
    META_DIR.mkdir(parents=True, exist_ok=True)

    # Per-bill traces
    traces = []
    for bill, result in zip(training_data, eval_result.get("results", [])):
        traces.append({
            "reform_id": bill["reform_id"],
            "state": bill["state"],
            "title": bill["title"],
            "reform_types": bill["reform_types"],
            "pe_estimate": bill["pe_estimate"],
            "fiscal_estimate": bill["fiscal_estimate"],
            "actual_diff_pct": result["actual_diff_pct"],
            "tolerance": result["tolerance"],
            "would_accept": result["would_accept"],
            "correct_classification": result["correct_classification"],
            "reform_type_used": result["reform_type"],
            # Full context for causal reasoning
            "reform_params_keys": list(bill["reform_params"].keys())[:5],
            "model_notes": bill.get("model_notes", {}),
            "key_findings_raw": None,  # Could add if needed
        })

    with open(META_DIR / "full_traces.json", "w") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_bills": len(traces),
            "aggregate": {
                "score": eval_result["score"],
                "classification_accuracy": eval_result["classification_accuracy"],
                "avg_diff": eval_result["avg_diff"],
                "median_diff": eval_result["median_diff"],
                "within_tolerance_pct": eval_result["within_tolerance_pct"],
            },
            "traces": traces,
            "failure_analysis": _analyze_failures(traces),
        }, f, indent=2)

    print(f"  Full traces exported to {META_DIR / 'full_traces.json'}")


def _analyze_failures(traces):
    """Identify patterns in misclassified bills."""
    misclassified = [t for t in traces if not t["correct_classification"]]
    if not misclassified:
        return {"misclassified": 0, "patterns": []}

    # Group by reform type
    by_type = {}
    for t in misclassified:
        rt = t["reform_type_used"]
        if rt not in by_type:
            by_type[rt] = []
        by_type[rt].append(t)

    # Group by state
    by_state = {}
    for t in misclassified:
        s = t["state"]
        if s not in by_state:
            by_state[s] = []
        by_state[s].append(t)

    # Are failures mostly false accepts (accepted but too far) or false rejects?
    false_accepts = [t for t in misclassified if t["would_accept"] and t["actual_diff_pct"] > 0.15]
    false_rejects = [t for t in misclassified if not t["would_accept"] and t["actual_diff_pct"] <= 0.15]

    return {
        "misclassified": len(misclassified),
        "false_accepts": len(false_accepts),
        "false_rejects": len(false_rejects),
        "by_reform_type": {k: len(v) for k, v in by_type.items()},
        "by_state": {k: len(v) for k, v in by_state.items()},
        "worst_misclassifications": sorted(
            [{"id": t["reform_id"], "diff": t["actual_diff_pct"], "type": t["reform_type_used"]}
             for t in misclassified],
            key=lambda x: x["diff"], reverse=True,
        )[:5],
    }


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Meta-Harness: optimize harness settings against calibration data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--evaluate", action="store_true", help="Evaluate current settings")
    parser.add_argument("--verbose", action="store_true", help="Show per-bill breakdown")
    parser.add_argument("--settings", type=str, help="Path to settings JSON to evaluate")
    parser.add_argument("--export-traces", action="store_true", help="Export full traces for agent")
    parser.add_argument("--history", action="store_true", help="Show meta-optimization history")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    if args.history:
        history = load_meta_history()
        if not history:
            print("No meta-optimization history yet.")
            return 0
        print(f"\n{'Iter':<6} {'Score':<8} {'Accuracy':<10} {'Avg Diff':<10} {'Within Tol':<12} {'Change'}")
        print("-" * 80)
        for h in history:
            print(
                f"{h['iteration']:<6} {h['score']:<8.4f} {h['classification_accuracy']:<10.2%} "
                f"{h['avg_diff']:<10.2%} {h['within_tolerance_pct']:<12.2%} {h['change_description'][:35]}"
            )
        return 0

    # Load training data
    print("Loading training data...")
    training = load_training_data()
    print(f"  Found {len(training)} bills with PE + fiscal estimates")

    if not training:
        print("  No training data available. Run calibrations first.")
        return 1

    # Load settings
    settings = load_settings(args.settings)

    # Evaluate
    print("Evaluating harness settings...")
    result = evaluate_settings(settings, training, verbose=args.verbose)

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return 0

    print(f"\n{'=' * 50}")
    print(f"Meta-Harness Evaluation")
    print(f"{'=' * 50}")
    print(f"  Bills evaluated:          {result['bills']}")
    print(f"  Overall score:            {result['score']:.4f}")
    print(f"  Classification accuracy:  {result['classification_accuracy']:.1%}")
    print(f"  Avg PE vs fiscal diff:    {result['avg_diff']:.1%}")
    print(f"  Median diff:              {result['median_diff']:.1%}")
    print(f"  Within tolerance:         {result['within_tolerance_pct']:.1%}")
    print(f"  Tolerance calibration:    {result['tolerance_calibration']:.4f}")

    if args.export_traces:
        export_full_traces(training, result)

    # Save baseline if this is the first run
    baseline_path = META_DIR / "baseline_settings.json"
    if not baseline_path.exists():
        save_settings(settings, "baseline")
        append_meta_log(0, "baseline", result, "Initial baseline evaluation")
        print(f"\n  Baseline saved. Run meta-optimization to improve.")

    return 0


if __name__ == "__main__":
    exit(main())
