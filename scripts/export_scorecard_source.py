"""Export validation_metadata as a PolicyEngine scorecard source shard.

Emits data/scorecard_source/state_fiscal_notes.json in the same shape the
deployed scorecard serves its per-source data shards
(policyengine.org/scorecard/data/sources/<id>.json): a policy-keyed claim
per external estimate, with the tracker's PolicyEngine estimate as the
counterpart and the fiscal-note reconciliation as the explanation.

Claims carry the tracker bill id as `policy`, which is the shared key the
scorecard needs to join bills to claims.

Usage:
    python scripts/export_scorecard_source.py
Requires SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_KEY) in .env.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "scorecard_source" / "state_fiscal_notes.json"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    env.update(os.environ)
    return env


def fetch(url: str, key: str) -> list[dict]:
    request = Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urlopen(request) as response:
        return json.load(response)


def claim_id(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:20]


def main() -> None:
    env = load_env()
    base = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_ANON_KEY") or env.get("SUPABASE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and a Supabase key are required")

    validations = fetch(f"{base}/rest/v1/validation_metadata?select=*", key)
    research = {
        row["id"]: row
        for row in fetch(f"{base}/rest/v1/research?select=id,state,title,date", key)
    }

    rows = []
    for validation in validations:
        bill_id = validation["id"]
        bill = research.get(bill_id, {})
        geography = (bill.get("state") or "US").upper()
        pe_value = validation.get("pe_estimate")

        def add_claim(source: str, url: str | None, value, notes: str | None = None):
            if not isinstance(value, (int, float)):
                return
            row = {
                "id": claim_id(bill_id, source),
                "policy": bill_id,
                "metric": "budgetary_impact",
                "unit": "usd",
                "value_kind": "amount",
                "geography": geography,
                "status": "comparable",
                "value": value,
                "conditions": {"bill_title": bill.get("title")},
                "provenance": {"source": source, "url": url},
            }
            if isinstance(pe_value, (int, float)):
                row["pe"] = {"value": pe_value}
                row["delta"] = pe_value - value
                if value:
                    row["ratio"] = pe_value / value
            if notes:
                row["notes"] = notes
            rows.append(row)

        note_estimate = validation.get("fiscal_note_estimate")
        low, high = validation.get("target_range_low"), validation.get("target_range_high")
        if not isinstance(note_estimate, (int, float)) and isinstance(low, (int, float)) and isinstance(high, (int, float)):
            # Range-only fiscal notes: claim the midpoint, carry the range.
            note_estimate = (low + high) / 2
        add_claim(
            validation.get("fiscal_note_source") or "Official fiscal note",
            validation.get("fiscal_note_url"),
            note_estimate,
            validation.get("discrepancy_explanation"),
        )
        if rows and isinstance(low, (int, float)) and isinstance(high, (int, float)) and rows[-1]["policy"] == bill_id:
            rows[-1]["conditions"]["range_low"] = low
            rows[-1]["conditions"]["range_high"] = high
        for analysis in validation.get("external_analyses") or []:
            add_claim(
                analysis.get("source") or "External analysis",
                analysis.get("url"),
                analysis.get("estimate"),
                analysis.get("notes"),
            )

    shard = {
        "built": date.today().isoformat(),
        "id": "state_fiscal_notes",
        "meta": {
            "id": "state_fiscal_notes",
            "name": "State fiscal notes and third-party analyses",
            "org": "State legislative fiscal offices",
            "model": "official fiscal notes",
            "url": "https://github.com/PolicyEngine/state-legislative-tracker",
            "auto": False,
            "claims": len(rows),
        },
        "row_defaults": {"relationship": "held_out", "pub": 0},
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(shard, indent=1))
    print(f"wrote {OUT} with {len(rows)} claims across {len(validations)} bills")


if __name__ == "__main__":
    main()
