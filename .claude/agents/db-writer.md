# Database Writer Agent

Writes analysis results to Supabase.

## Purpose

Given computed impacts and metadata, this agent:
1. Writes to the `research` table
2. Writes to the `reform_impacts` table
3. Writes to the `validation_metadata` table
4. Runs sync to update local JSON files

## Inputs

- `bill_info`: Bill metadata from bill-researcher
- `impacts`: Computed impacts from impact-calculator
- `validation`: Fiscal note comparison from fiscal-finder
- `reform`: Reform JSON from param-mapper

## Process

### Step 1: Prepare Research Record

```python
research_record = {
    "id": f"{state.lower()}-{bill_number.lower()}",  # e.g., "ut-sb60"
    "state": state,
    "type": "blog",  # or "dashboard", "tool"
    "status": "published",  # or "in_progress", "planned"
    "title": f"{state} {bill_number}: {short_title}",
    "url": None,  # Set when blog post is published
    "description": bill_summary,
    "date": datetime.now().strftime("%Y-%m-%d"),
    "author": "PolicyEngine",
    "key_findings": [
        f"Costs state ${abs(net_cost)/1e6:.1f}M annually",
        f"{winners_pct:.1f}% of residents benefit",
        # ... more findings
    ],
    "tags": determine_tags(bill_info),  # ["income-tax", "tax-cuts", etc.]
}
```

### Step 2: Prepare Impact Record

```python
impact_record = {
    "id": research_record["id"],
    "policy_id": policy_id,
    "computed": True,
    "computed_at": datetime.utcnow().isoformat() + "Z",
    "policyengine_us_version": get_pe_version(),
    "dataset_name": "enhanced_cps_2024",
    "dataset_version": "1.0.0",
    "budgetary_impact": impacts["budgetary_impact"],
    "poverty_impact": impacts["poverty_impact"],
    "child_poverty_impact": impacts["child_poverty_impact"],
    "winners_losers": impacts["winners_losers"],
    "decile_impact": impacts["decile_impact"],
    "inequality": impacts["inequality"],
    "district_impacts": impacts["district_impacts"],
}
```

### Step 3: Prepare Validation Record

```python
validation_record = {
    "id": research_record["id"],
    "fiscal_note_source": validation["fiscal_note"]["url"],
    "fiscal_note_estimate": validation["fiscal_note"]["estimate"],
    "pe_estimate": impacts["budgetary_impact"]["stateRevenueImpact"],
    "difference_from_fiscal_note_pct": calculate_difference_pct(),
    "within_range": abs(difference_pct) < 25,
    "external_analyses": validation["external_analyses"],
    "iteration_log": [
        {
            "timestamp": datetime.utcnow().isoformat(),
            "action": "initial_computation",
            "pe_estimate": pe_estimate,
            "fiscal_note": fiscal_note_estimate,
            "difference_pct": difference_pct
        }
    ],
    "validated_at": datetime.utcnow().isoformat() + "Z",
    "validated_by": "encode-policy-agent"
}
```

### Step 4: Write to Supabase

```python
from supabase import create_client
import os

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_KEY"]
)

# Upsert research (insert or update)
supabase.table("research").upsert(research_record).execute()

# Upsert impacts
supabase.table("reform_impacts").upsert(impact_record).execute()

# Upsert validation
supabase.table("validation_metadata").upsert(validation_record).execute()
```

### Step 5: Update states.js (Optional)

If the bill should have an interactive analyzer, add to `src/data/states.js`:

```javascript
{
  bill: "SB60",
  status: "Proposed",
  description: "Cut income tax rate from 4.5% to 4.45%",
  url: "https://le.utah.gov/~2026/bills/static/SB60.html",
  reformConfig: {
    id: "ut-sb60",  // Must match database ID
    label: "Utah SB60 Rate Cut",
    description: "Reduces flat income tax rate",
    reform: {
      "gov.states.ut.tax.income.rate": { "2026": 0.0445 }
    }
  }
}
```

### Step 6: Sync Local Files

```bash
make sync
```

This updates:
- `src/data/research.json`
- `src/data/reformImpacts.json`

## Output Format

```json
{
  "success": true,
  "records_written": {
    "research": "ut-sb60",
    "reform_impacts": "ut-sb60",
    "validation_metadata": "ut-sb60"
  },
  "sync_status": "completed",
  "next_steps": [
    "Review at https://supabase.com/dashboard/project/ffgngqlgfsvqartilful",
    "Run 'make sync' to update local files",
    "Add reformConfig to states.js for interactive analyzer",
    "Commit and push changes"
  ]
}
```

## Tag Determination

```python
def determine_tags(bill_info):
    tags = []

    # Tax type tags
    if "income tax" in bill_info["description"].lower():
        tags.append("income-tax")
    if "rate" in bill_info["description"].lower() and "cut" in bill_info["description"].lower():
        tags.append("tax-cuts")
    if "flat" in bill_info["description"].lower():
        tags.append("flat-tax")

    # Credit tags
    if "eitc" in bill_info["description"].lower() or "earned income" in bill_info["description"].lower():
        tags.append("eitc")
    if "ctc" in bill_info["description"].lower() or "child tax credit" in bill_info["description"].lower():
        tags.append("ctc")

    return tags
```

## Tools Available

- `Bash`: Run Python scripts, make sync
- `Edit`: Update states.js
- `Skill` (supabase-tracker-skill): Database schema knowledge

## Tips

- Always use upsert to handle re-runs gracefully
- Check that research ID matches across all three tables
- Run sync after writing to keep local files in sync
- The states.js update is manual - consider automating later
