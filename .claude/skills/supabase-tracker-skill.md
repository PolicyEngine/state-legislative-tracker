# Supabase Tracker Skill

Knowledge about the state-research-tracker Supabase database schema.

## Database Connection

- **Project**: `ffgngqlgfsvqartilful`
- **URL**: `https://ffgngqlgfsvqartilful.supabase.co`
- **Credentials**: Stored in `.env` file (SUPABASE_KEY)

## Tables

### `research` Table

Primary table for research/analysis metadata.

```sql
CREATE TABLE research (
  id TEXT PRIMARY KEY,                    -- e.g., "ut-sb60", "sc-h3492"
  legiscan_bill_id INTEGER,               -- FK to processed_bills (optional)
  state TEXT NOT NULL,                    -- Two-letter state code: "UT", "SC"
  type TEXT NOT NULL,                     -- "blog", "dashboard", "tool"
  status TEXT NOT NULL,                   -- "published", "in_progress", "planned"
  title TEXT NOT NULL,                    -- Human-readable title
  url TEXT,                               -- Link to published analysis
  description TEXT,                       -- Brief description
  date DATE,                              -- Publication date
  author TEXT,                            -- Author name(s)
  key_findings TEXT[],                    -- Array of key findings
  tags TEXT[],                            -- Array of tags for filtering
  relevant_states TEXT[],                 -- For federal tools that affect specific states
  federal_tool_order INTEGER,             -- Display order for federal tools
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**ID Convention**: `{state-lowercase}-{bill-number-lowercase}`
- Examples: `ut-sb60`, `sc-h3492`, `ok-hb2229`, `ny-wftc`

### `reform_impacts` Table

Pre-computed PolicyEngine impact results.

```sql
CREATE TABLE reform_impacts (
  id TEXT PRIMARY KEY REFERENCES research(id),
  policy_id INTEGER,                      -- PolicyEngine policy ID
  computed BOOLEAN DEFAULT false,
  computed_at TIMESTAMPTZ,
  policyengine_us_version TEXT,           -- e.g., "1.250.0"
  dataset_name TEXT,                      -- e.g., "enhanced_cps_2024"
  dataset_version TEXT,                   -- Dataset version used
  budgetary_impact JSONB,                 -- See structure below
  poverty_impact JSONB,
  child_poverty_impact JSONB,
  winners_losers JSONB,
  decile_impact JSONB,
  inequality JSONB,
  district_impacts JSONB
);
```

**JSONB Structures**:

```json
// budgetary_impact
{
  "netCost": -68584763.34,        // Negative = costs state money
  "households": 1058819.89,
  "stateRevenueImpact": -69871183.91
}

// poverty_impact / child_poverty_impact
{
  "change": -0.00057,             // Negative = poverty reduction
  "reformRate": 0.1534,
  "baselineRate": 0.1540,
  "percentChange": -0.372
}

// winners_losers
{
  "noChange": 0.5545,
  "gainLess5Pct": 0.4454,
  "gainMore5Pct": 0.0,
  "loseLess5Pct": 0.0,
  "loseMore5Pct": 0.0
}

// decile_impact
{
  "relative": {
    "1": 5.95,    // Bottom decile avg benefit in $
    "2": 14.70,
    ...
    "10": 429.92  // Top decile
  }
}

// district_impacts
{
  "UT-1": {
    "avgBenefit": 68.0,
    "districtName": "Congressional District 1",
    "totalBenefit": 18166908.0,
    "winnersShare": 0.46,
    "povertyChange": 0.0,
    "householdsAffected": 268102.0
  },
  "UT-2": { ... }
}
```

### `validation_metadata` Table

External validation sources for transparency.

```sql
CREATE TABLE validation_metadata (
  id TEXT PRIMARY KEY REFERENCES research(id),
  fiscal_note_source TEXT,                -- URL to official fiscal note
  fiscal_note_estimate NUMERIC,           -- Official estimate in dollars
  pe_estimate NUMERIC,                    -- Our PolicyEngine estimate
  difference_from_fiscal_note_pct NUMERIC,
  within_range BOOLEAN,                   -- Is PE within acceptable range?
  external_analyses JSONB,                -- Array of external sources
  iteration_log JSONB,                    -- Log of validation iterations
  validated_at TIMESTAMPTZ,
  validated_by TEXT
);
```

**external_analyses structure**:
```json
[
  {
    "source": "Tax Foundation",
    "url": "https://...",
    "estimate": -50000000,
    "notes": "Assumes full behavioral response"
  }
]
```

## Writing to Database

Use the Supabase Python client:

```python
from supabase import create_client
import os

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_KEY"]
)

# Insert research item
supabase.table("research").upsert({
    "id": "ut-sb60",
    "state": "UT",
    "type": "blog",
    "status": "published",
    "title": "Utah SB60 Analysis",
    ...
}).execute()

# Insert reform impacts
supabase.table("reform_impacts").upsert({
    "id": "ut-sb60",
    "policy_id": 95604,
    "computed": True,
    "budgetary_impact": {...},
    ...
}).execute()
```

## Syncing to App

After writing to database, run:
```bash
make sync
```

This pulls data to `src/data/research.json` and `src/data/reformImpacts.json`.
