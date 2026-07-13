#!/usr/bin/env python3
"""
Merge a research-table row into a computed analysis artifact.

compute_impacts.py --output writes {"reform_impacts": {...}} only; the
publish-reform workflow (dispatched by the CRM publication router) uses this
script to add the "research" block that publish_analysis.py upserts alongside
the impacts. Status is always in_review — 'published' is reserved for the
publish-bill workflow on PR merge.

Metadata comes in via environment variables (the workflow maps its
workflow_dispatch inputs onto them):

    REFORM_ID           required, ^[a-z0-9][a-z0-9-]*$
    REFORM_STATE        required, "us" or a 2-letter state code
    REFORM_TITLE        required
    REFORM_DESCRIPTION  optional
    REFORM_TAGS         optional, comma-separated
    REFORM_SOURCE_URL   optional

Usage:
    python scripts/merge_research_metadata.py analyses/us-ctc-restoration.json
"""

import json
import os
import re
import sys
from datetime import date


def build_key_findings(impacts: dict) -> list[str]:
    """Derive headline key_findings from the computed impacts record."""
    findings = []

    budget = impacts.get("budgetary_impact") or {}
    net_cost = budget.get("netCost")
    year = (impacts.get("model_notes") or {}).get("analysis_year")
    version = impacts.get("policyengine_us_version")
    dataset = impacts.get("dataset_name")
    if isinstance(net_cost, (int, float)) and net_cost != 0:
        direction = "Reduces" if net_cost < 0 else "Raises"
        provenance = ", ".join(
            p for p in (f"PolicyEngine {dataset or ''}".strip(), f"policyengine-us {version}" if version else "")
            if p
        )
        findings.append(
            f"{direction} government revenue by ${abs(net_cost) / 1e9:.1f} billion"
            + (f" in {year}" if year else "")
            + (f" ({provenance})" if provenance else "")
        )

    wl = impacts.get("winners_losers") or {}
    gain = (wl.get("gainMore5Pct") or 0) + (wl.get("gainLess5Pct") or 0)
    lose = (wl.get("loseMore5Pct") or 0) + (wl.get("loseLess5Pct") or 0)
    if gain or lose:
        findings.append(
            f"{gain * 100:.1f}% of households gain; {lose * 100:.1f}% lose"
        )

    poverty = impacts.get("poverty_impact") or {}
    pct = poverty.get("percentChange")
    if isinstance(pct, (int, float)):
        if abs(pct) < 0.5:
            findings.append("No measurable change in overall poverty (SPM)")
        else:
            direction = "Reduces" if pct < 0 else "Increases"
            findings.append(f"{direction} overall poverty by {abs(pct):.1f}% (SPM)")

    return findings


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    artifact_path = sys.argv[1]

    reform_id = os.environ.get("REFORM_ID", "")
    state = os.environ.get("REFORM_STATE", "").strip().upper()
    title = os.environ.get("REFORM_TITLE", "").strip()
    description = os.environ.get("REFORM_DESCRIPTION", "").strip()
    tags_raw = os.environ.get("REFORM_TAGS", "")
    source_url = os.environ.get("REFORM_SOURCE_URL", "").strip()

    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", reform_id):
        print(f"Error: REFORM_ID {reform_id!r} must match ^[a-z0-9][a-z0-9-]*$")
        return 1
    if not re.fullmatch(r"[A-Z]{2}", state):
        print(f"Error: REFORM_STATE {state!r} must be 'us' or a 2-letter state code")
        return 1
    if not title:
        print("Error: REFORM_TITLE is required")
        return 1

    with open(artifact_path) as f:
        artifact = json.load(f)

    impacts = artifact.get("reform_impacts")
    if not impacts or impacts.get("id") != reform_id:
        print(
            f"Error: artifact reform_impacts.id {impacts.get('id') if impacts else None!r}"
            f" does not match REFORM_ID {reform_id!r}"
        )
        return 1

    tags = [t.strip().lower() for t in tags_raw.split(",") if t.strip()]

    artifact["research"] = {
        "id": reform_id,
        "state": state,
        "type": "bill",
        "status": "in_review",  # publish-bill.yml flips to published on PR merge
        "title": title,
        "url": source_url or None,
        "date": date.today().isoformat(),
        "author": "PolicyEngine",
        "description": description or None,
        "key_findings": build_key_findings(impacts),
        "tags": tags,
    }

    with open(artifact_path, "w") as f:
        json.dump(artifact, f, indent=2)
    print(f"Merged research row into {artifact_path} (status=in_review)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
