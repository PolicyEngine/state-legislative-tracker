#!/usr/bin/env python3
"""
Backfill reform_impacts.baseline_params for rows scored before the column
existed (see scripts/sql/008_add_baseline_params.sql).

baseline_params records each reform parameter's value under the baseline a
run used, so readers can see what a bill changed FROM. compute_impacts.py
now writes it on every run; this script fills in the rows already scored.

For most rows the baseline was current law, which this script reads from the
installed policyengine-us. Two cases it will not guess at:

  * Enacted bills. Once policyengine-us includes a bill, current law equals
    the bill's values. A row whose every value matches its reform is
    reported as "already law" and skipped. Score such a bill against its
    prior-law counterfactual and pass that here with --baseline-json (the
    same JSON publish-reform takes as baseline_json).
  * Rows that already have baseline_params, unless --force.

It is a dry run unless --write is given: it prints what it would store.

Usage:
    export SUPABASE_URL=... SUPABASE_KEY=...
    python scripts/backfill_baseline_params.py
    python scripts/backfill_baseline_params.py --write
    python scripts/backfill_baseline_params.py --reform-id ga-hb463-2026 \\
        --baseline-json baselines/ga-hb463-2026.json --write
"""

import argparse
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from compute_impacts import (  # noqa: E402
    baseline_parameter_values,
    create_reform_class,
    get_installed_version,
    get_supabase_client,
)


def _same(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) < 1e-9
    return a == b


def _already_law(reform_params: dict, values: dict) -> bool:
    """Whether the baseline read has every value the reform sets."""
    compared = 0
    for path, periods in reform_params.items():
        if path.startswith("_") or path not in values:
            continue
        reform_periods = periods if isinstance(periods, dict) else {"2026-01-01.2100-12-31": periods}
        for key, value in reform_periods.items():
            compared += 1
            if not _same(values[path].get(key), value):
                return False
    return compared > 0


def _baseline_system(counterfactual: dict | None):
    """The tax-benefit system to read: installed current law, or a counterfactual on it."""
    from policyengine_us import CountryTaxBenefitSystem

    system = CountryTaxBenefitSystem()
    if counterfactual:
        system = create_reform_class(counterfactual)(system)
    return SimpleNamespace(tax_benefit_system=system)


def main():
    parser = argparse.ArgumentParser(description="Backfill reform_impacts.baseline_params")
    parser.add_argument("--reform-id", help="Only this row")
    parser.add_argument(
        "--baseline-json",
        help="Prior-law counterfactual for an enacted bill (requires --reform-id)",
    )
    parser.add_argument("--force", action="store_true", help="Replace existing baseline_params")
    parser.add_argument("--write", action="store_true", help="Write to Supabase (default: dry run)")
    args = parser.parse_args()

    if args.baseline_json and not args.reform_id:
        print("Error: --baseline-json requires --reform-id")
        return 1

    counterfactual = None
    if args.baseline_json:
        with open(args.baseline_json) as f:
            counterfactual = json.load(f)
        if not isinstance(counterfactual, dict) or not counterfactual:
            print("Error: --baseline-json must hold a non-empty JSON object")
            return 1

    supabase = get_supabase_client()
    if not supabase:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
        return 1

    query = supabase.table("reform_impacts").select(
        "id, reform_params, baseline_params, policyengine_us_version"
    )
    if args.reform_id:
        query = query.eq("id", args.reform_id)
    rows = query.execute().data

    installed = get_installed_version("policyengine-us")
    print(f"policyengine-us {installed} installed; {len(rows)} row(s)")
    print("Dry run — nothing is written.\n" if not args.write else "Writing.\n")

    system = _baseline_system(counterfactual)
    counts = {"filled": 0, "already law": 0, "has value": 0, "no reform": 0}
    for row in rows:
        reform_params = row.get("reform_params") or {}
        if not reform_params:
            counts["no reform"] += 1
            continue
        if row.get("baseline_params") and not args.force:
            counts["has value"] += 1
            continue

        values = baseline_parameter_values(system, reform_params)
        if not counterfactual and _already_law(reform_params, values):
            counts["already law"] += 1
            print(f"  {row['id']}: already law in {installed}; skipped (needs --baseline-json)")
            continue

        stored = row.get("policyengine_us_version")
        note = "" if stored == installed else f" (scored with {stored})"
        print(f"  {row['id']}{note}:")
        for path, periods in values.items():
            reform_periods = reform_params.get(path)
            for key, value in periods.items():
                after = reform_periods.get(key) if isinstance(reform_periods, dict) else reform_periods
                print(f"      {path} [{key}]: {value} → {after}")

        if args.write:
            supabase.table("reform_impacts").update({"baseline_params": values}).eq(
                "id", row["id"]
            ).execute()
        counts["filled"] += 1

    verb = "Filled" if args.write else "Would fill"
    print(
        f"\n{verb} {counts['filled']}; already law (skipped) {counts['already law']}; "
        f"had a value {counts['has value']}; no reform {counts['no reform']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
