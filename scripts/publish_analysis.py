#!/usr/bin/env python3
"""
Publish a locally-computed analysis artifact to Supabase.

Analyses are computed locally (compute_impacts.py --reform-json ... --output ...)
because the microsimulation is heavy, but the Supabase service key only lives
in CI — so the artifact is committed under analyses/ and this script uploads
it from the publish-analysis workflow.

Artifact shape:
{
  "research": { ...research table row... },        # optional
  "reform_impacts": { ...reform_impacts row... }   # required
}

Usage:
    export SUPABASE_URL=... SUPABASE_KEY=...
    python scripts/publish_analysis.py analyses/us-hr904.json [--dry-run]
"""

import argparse
import json
import os
import sys

from supabase import create_client


def main():
    parser = argparse.ArgumentParser(description="Upload an analysis artifact to Supabase")
    parser.add_argument("artifact", help="Path to the analysis JSON")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print without writing")
    args = parser.parse_args()

    with open(args.artifact) as f:
        artifact = json.load(f)

    impacts = artifact.get("reform_impacts")
    if not impacts or "id" not in impacts:
        print("Error: artifact must contain reform_impacts with an id")
        return 1

    research = artifact.get("research")
    if research and research.get("id") != impacts["id"]:
        print(f"Error: research id {research.get('id')!r} != reform_impacts id {impacts['id']!r}")
        return 1
    if research and research.get("status") == "published":
        # 'published' is reserved for the publish-bill workflow on PR merge.
        print("Error: research.status may not be 'published' at upload time; use 'in_review'")
        return 1

    print(f"Artifact: {args.artifact}")
    print(f"Reform:   {impacts['id']}")
    print(f"Research row: {'yes' if research else 'no'}")
    if args.dry_run:
        print("Dry run — nothing written.")
        return 0

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_KEY required")
        return 1
    supabase = create_client(url, key)

    if research:
        supabase.table("research").upsert(research).execute()
        print(f"Upserted research row {research['id']} (status={research.get('status')})")

    supabase.table("reform_impacts").upsert(impacts).execute()
    print(f"Upserted reform_impacts row {impacts['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
