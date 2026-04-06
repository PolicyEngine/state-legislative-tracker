#!/usr/bin/env python3
"""
Autonomous reform calibration loop.

Inspired by karpathy/autoresearch: iteratively refine reform_params to minimize
the discrepancy between PolicyEngine's estimate and a validation target.

The calibration agent modifies reform_params (the "train.py"), while this script
provides the immutable evaluation harness (the "prepare.py") — running the
simulation, comparing to target, deciding keep/discard, detecting plateau.

Usage:
    # Run calibration for a specific reform
    python scripts/auto_calibrate.py --reform-id ga-hb168

    # With explicit fiscal data (JSON file from fiscal-finder)
    python scripts/auto_calibrate.py --reform-id ga-hb168 --fiscal-data fiscal.json

    # Set max iterations (default 10)
    python scripts/auto_calibrate.py --reform-id ga-hb168 --max-iterations 15

    # Dry run — build target and show harness output without running loop
    python scripts/auto_calibrate.py --reform-id ga-hb168 --dry-run

    # Show results for a completed calibration
    python scripts/auto_calibrate.py --reform-id ga-hb168 --show-results
"""

import argparse
import csv
import json
import os
import subprocess
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

from validation_harness import (
    HarnessResult,
    build_target,
    load_fiscal_data_from_db,
    load_provisions_from_db,
)


# =============================================================================
# CONFIGURATION
# =============================================================================

RESULTS_DIR = _script_dir.parent / "results"
PLATEAU_WINDOW = 3        # Number of recent attempts to check for plateau
PLATEAU_THRESHOLD = 0.02  # <2% improvement across window = plateau


# =============================================================================
# SUPABASE CLIENT
# =============================================================================

def get_supabase_client():
    """Get Supabase client."""
    try:
        from supabase import create_client
    except ImportError:
        print("Error: supabase package not installed. Run: pip install supabase")
        return None

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        return None

    return create_client(url, key)


# =============================================================================
# EXPERIMENT RUNNER (immutable evaluation — agent cannot modify this)
# =============================================================================

def run_experiment(reform_id: str, reform_params: dict, year: int = None) -> dict:
    """Write params to DB, run compute_impacts, return PE estimate.

    This is the immutable evaluation harness. The calibration agent
    modifies reform_params; this function evaluates them.

    Returns:
        {
            "pe_estimate": float,   # stateRevenueImpact
            "success": bool,
            "error": str or None,
            "runtime_seconds": float,
        }
    """
    supabase = get_supabase_client()
    if not supabase:
        return {"pe_estimate": 0, "success": False, "error": "No Supabase connection"}

    # Write updated reform_params to DB
    supabase.table("reform_impacts").update(
        {"reform_params": reform_params}
    ).eq("id", reform_id).execute()

    # Build command
    cmd = [
        sys.executable, str(_script_dir / "compute_impacts.py"),
        "--reform-id", reform_id,
        "--force",
    ]
    if year:
        cmd.extend(["--year", str(year)])

    start = datetime.now()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 min max
            cwd=str(_script_dir),
        )
        runtime = (datetime.now() - start).total_seconds()

        if result.returncode != 0:
            return {
                "pe_estimate": 0,
                "success": False,
                "error": f"compute_impacts failed: {result.stderr[-500:]}",
                "runtime_seconds": runtime,
            }

        # Read back the computed budgetary impact
        row = supabase.table("reform_impacts").select(
            "budgetary_impact"
        ).eq("id", reform_id).execute()

        if not row.data:
            return {
                "pe_estimate": 0,
                "success": False,
                "error": "No data after compute",
                "runtime_seconds": runtime,
            }

        budgetary = row.data[0].get("budgetary_impact", {})
        pe_estimate = budgetary.get("stateRevenueImpact", 0)

        return {
            "pe_estimate": float(pe_estimate),
            "success": True,
            "error": None,
            "runtime_seconds": runtime,
        }

    except subprocess.TimeoutExpired:
        runtime = (datetime.now() - start).total_seconds()
        return {
            "pe_estimate": 0,
            "success": False,
            "error": "Timeout (>10 min)",
            "runtime_seconds": runtime,
        }
    except Exception as e:
        runtime = (datetime.now() - start).total_seconds()
        return {
            "pe_estimate": 0,
            "success": False,
            "error": str(e),
            "runtime_seconds": runtime,
        }


# =============================================================================
# METRIC & DECISION (the val_bpb equivalent)
# =============================================================================

def evaluate(pe_estimate: float, target: float) -> tuple[float, bool]:
    """Compute discrepancy and check if within tolerance.

    Returns:
        (pct_diff, within_band): percentage difference and whether acceptable
    """
    if target == 0:
        return float("inf"), False

    pct_diff = abs(pe_estimate - target) / abs(target)
    return pct_diff, False  # within_band checked by caller with tolerance


def decide(current_pct: float, best_pct: float) -> str:
    """Keep or discard — like autoresearch's git keep/reset.

    Returns: "keep" or "discard"
    """
    if current_pct < best_pct:
        return "keep"
    return "discard"


def detect_plateau(history: list[dict], window: int = PLATEAU_WINDOW, threshold: float = PLATEAU_THRESHOLD) -> bool:
    """Detect when improvement has stalled.

    A plateau is when the best pct_diff in the last `window` kept attempts
    hasn't improved by more than `threshold` compared to the best before that.
    """
    kept = [h for h in history if h["status"] == "keep"]
    if len(kept) < window:
        return False

    recent_best = min(h["pct_diff"] for h in kept[-window:])
    prior_best = min(h["pct_diff"] for h in kept[:-window]) if len(kept) > window else kept[0]["pct_diff"]

    improvement = prior_best - recent_best
    return improvement < threshold


# =============================================================================
# CALIBRATION LOG (results.tsv equivalent)
# =============================================================================

def get_results_dir(reform_id: str) -> Path:
    """Get or create the results directory for a reform."""
    reform_dir = RESULTS_DIR / reform_id
    reform_dir.mkdir(parents=True, exist_ok=True)
    return reform_dir


def init_calibration_log(reform_id: str) -> Path:
    """Initialize calibration.tsv with headers."""
    reform_dir = get_results_dir(reform_id)
    log_path = reform_dir / "calibration.tsv"

    if not log_path.exists():
        with open(log_path, "w", newline="") as f:
            writer = csv.writer(f, delimiter="\t")
            writer.writerow([
                "attempt", "timestamp", "pe_estimate", "target",
                "tolerance", "pct_diff", "status", "runtime_sec", "description",
            ])

    return log_path


def append_calibration_log(
    reform_id: str,
    attempt: int,
    pe_estimate: float,
    target: float,
    tolerance: float,
    pct_diff: float,
    status: str,
    runtime_sec: float,
    description: str,
):
    """Append a row to calibration.tsv."""
    log_path = init_calibration_log(reform_id)
    with open(log_path, "a", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow([
            attempt,
            datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            f"{pe_estimate:.0f}",
            f"{target:.0f}",
            f"{tolerance:.0%}",
            f"{pct_diff:.1%}",
            status,
            f"{runtime_sec:.0f}",
            description,
        ])


def load_calibration_history(reform_id: str) -> list[dict]:
    """Load existing calibration history."""
    log_path = RESULTS_DIR / reform_id / "calibration.tsv"
    if not log_path.exists():
        return []

    history = []
    with open(log_path) as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            history.append({
                "attempt": int(row["attempt"]),
                "pe_estimate": float(row["pe_estimate"]),
                "target": float(row["target"]),
                "pct_diff": float(row["pct_diff"].rstrip("%")) / 100,
                "status": row["status"],
                "description": row["description"],
            })
    return history


def write_diagnosis(reform_id: str, diagnosis: dict):
    """Write diagnosis.json for a completed calibration."""
    reform_dir = get_results_dir(reform_id)
    with open(reform_dir / "diagnosis.json", "w") as f:
        json.dump(diagnosis, f, indent=2)


def write_harness_output(reform_id: str, harness_result: HarnessResult):
    """Write harness_output.json for reference."""
    reform_dir = get_results_dir(reform_id)
    with open(reform_dir / "harness_output.json", "w") as f:
        json.dump(harness_result.to_dict(), f, indent=2)


# =============================================================================
# DATABASE PERSISTENCE
# =============================================================================

def write_calibration_to_db(
    reform_id: str,
    state: str,
    harness_result: HarnessResult,
    history: list[dict],
    diagnosis: dict = None,
):
    """Persist calibration results to Supabase.

    Writes to three places:
    1. validation_metadata — fiscal note, target, PE estimate, iterations, discrepancy
    2. reform_impacts.model_notes.calibration — summary for frontend display
    3. calibration_learnings — extracted patterns for the outer loop
    """
    supabase = get_supabase_client()
    if not supabase:
        print("  Warning: No Supabase connection, skipping DB write")
        return

    harness_dict = harness_result.to_dict()
    kept = [h for h in history if h["status"] in ("keep", "accept")]
    final = kept[-1] if kept else history[-1] if history else None
    initial = history[0] if history else None

    if not final:
        return

    # --- 1. validation_metadata ---
    fiscal_strategy = next((s for s in harness_dict["strategies"] if s["name"] == "fiscal_note"), None)
    envelope_strategy = next((s for s in harness_dict["strategies"] if s["name"] == "back_of_envelope"), None)
    non_fiscal = [s for s in harness_dict["strategies"] if s["name"] not in ("fiscal_note", "back_of_envelope")]

    vm_record = {
        "id": reform_id,
        "pe_estimate": final["pe_estimate"],
        "within_range": final["pct_diff"] <= harness_result.tolerance,
        "difference_from_fiscal_note_pct": round(final["pct_diff"] * 100, 2),
        "iterations": len(history),
        "iteration_log": [
            {
                "attempt": h["attempt"],
                "pe_estimate": h["pe_estimate"],
                "pct_diff": round(h["pct_diff"] * 100, 1),
                "status": h["status"],
                "description": h["description"],
            }
            for h in history
        ],
        "target_range_low": harness_dict["target"] * (1 - harness_result.tolerance),
        "target_range_high": harness_dict["target"] * (1 + harness_result.tolerance),
    }

    if fiscal_strategy:
        vm_record["fiscal_note_source"] = fiscal_strategy.get("source", "")
        vm_record["fiscal_note_estimate"] = fiscal_strategy["estimate"]
        vm_record["fiscal_note_url"] = fiscal_strategy.get("source", "")

    if envelope_strategy:
        vm_record["envelope_estimate"] = envelope_strategy["estimate"]
        vm_record["envelope_methodology"] = envelope_strategy.get("reasoning", "")

    if non_fiscal:
        vm_record["external_analyses"] = non_fiscal

    if diagnosis:
        vm_record["discrepancy_explanation"] = diagnosis.get("root_cause") or diagnosis.get("explanation", "")

    try:
        supabase.table("validation_metadata").upsert(vm_record).execute()
        print(f"  Written to validation_metadata")
    except Exception as e:
        print(f"  Warning: validation_metadata write failed: {e}")

    # --- 2. reform_impacts.model_notes.calibration ---
    try:
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

        model_notes["calibration"] = {
            "converged": final["status"] == "accept",
            "attempts": len(history),
            "initial_diff_pct": round(initial["pct_diff"] * 100, 1) if initial else None,
            "final_diff_pct": round(final["pct_diff"] * 100, 1),
            "target": harness_dict["target"],
            "target_source": fiscal_strategy["source"] if fiscal_strategy else harness_dict["reasoning"],
            "target_confidence": harness_dict["confidence"],
            "diagnosis_category": diagnosis.get("category", "") if diagnosis else "",
            "root_cause": diagnosis.get("root_cause", "") if diagnosis else "",
            "calibrated_at": datetime.now(timezone.utc).isoformat(),
        }

        supabase.table("reform_impacts").update(
            {"model_notes": model_notes}
        ).eq("id", reform_id).execute()
        print(f"  Written to reform_impacts.model_notes.calibration")
    except Exception as e:
        print(f"  Warning: model_notes write failed: {e}")

    # --- 3. calibration_learnings (if diagnosis has actionable patterns) ---
    if diagnosis and diagnosis.get("category"):
        learning_record = {
            "reform_id": reform_id,
            "state": state.upper(),
            "pattern": _categorize_pattern(diagnosis),
            "learning": diagnosis.get("root_cause") or diagnosis.get("explanation", ""),
            "details": {
                "final_pct_diff": final["pct_diff"],
                "attempts": len(history),
                "key_findings": diagnosis.get("key_findings", {}),
                "suggestions": diagnosis.get("suggestions", []),
            },
            "category": diagnosis.get("category", ""),
            "scope": "state",
        }

        try:
            supabase.table("calibration_learnings").insert(learning_record).execute()
            print(f"  Written to calibration_learnings")
        except Exception as e:
            # Table might not exist yet — fall back silently
            print(f"  Note: calibration_learnings write skipped ({e})")


def _categorize_pattern(diagnosis: dict) -> str:
    """Extract a pattern label from a diagnosis."""
    category = diagnosis.get("category", "")
    root_cause = (diagnosis.get("root_cause") or "").lower()

    if "baseline mismatch" in root_cause or "pre-scheduled" in root_cause:
        return "baseline_mismatch"
    elif "data" in category:
        return "data_gap"
    elif "per-person" in root_cause or "per-return" in root_cause:
        return "per_person_vs_return"
    elif "period" in root_cause or "cola" in root_cause.lower():
        return "period_or_cola"
    elif category == "parameter-solvable":
        return "parameter_mapping"
    else:
        return "other"


# =============================================================================
# REFORM PARAMS MANAGEMENT (keep/revert)
# =============================================================================

def save_reform_snapshot(reform_id: str, reform_params: dict, label: str):
    """Save a snapshot of reform_params (for revert on discard)."""
    reform_dir = get_results_dir(reform_id)
    snapshots_dir = reform_dir / "snapshots"
    snapshots_dir.mkdir(exist_ok=True)
    with open(snapshots_dir / f"{label}.json", "w") as f:
        json.dump(reform_params, f, indent=2)


def load_reform_snapshot(reform_id: str, label: str) -> dict:
    """Load a saved reform_params snapshot."""
    path = RESULTS_DIR / reform_id / "snapshots" / f"{label}.json"
    with open(path) as f:
        return json.load(f)


def get_current_reform_params(reform_id: str) -> dict:
    """Read current reform_params from DB."""
    supabase = get_supabase_client()
    if not supabase:
        return {}

    result = supabase.table("reform_impacts").select(
        "reform_params"
    ).eq("id", reform_id).execute()

    if not result.data:
        return {}
    return result.data[0].get("reform_params", {})


def revert_reform_params(reform_id: str, reform_params: dict):
    """Write reform_params back to DB (revert to previous best)."""
    supabase = get_supabase_client()
    if not supabase:
        return

    supabase.table("reform_impacts").update(
        {"reform_params": reform_params}
    ).eq("id", reform_id).execute()


# =============================================================================
# SINGLE EXPERIMENT STEP (called by agent or by loop)
# =============================================================================

def run_calibration_step(
    reform_id: str,
    reform_params: dict,
    target: float,
    tolerance: float,
    attempt: int,
    description: str,
    best_pct: float,
    best_params: dict,
    year: int = None,
) -> dict:
    """Run one calibration experiment and decide keep/discard.

    This is the core step that the calibration agent calls repeatedly.

    Args:
        reform_id: Bill identifier
        reform_params: The proposed reform_params to test
        target: Harness target estimate
        tolerance: Acceptable % difference
        attempt: Attempt number
        description: What was changed and why
        best_pct: Best pct_diff so far
        best_params: Best reform_params so far (for revert)
        year: Simulation year override

    Returns:
        {
            "status": "keep" | "discard" | "accept" | "crash",
            "pct_diff": float,
            "pe_estimate": float,
            "best_pct": float,  # Updated best
            "best_params": dict,  # Updated best params
        }
    """
    print(f"\n  Attempt {attempt}: {description}")

    # Save snapshot before running
    save_reform_snapshot(reform_id, reform_params, f"attempt_{attempt}")

    # Run the experiment
    result = run_experiment(reform_id, reform_params, year)

    if not result["success"]:
        # Crash — revert and log
        revert_reform_params(reform_id, best_params)
        append_calibration_log(
            reform_id, attempt, 0, target, tolerance, 1.0,
            "crash", result.get("runtime_seconds", 0),
            f"CRASH: {result['error'][:100]}. Reverted.",
        )
        print(f"    CRASH: {result['error'][:100]}")
        return {
            "status": "crash",
            "pct_diff": 1.0,
            "pe_estimate": 0,
            "best_pct": best_pct,
            "best_params": best_params,
        }

    pe_estimate = result["pe_estimate"]
    pct_diff, _ = evaluate(pe_estimate, target)
    runtime = result["runtime_seconds"]

    # Check if within tolerance
    if pct_diff <= tolerance:
        append_calibration_log(
            reform_id, attempt, pe_estimate, target, tolerance, pct_diff,
            "accept", runtime, f"ACCEPT: {description}",
        )
        pe_str = f"${pe_estimate/1e6:,.1f}M" if abs(pe_estimate) >= 1e6 else f"${pe_estimate:,.0f}"
        print(f"    ACCEPT! PE={pe_str}, diff={pct_diff:.1%} (within {tolerance:.0%} tolerance)")
        return {
            "status": "accept",
            "pct_diff": pct_diff,
            "pe_estimate": pe_estimate,
            "best_pct": pct_diff,
            "best_params": reform_params,
        }

    # Decide keep/discard
    decision = decide(pct_diff, best_pct)

    if decision == "keep":
        append_calibration_log(
            reform_id, attempt, pe_estimate, target, tolerance, pct_diff,
            "keep", runtime, description,
        )
        pe_str = f"${pe_estimate/1e6:,.1f}M" if abs(pe_estimate) >= 1e6 else f"${pe_estimate:,.0f}"
        print(f"    KEEP: PE={pe_str}, diff={pct_diff:.1%} (improved from {best_pct:.1%})")
        return {
            "status": "keep",
            "pct_diff": pct_diff,
            "pe_estimate": pe_estimate,
            "best_pct": pct_diff,
            "best_params": reform_params,
        }
    else:
        # Revert to best params
        revert_reform_params(reform_id, best_params)
        append_calibration_log(
            reform_id, attempt, pe_estimate, target, tolerance, pct_diff,
            "discard", runtime, f"DISCARD: {description}",
        )
        pe_str = f"${pe_estimate/1e6:,.1f}M" if abs(pe_estimate) >= 1e6 else f"${pe_estimate:,.0f}"
        print(f"    DISCARD: PE={pe_str}, diff={pct_diff:.1%} (worse than best {best_pct:.1%}). Reverted.")
        return {
            "status": "discard",
            "pct_diff": pct_diff,
            "pe_estimate": pe_estimate,
            "best_pct": best_pct,
            "best_params": best_params,
        }


# =============================================================================
# FINALIZE: persist results to DB after calibration completes
# =============================================================================

def finalize_calibration(reform_id: str, state: str = None):
    """Persist calibration results to DB after the agent finishes.

    Call this after the calibration loop completes (converged, plateaued, or
    max iterations). Reads local results files and writes to Supabase.

    Args:
        reform_id: Bill identifier
        state: Two-letter state code (auto-detected from reform_id if not given)
    """
    if state is None:
        state = reform_id.split("-")[0]

    print(f"\n--- Finalizing calibration: {reform_id} ---")

    # Load local results
    history = load_calibration_history(reform_id)
    if not history:
        print("  No calibration history to persist")
        return

    # Load harness output
    harness_path = RESULTS_DIR / reform_id / "harness_output.json"
    if not harness_path.exists():
        print("  No harness output found")
        return

    with open(harness_path) as f:
        harness_dict = json.load(f)

    # Reconstruct HarnessResult from dict
    harness_result = HarnessResult(
        target=harness_dict["target"],
        confidence=harness_dict["confidence"],
        tolerance=harness_dict["tolerance"],
        strategies=[],  # Not needed for DB write
        reasoning=harness_dict["reasoning"],
        auto_loop=harness_dict["auto_loop"],
    )

    # Load diagnosis if exists
    diagnosis = None
    diagnosis_path = RESULTS_DIR / reform_id / "diagnosis.json"
    if diagnosis_path.exists():
        with open(diagnosis_path) as f:
            diagnosis = json.load(f)

    write_calibration_to_db(
        reform_id=reform_id,
        state=state,
        harness_result=harness_result,
        history=history,
        diagnosis=diagnosis,
    )

    print(f"  Calibration persisted to DB")


# =============================================================================
# MAIN: HARNESS SETUP + INITIAL RUN
# =============================================================================

def setup_calibration(reform_id: str, fiscal_data: dict = None, year: int = None) -> dict:
    """Set up calibration: build target, run initial experiment, return state.

    This is the entry point. After this, the calibration agent takes over
    by calling run_calibration_step() repeatedly.

    Returns:
        {
            "reform_id": str,
            "harness": HarnessResult (as dict),
            "target": float,
            "tolerance": float,
            "initial_pe": float,
            "initial_pct_diff": float,
            "current_best_pct": float,
            "current_best_params": dict,
            "attempt": int,
            "auto_loop": bool,
            "year": int,
        }
    """
    print("=" * 60)
    print(f"Auto-Calibration Setup: {reform_id}")
    print("=" * 60)

    supabase = get_supabase_client()
    if not supabase:
        print("Error: No Supabase connection")
        return None

    # Load reform data
    result = supabase.table("research").select(
        "id, state, title, reform_impacts(reform_params, provisions, computed)"
    ).eq("id", reform_id).execute()

    if not result.data:
        print(f"Error: Reform '{reform_id}' not found")
        return None

    research = result.data[0]
    state = research["state"].lower()
    impact_data = research.get("reform_impacts")
    if isinstance(impact_data, list):
        impact_data = impact_data[0] if impact_data else {}

    reform_params = impact_data.get("reform_params", {})
    if not reform_params:
        print("Error: No reform_params found")
        return None

    # Load provisions
    provisions = impact_data.get("provisions", [])
    if isinstance(provisions, str):
        try:
            provisions = json.loads(provisions)
        except json.JSONDecodeError:
            provisions = []

    # Load fiscal data if not provided
    if fiscal_data is None:
        fiscal_data = load_fiscal_data_from_db(reform_id)

    # Build validation target
    print("\n--- Building Validation Target ---")
    harness = build_target(
        reform_id=reform_id,
        state=state,
        provisions=provisions or [],
        reform_params=reform_params,
        fiscal_data=fiscal_data,
    )
    write_harness_output(reform_id, harness)

    print(f"\n{harness.summary_table()}")

    if not harness.auto_loop:
        print("\nTarget confidence too low for auto-loop. Human review needed.")

    if harness.target == 0:
        print("\nNo target estimate available. Cannot calibrate.")
        return None

    # Determine year
    if year is None:
        from compute_impacts import get_effective_year_from_params
        year = get_effective_year_from_params(reform_params)

    # Run initial experiment (attempt 0 = baseline)
    print(f"\n--- Initial Experiment (baseline) ---")
    save_reform_snapshot(reform_id, reform_params, "baseline")

    initial_result = run_experiment(reform_id, reform_params, year)

    if not initial_result["success"]:
        print(f"Error: Initial experiment failed: {initial_result['error']}")
        return None

    pe_estimate = initial_result["pe_estimate"]
    pct_diff, _ = evaluate(pe_estimate, harness.target)

    pe_str = f"${pe_estimate/1e6:,.1f}M" if abs(pe_estimate) >= 1e6 else f"${pe_estimate:,.0f}"
    target_str = f"${harness.target/1e6:,.1f}M" if abs(harness.target) >= 1e6 else f"${harness.target:,.0f}"
    print(f"  PE estimate: {pe_str}")
    print(f"  Target:      {target_str}")
    print(f"  Diff:        {pct_diff:.1%}")
    print(f"  Tolerance:   {harness.tolerance:.0%}")

    # Log initial attempt
    init_calibration_log(reform_id)
    status = "accept" if pct_diff <= harness.tolerance else "keep"
    append_calibration_log(
        reform_id, 0, pe_estimate, harness.target, harness.tolerance,
        pct_diff, status, initial_result["runtime_seconds"],
        "Baseline — initial reform_params",
    )

    if pct_diff <= harness.tolerance:
        print(f"\n  Already within tolerance! No calibration needed.")

    return {
        "reform_id": reform_id,
        "state": state,
        "harness": harness.to_dict(),
        "target": harness.target,
        "tolerance": harness.tolerance,
        "initial_pe": pe_estimate,
        "initial_pct_diff": pct_diff,
        "current_best_pct": pct_diff,
        "current_best_params": reform_params,
        "attempt": 1,
        "auto_loop": harness.auto_loop,
        "year": year,
        "provisions": provisions,
    }


# =============================================================================
# SHOW RESULTS
# =============================================================================

def show_results(reform_id: str):
    """Display calibration results for a reform."""
    history = load_calibration_history(reform_id)
    if not history:
        print(f"No calibration history for {reform_id}")
        return

    print(f"\n{'=' * 70}")
    print(f"Calibration Results: {reform_id}")
    print(f"{'=' * 70}")
    print(f"{'Attempt':<8} {'PE Estimate':<15} {'Target':<15} {'Diff':<8} {'Status':<10} {'Description'}")
    print("-" * 70)

    for h in history:
        pe_str = f"${h['pe_estimate']/1e6:,.1f}M" if abs(h['pe_estimate']) >= 1e6 else f"${h['pe_estimate']:,.0f}"
        target_str = f"${h['target']/1e6:,.1f}M" if abs(h['target']) >= 1e6 else f"${h['target']:,.0f}"
        print(f"{h['attempt']:<8} {pe_str:<15} {target_str:<15} {h['pct_diff']:.1%}{'':>3} {h['status']:<10} {h['description'][:40]}")

    kept = [h for h in history if h["status"] in ("keep", "accept")]
    if kept:
        best = min(kept, key=lambda h: h["pct_diff"])
        print(f"\nBest: attempt {best['attempt']} at {best['pct_diff']:.1%} diff")

    # Show diagnosis if available
    diag_path = RESULTS_DIR / reform_id / "diagnosis.json"
    if diag_path.exists():
        with open(diag_path) as f:
            diagnosis = json.load(f)
        print(f"\nDiagnosis: {diagnosis.get('category', 'unknown')}")
        print(f"  {diagnosis.get('explanation', '')}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Autonomous reform calibration loop",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Set up calibration (builds target, runs baseline)
    python scripts/auto_calibrate.py --reform-id ga-hb168

    # Dry run (show target without running simulation)
    python scripts/auto_calibrate.py --reform-id ga-hb168 --dry-run

    # With fiscal data from a JSON file
    python scripts/auto_calibrate.py --reform-id ga-hb168 --fiscal-data fiscal.json

    # Show existing results
    python scripts/auto_calibrate.py --reform-id ga-hb168 --show-results
        """,
    )
    parser.add_argument("--reform-id", required=True, help="Reform identifier (e.g., ga-hb168)")
    parser.add_argument("--fiscal-data", type=str, help="Path to fiscal data JSON (from fiscal-finder)")
    parser.add_argument("--max-iterations", type=int, default=10, help="Max calibration iterations")
    parser.add_argument("--year", type=int, help="Override simulation year")
    parser.add_argument("--dry-run", action="store_true", help="Build target only, don't run simulation")
    parser.add_argument("--show-results", action="store_true", help="Show calibration results and exit")
    parser.add_argument("--finalize", action="store_true", help="Persist calibration results to DB (run after agent finishes)")

    args = parser.parse_args()

    if args.show_results:
        show_results(args.reform_id)
        return 0

    if args.finalize:
        finalize_calibration(args.reform_id)
        return 0

    # Load fiscal data
    fiscal_data = None
    if args.fiscal_data:
        with open(args.fiscal_data) as f:
            fiscal_data = json.load(f)

    if args.dry_run:
        # Just build the target and show it
        state = args.reform_id.split("-")[0]
        provisions = load_provisions_from_db(args.reform_id)
        reform_params = get_current_reform_params(args.reform_id)
        if fiscal_data is None:
            fiscal_data = load_fiscal_data_from_db(args.reform_id)

        harness = build_target(
            reform_id=args.reform_id,
            state=state,
            provisions=provisions,
            reform_params=reform_params,
            fiscal_data=fiscal_data or {},
        )
        print(harness.summary_table())
        write_harness_output(args.reform_id, harness)
        return 0

    # Full setup: build target + run baseline
    state = setup_calibration(
        reform_id=args.reform_id,
        fiscal_data=fiscal_data,
        year=args.year,
    )

    if state is None:
        return 1

    # Output state for the calibration agent to pick up
    state_path = get_results_dir(args.reform_id) / "calibration_state.json"
    # Convert non-serializable items
    serializable = {k: v for k, v in state.items()}
    with open(state_path, "w") as f:
        json.dump(serializable, f, indent=2)

    print(f"\n--- Calibration State ---")
    print(f"  State saved to: {state_path}")
    print(f"  Target: ${state['target']/1e6:,.1f}M")
    print(f"  Initial diff: {state['initial_pct_diff']:.1%}")
    print(f"  Tolerance: {state['tolerance']:.0%}")
    print(f"  Auto-loop: {'yes' if state['auto_loop'] else 'no'}")

    if state["initial_pct_diff"] <= state["tolerance"]:
        print(f"\n  Already within tolerance — no calibration needed.")
        return 0

    if not state["auto_loop"]:
        print(f"\n  Target confidence too low for autonomous loop.")
        print(f"  Review harness output and provide better fiscal data.")
        return 0

    print(f"\n  Ready for calibration agent to iterate.")
    print(f"  Max iterations: {args.max_iterations}")
    print(f"  The agent should call run_calibration_step() up to {args.max_iterations} times.")

    return 0


if __name__ == "__main__":
    exit(main())
