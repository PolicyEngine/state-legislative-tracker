"""List validations whose snapshot no longer matches the current analysis.

Each validation_metadata row carries `validated_against` — the PE estimate,
model version, and bill status the validation actually checked. This script
compares that snapshot to the live reform_impacts / processed_bills rows and
prints the bills whose validation has drifted, i.e. the re-validation queue.

Exit code 1 when anything has drifted, so CI can gate on it.

Usage:
    python scripts/check_validation_drift.py
Requires SUPABASE_URL and a Supabase key in .env.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_scorecard_source import fetch, load_env  # noqa: E402

# Relative change in the PE estimate below this is numerical noise.
ESTIMATE_TOLERANCE = 0.005


def main() -> None:
    env = load_env()
    base = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_ANON_KEY") or env.get("SUPABASE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and a Supabase key are required")

    validations = fetch(
        f"{base}/rest/v1/validation_metadata?select=id,validated_against,verified_at", key
    )
    impacts = {
        row["id"]: row
        for row in fetch(
            f"{base}/rest/v1/reform_impacts?select=id,budgetary_impact,policyengine_us_version",
            key,
        )
    }
    statuses = {
        f"{row['state'].lower()}-{row['bill_number'].lower().replace(' ', '')}": row["status"]
        for row in fetch(f"{base}/rest/v1/processed_bills?select=state,bill_number,status", key)
    }

    drifted = []
    for validation in validations:
        bill_id = validation["id"]
        snapshot = validation.get("validated_against")
        if not snapshot:
            drifted.append((bill_id, ["no validated_against snapshot — validation unpinned"]))
            continue
        reasons = []
        impact = impacts.get(bill_id)
        current = (impact or {}).get("budgetary_impact") or {}
        current_estimate = current.get("stateRevenueImpact")
        snap_estimate = snapshot.get("pe_estimate")
        if isinstance(snap_estimate, (int, float)) and isinstance(current_estimate, (int, float)):
            if abs(current_estimate - snap_estimate) > abs(snap_estimate) * ESTIMATE_TOLERANCE:
                reasons.append(
                    f"PE estimate moved {snap_estimate:,.0f} -> {current_estimate:,.0f}"
                )
        snap_version = snapshot.get("model_version")
        current_version = (impact or {}).get("policyengine_us_version")
        if snap_version and current_version and snap_version != current_version:
            reasons.append(f"model {snap_version} -> {current_version}")
        snap_status = snapshot.get("bill_status")
        current_status = statuses.get(bill_id)
        if snap_status and current_status and snap_status != current_status:
            reasons.append(f"bill status {snap_status!r} -> {current_status!r}")
        if reasons:
            drifted.append((bill_id, reasons))

    if not drifted:
        print(f"ok: {len(validations)} validations, none drifted")
        return
    print(f"{len(drifted)} of {len(validations)} validations drifted — re-run needed:")
    for bill_id, reasons in drifted:
        print(f"  {bill_id}: {'; '.join(reasons)}")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
