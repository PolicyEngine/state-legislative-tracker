# Supabase Migration & Automation Plan

## Overview

This document outlines the migration from static JSON/JS data files to a Supabase database, enabling automated bill tracking, impact computation, and staleness detection.

---

## Table of Contents

1. [Current State](#current-state)
2. [Database Schema](#database-schema)
3. [Complete Pipeline Flow](#complete-pipeline-flow)
4. [Bill Encoder Agent](#bill-encoder-agent)
5. [Scripts & Automation](#scripts--automation)
6. [Implementation Checklist](#implementation-checklist)
7. [Useful Queries](#useful-queries)
8. [Open Questions](#open-questions)

---

## Current State

### Existing Data Files

| File | Purpose |
|------|---------|
| `src/data/research.js` | Metadata about bills/research items (title, author, tags, URL) |
| `src/data/reformImpacts.json` | Pre-calculated PolicyEngine impacts (revenue, poverty, deciles) |

### Existing Supabase Infrastructure

Project: `ffgngqlgfsvqartilful`

**`processed_bills` table** (from LegiScan monitor - PR #20):
```sql
bill_id           INTEGER PRIMARY KEY
state             TEXT
bill_number       TEXT
title             TEXT
description       TEXT
status            TEXT
status_date       DATE
last_action       TEXT
last_action_date  DATE
official_url      TEXT
session_name      TEXT
github_issue_url  TEXT
matched_query     TEXT
legiscan_url      TEXT
skipped_reason    TEXT
```

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────────────┐
│   processed_bills   │  <--- LegiScan monitor writes here
├─────────────────────┤
│ bill_id (PK)        │
│ state               │
│ bill_number         │
│ title               │
│ status              │
│ github_issue_url    │
│ matched_query       │
│ skipped_reason      │
└─────────┬───────────┘
          │
          │ FK (optional)
          ▼
┌─────────────────────┐
│     research        │  <--- Bill encoder agent writes here
├─────────────────────┤
│ id (PK)             │──────────────────────────────────┐
│ legiscan_bill_id    │                                  │
│ state               │                                  │
│ type                │                                  │
│ status              │                                  │
│ title               │                                  │
│ url                 │                                  │
│ author              │                                  │
│ tags[]              │                                  │
│ key_findings[]      │                                  │
└─────────────────────┘                                  │
                                                         │
          ┌──────────────────────────────────────────────┤
          │                                              │
          ▼                                              ▼
┌─────────────────────┐                    ┌─────────────────────────┐
│   reform_impacts    │                    │  validation_metadata    │
├─────────────────────┤                    ├─────────────────────────┤
│ id (PK, FK)         │                    │ id (PK, FK)             │
│ policy_id           │                    │ fiscal_note_source      │
│ computed_at         │                    │ fiscal_note_estimate    │
│ policyengine_us_ver │                    │ external_analyses[]     │
│ dataset_name        │                    │ envelope_estimate       │
│ dataset_version     │                    │ target_range_low/high   │
│ budgetary_impact    │                    │ pe_estimate             │
│ poverty_impact      │                    │ within_range            │
│ winners_losers      │                    │ discrepancy_explanation │
│ decile_impact       │                    │ iterations              │
│ district_impacts    │                    │ iteration_log[]         │
└─────────────────────┘                    └─────────────────────────┘
```

### New Tables SQL

```sql
-- Research items (blog posts, dashboards, tools, analyses)
CREATE TABLE research (
  id                  TEXT PRIMARY KEY,        -- "ut-sb60", "la-flat-tax"
  legiscan_bill_id    INTEGER REFERENCES processed_bills(bill_id),
  state               TEXT NOT NULL,
  type                TEXT NOT NULL,           -- "blog", "dashboard", "tool"
  status              TEXT NOT NULL,           -- "published", "in_progress", "planned"
  title               TEXT NOT NULL,
  url                 TEXT,
  description         TEXT,
  date                DATE,
  author              TEXT,
  key_findings        TEXT[],
  tags                TEXT[],
  relevant_states     TEXT[],                  -- for federal tools
  federal_tool_order  INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Computed impacts for research items
CREATE TABLE reform_impacts (
  id                      TEXT PRIMARY KEY REFERENCES research(id),
  policy_id               INTEGER,             -- PolicyEngine API policy ID
  computed                BOOLEAN DEFAULT false,
  computed_at             TIMESTAMPTZ,

  -- Version tracking for reproducibility
  policyengine_us_version TEXT,
  dataset_name            TEXT,                -- "enhanced_cps_2024"
  dataset_version         TEXT,

  -- Impact data as JSONB
  budgetary_impact        JSONB,
  poverty_impact          JSONB,
  child_poverty_impact    JSONB,
  winners_losers          JSONB,
  decile_impact           JSONB,
  inequality              JSONB,
  district_impacts        JSONB
);

-- Validation metadata for transparency and audit
CREATE TABLE validation_metadata (
  id                              TEXT PRIMARY KEY REFERENCES research(id),

  -- Official fiscal note
  fiscal_note_source              TEXT,
  fiscal_note_url                 TEXT,
  fiscal_note_estimate            NUMERIC,
  fiscal_note_methodology         TEXT,

  -- External analyses (think tanks, news)
  external_analyses               JSONB,      -- Array of {source, estimate, url}

  -- Similar bills we've analyzed
  similar_bills                   JSONB,      -- Array of {id, estimate, description}

  -- Back-of-envelope calculation
  envelope_estimate               NUMERIC,
  envelope_methodology            TEXT,
  envelope_assumptions            TEXT[],

  -- Validation results
  target_range_low                NUMERIC,
  target_range_high               NUMERIC,
  pe_estimate                     NUMERIC,
  within_range                    BOOLEAN,
  difference_from_fiscal_note_pct NUMERIC,
  discrepancy_explanation         TEXT,

  -- Iteration tracking
  iterations                      INTEGER DEFAULT 1,
  iteration_log                   JSONB       -- Array of {attempt, issue, resolution}
);

-- Indexes for common queries
CREATE INDEX idx_research_state ON research(state);
CREATE INDEX idx_research_status ON research(status);
CREATE INDEX idx_reform_impacts_version ON reform_impacts(policyengine_us_version);

-- Row Level Security (public read access)
ALTER TABLE research ENABLE ROW LEVEL SECURITY;
ALTER TABLE reform_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read research" ON research FOR SELECT USING (true);
CREATE POLICY "Public read impacts" ON reform_impacts FOR SELECT USING (true);
CREATE POLICY "Public read validation" ON validation_metadata FOR SELECT USING (true);
```

### JSONB Structure Examples

**budgetary_impact:**
```json
{
  "netCost": -68584763.34,
  "stateRevenueImpact": -69871183.91,
  "households": 1058819.89
}
```

**poverty_impact / child_poverty_impact:**
```json
{
  "baselineRate": 0.154,
  "reformRate": 0.153,
  "change": -0.001,
  "percentChange": -0.37
}
```

**winners_losers:**
```json
{
  "gainMore5Pct": 0.0,
  "gainLess5Pct": 0.445,
  "loseLess5Pct": 0.0,
  "loseMore5Pct": 0.0,
  "noChange": 0.555
}
```

**decile_impact:**
```json
{
  "relative": {
    "1": 5.95, "2": 14.70, "3": 23.58, "4": 29.75, "5": 35.54,
    "6": 44.69, "7": 54.23, "8": 64.21, "9": 94.75, "10": 429.92
  }
}
```

**district_impacts:**
```json
{
  "UT-1": {
    "districtName": "Congressional District 1",
    "avgBenefit": 68.0,
    "householdsAffected": 268102.0,
    "totalBenefit": 18166908.0,
    "povertyChange": 0.0,
    "winnersShare": 0.46
  }
}
```

**external_analyses (in validation_metadata):**
```json
[
  { "source": "Tax Foundation", "estimate": -80000000, "url": "https://..." },
  { "source": "Deseret News", "estimate": -85000000, "url": "https://..." }
]
```

**iteration_log (in validation_metadata):**
```json
[
  { "attempt": 1, "pe_estimate": -45000000, "issue": "Missing bracket change", "resolution": "Added second rate parameter" },
  { "attempt": 2, "pe_estimate": -69800000, "issue": null, "resolution": "Within target range" }
]
```

---

## Complete Pipeline Flow

### End-to-End Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE BILL ANALYSIS FLOW                         │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   DISCOVERY     │
                              │   (Automated)   │
                              └────────┬────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
┌───────────────┐            ┌───────────────┐            ┌───────────────┐
│  LegiScan     │            │  Manual       │            │  News/Tips    │
│  Monitor      │            │  Discovery    │            │  (human)      │
│  (scheduled)  │            │  (human)      │            │               │
└───────┬───────┘            └───────┬───────┘            └───────┬───────┘
        │                            │                            │
        └──────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────┐
                    │        SUPABASE                 │
                    │     processed_bills             │
                    │  ┌───────────────────────────┐  │
                    │  │ bill_id: 12345            │  │
                    │  │ state: UT                 │  │
                    │  │ bill_number: SB60         │  │
                    │  │ title: Income Tax...      │  │
                    │  │ status: Passed Committee  │  │
                    │  │ github_issue_url: #123    │  │
                    │  └───────────────────────────┘  │
                    └─────────────────┬───────────────┘
                                      │
                                      ▼
                              ┌───────────────┐
                              │   TRIAGE      │
                              │   (Human)     │
                              └───────┬───────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
            ┌─────────────┐                     ┌─────────────┐
            │  Skip       │                     │  Analyze    │
            │  (not       │                     │  (priority) │
            │  priority)  │                     │             │
            └─────────────┘                     └──────┬──────┘
                                                       │
══════════════════════════════════════════════════════════════════════════════
                              BILL ENCODER AGENT
══════════════════════════════════════════════════════════════════════════════
                                                       │
                                                       ▼
                              ┌─────────────────────────────────────┐
                              │  STEP 1: INTAKE                     │
                              │  • Fetch bill from processed_bills  │
                              │  • Get bill text from LegiScan      │
                              └─────────────────┬───────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  STEP 2: EXTERNAL RESEARCH          │
                              │  • Find official fiscal note        │
                              │  • Search think tank analyses       │
                              │  • Find similar bills we've done    │
                              │  • Back-of-envelope calculation     │
                              └─────────────────┬───────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  STEP 3: SET VALIDATION TARGETS     │
                              │  • Compile external estimates       │
                              │  • Define acceptable range          │
                              │  • Flag expected patterns           │
                              └─────────────────┬───────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  STEP 4: ANALYZE PROVISIONS         │
                              │  • Extract policy changes           │
                              │  • Identify numeric changes         │
                              │  • Note effective dates             │
                              └─────────────────┬───────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  STEP 5: MAP TO POLICYENGINE        │
                              │  • Find matching parameters         │
                              │  • Check parameter metadata         │
                              │  • Generate reform JSON             │
                              └─────────────────┬───────────────────┘
                                                │
                                                ▼
                         ┌──────────────────────────────────────────┐
                         │  STEP 6: ITERATIVE VALIDATION LOOP       │
                         │  ┌────────────────────────────────────┐  │
                         │  │                                    │  │
                         │  │  Compute ──▶ Compare ──▶ In range? │  │
                         │  │     ▲                       │      │  │
                         │  │     │         No            ▼      │  │
                         │  │     └──── Diagnose & Adjust ◀──────│  │
                         │  │                                    │  │
                         │  └────────────────────────────────────┘  │
                         └──────────────────────┬───────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  STEP 7: HUMAN REVIEW               │
                              │  • Present all findings             │
                              │  • Show PE vs external estimates    │
                              │  • Explain any discrepancies        │
                              │                                     │
                              │  [Approve] [Adjust] [Reject]        │
                              └─────────────────┬───────────────────┘
                                                │
══════════════════════════════════════════════════════════════════════════════
                                                │
                                                ▼
                    ┌─────────────────────────────────────────────┐
                    │              SUPABASE                       │
                    │  ┌─────────────────────────────────────┐    │
                    │  │ research                            │    │
                    │  │  id: ut-sb60                        │    │
                    │  │  legiscan_bill_id: 12345            │    │
                    │  │  state: UT                          │    │
                    │  │  status: in_progress                │    │
                    │  │  title: Utah SB60...                │    │
                    │  └─────────────────────────────────────┘    │
                    │                    │                        │
                    │                    ▼                        │
                    │  ┌─────────────────────────────────────┐    │
                    │  │ reform_impacts                      │    │
                    │  │  id: ut-sb60                        │    │
                    │  │  policy_id: 95604                   │    │
                    │  │  policyengine_us_version: 1.250.0   │    │
                    │  │  dataset_name: enhanced_cps_2024    │    │
                    │  │  dataset_version: 1.15.0            │    │
                    │  │  budgetary_impact: {...}            │    │
                    │  │  poverty_impact: {...}              │    │
                    │  │  ...                                │    │
                    │  └─────────────────────────────────────┘    │
                    │                    │                        │
                    │                    ▼                        │
                    │  ┌─────────────────────────────────────┐    │
                    │  │ validation_metadata                 │    │
                    │  │  id: ut-sb60                        │    │
                    │  │  fiscal_note_estimate: -83600000    │    │
                    │  │  pe_estimate: -69800000             │    │
                    │  │  within_range: true                 │    │
                    │  │  discrepancy_explanation: ...       │    │
                    │  └─────────────────────────────────────┘    │
                    └─────────────────────────────────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  PUBLICATION                        │
                              │  (Human + automation)               │
                              │                                     │
                              │  • Write blog post (human)          │
                              │  • Update research.status →         │
                              │    "published"                      │
                              │  • Add URL to research record       │
                              │  • App displays automatically       │
                              └─────────────────────────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────────────┐
                              │  STALENESS MONITORING               │
                              │  (Automated - scheduled)            │
                              │                                     │
                              │  • Check PE version vs computed     │
                              │  • Flag outdated computations       │
                              │  • Trigger recompute if needed      │
                              └─────────────────────────────────────┘
```

### Automation Levels by Step

| Step | Automation | Method |
|------|------------|--------|
| 1. Discover bills | Fully automated | LegiScan monitor (daily cron) |
| 2. Triage bills | Human decision | Review GitHub digest issues |
| 3. Research & validate | AI-assisted | Bill Encoder Agent |
| 4. Create PE policy | AI-assisted | Bill Encoder Agent |
| 5. Compute impacts | Fully automated | `compute_impacts.py` |
| 6. Store results | Fully automated | Scripts save to Supabase |
| 7. Write blog post | Human | Manual authoring |
| 8. Detect staleness | Fully automated | Scheduled version checks |
| 9. Recompute stale | Semi-automated | GitHub Action trigger |

---

## Bill Encoder Agent

### Purpose

Automate the translation of legislative bill text into PolicyEngine parameter changes, with external validation at every step.

### Detailed Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BILL ENCODER AGENT WORKFLOW                          │
└─────────────────────────────────────────────────────────────────────────────┘

Step 1: INTAKE
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: Bill ID (LegiScan) or Bill Number + State                           │
│  Output: Structured bill metadata                                           │
│                                                                             │
│  Actions:                                                                   │
│    - Query Supabase `processed_bills` table for existing bill info          │
│    - If not found, query LegiScan API directly                              │
│    - Extract: state, bill_number, title, description, session               │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 2: FETCH BILL TEXT
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: Bill metadata (state, bill_number, session)                         │
│  Output: Full bill text + fiscal note (if available)                        │
│                                                                             │
│  Actions:                                                                   │
│    - Fetch bill text from LegiScan or state legislature                     │
│    - Search for official fiscal note / fiscal impact statement              │
│    - Extract fiscal note estimates if found                                 │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
══════════════════════════════════════════════════════════════════════════════
                        RESEARCH & BENCHMARKING PHASE
══════════════════════════════════════════════════════════════════════════════
    │
    ▼
Step 3: EXTERNAL RESEARCH
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: Bill metadata + text                                                │
│  Output: External estimates & analyses to use as validation targets         │
│                                                                             │
│  3a. OFFICIAL FISCAL NOTE                                                   │
│      - Search state fiscal agency website                                   │
│      - Extract: revenue impact, affected taxpayers, effective date          │
│      - Note methodology if described                                        │
│                                                                             │
│  3b. THINK TANK / EXTERNAL ANALYSES                                         │
│      - Search for analyses from:                                            │
│        • Tax Foundation (state tax analyses)                                │
│        • ITEP (Institute on Taxation and Economic Policy)                   │
│        • CBPP (Center on Budget and Policy Priorities)                      │
│        • State-specific policy orgs (e.g., Utah Foundation)                 │
│        • News articles citing revenue estimates                             │
│      - Extract any published estimates                                      │
│                                                                             │
│  3c. SIMILAR BILL LOOKUP                                                    │
│      - Search for similar bills in other states we've already analyzed      │
│      - Query: "EITC match" bills, "flat tax" bills, etc.                    │
│      - Pull comparable results for sanity check                             │
│                                                                             │
│  Output structure:                                                          │
│    {                                                                        │
│      "fiscal_note": {                                                       │
│        "source": "Utah Legislative Fiscal Analyst",                         │
│        "url": "https://le.utah.gov/...",                                    │
│        "revenue_impact": -83600000,                                         │
│        "affected_taxpayers": "53% of filers",                               │
│        "methodology": "Static analysis"                                     │
│      },                                                                     │
│      "external_analyses": [                                                 │
│        { "source": "Tax Foundation", "estimate": -80000000 },               │
│        { "source": "Deseret News", "estimate": -85000000 }                  │
│      ],                                                                     │
│      "similar_bills": [                                                     │
│        { "id": "ut-2025-rate-cut", "our_estimate": -96000000,               │
│          "description": "Previous 0.05% rate cut" }                         │
│      ]                                                                      │
│    }                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 4: BACK-OF-ENVELOPE CALCULATION
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: Bill provisions + state tax data                                    │
│  Output: Quick estimate to validate against                                 │
│                                                                             │
│  Actions:                                                                   │
│    - Pull baseline state data:                                              │
│        • Total state income tax revenue (from Census/state data)            │
│        • Number of tax filers                                               │
│        • Average taxable income                                             │
│                                                                             │
│    - Calculate rough estimate:                                              │
│                                                                             │
│      Example: Rate cut 4.5% → 4.45%                                         │
│      ─────────────────────────────                                          │
│      Utah income tax revenue: ~$5.5B                                        │
│      Rate reduction: 0.05 / 4.5 = 1.1%                                      │
│      Rough impact: $5.5B × 1.1% = ~$60M                                     │
│                                                                             │
│      Example: $500 EITC match                                               │
│      ─────────────────────────────                                          │
│      EITC filers in state: ~200,000                                         │
│      Average match value: ~$400                                             │
│      Rough impact: 200K × $400 = ~$80M                                      │
│                                                                             │
│  Output:                                                                    │
│    {                                                                        │
│      "envelope_estimate": -60000000,                                        │
│      "methodology": "1.1% of $5.5B total revenue",                          │
│      "confidence_range": [-50000000, -70000000],                            │
│      "assumptions": ["static analysis", "no behavioral response"]           │
│    }                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 5: ESTABLISH VALIDATION TARGETS
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: All research + envelope calculation                                 │
│  Output: Target ranges our PE estimate should fall within                   │
│                                                                             │
│  Compile validation targets:                                                │
│    ┌────────────────────────────────────────────────────────────────────┐   │
│    │ Source                    │ Estimate      │ Weight │               │   │
│    ├────────────────────────────────────────────────────────────────────┤   │
│    │ Official fiscal note      │ -$83.6M       │ High   │               │   │
│    │ Tax Foundation            │ -$80M         │ Medium │               │   │
│    │ Back-of-envelope          │ -$60M         │ Low    │               │   │
│    │ Similar bill (2025)       │ -$96M (0.05%) │ Medium │               │   │
│    └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Acceptable range: -$50M to -$120M                                          │
│  Target (weighted): ~-$80M                                                  │
│                                                                             │
│  Flags:                                                                     │
│    ⚠ If PE estimate outside range → investigate                             │
│    ⚠ If PE estimate differs >50% from fiscal note → flag for review         │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
══════════════════════════════════════════════════════════════════════════════
                              ANALYSIS & ENCODING PHASE
══════════════════════════════════════════════════════════════════════════════
    │
    ▼
Step 6: ANALYZE PROVISIONS
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: Bill text                                                           │
│  Output: List of policy changes in plain language                           │
│                                                                             │
│  Actions:                                                                   │
│    - Identify what tax/benefit programs are affected                        │
│    - Extract specific numeric changes:                                      │
│        "rate reduced from 4.5% to 4.45%"                                    │
│        "credit increased to $500 per child"                                 │
│        "income threshold raised to $75,000"                                 │
│    - Identify effective dates                                               │
│    - Flag ambiguous provisions for human review                             │
│                                                                             │
│  Example output:                                                            │
│    [                                                                        │
│      { "type": "rate_change", "program": "state_income_tax",                │
│        "current": 0.045, "new": 0.0445, "effective": "2026-01-01" },        │
│      { "type": "uncertain", "text": "...subject to appropriation..." }      │
│    ]                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 7: MAP TO POLICYENGINE PARAMETERS
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: List of policy changes + state                                      │
│  Output: Matching PE parameter paths                                        │
│                                                                             │
│  Actions:                                                                   │
│    - Search policyengine-us parameter tree for state                        │
│    - Match provisions to parameters:                                        │
│        "state income tax rate" → gov.states.ut.tax.income.main.rate         │
│        "EITC match" → gov.states.ut.tax.income.credits.eitc.match           │
│        "standard deduction" → gov.states.ut.tax.income.deductions.standard  │
│    - Check parameter metadata (unit, period, valid range)                   │
│    - Flag if no matching parameter found (may need PE update)               │
│                                                                             │
│  Tools needed:                                                              │
│    - Grep/Glob policyengine-us repo for parameter definitions               │
│    - Read parameter YAML files for structure                                │
│    - Query PE API for current parameter values                              │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 8: GENERATE REFORM JSON
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: Parameter mappings + new values + effective dates                   │
│  Output: PolicyEngine reform JSON                                           │
│                                                                             │
│  Actions:                                                                   │
│    - Build reform object with correct structure                             │
│    - Apply date ranges (effective date to far future)                       │
│    - Handle units (percentages as decimals, currency as integers)           │
│                                                                             │
│  Example output:                                                            │
│    {                                                                        │
│      "gov.states.ut.tax.income.main.rate": {                                │
│        "2026-01-01.2100-12-31": 0.0445                                      │
│      }                                                                      │
│    }                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
══════════════════════════════════════════════════════════════════════════════
                           ITERATIVE VALIDATION LOOP
══════════════════════════════════════════════════════════════════════════════
    │
    ▼
Step 9: COMPUTE & VALIDATE (ITERATIVE)
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         VALIDATION LOOP                               │  │
│  │                                                                       │  │
│  │   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐       │  │
│  │   │ Compute  │───▶│ Compare  │───▶│ In range?│───▶│   Done   │       │  │
│  │   │ impacts  │    │ to targets│   │          │    │          │       │  │
│  │   └──────────┘    └──────────┘    └────┬─────┘    └──────────┘       │  │
│  │                                        │ No                           │  │
│  │                                        ▼                              │  │
│  │                                  ┌──────────┐                         │  │
│  │                                  │ Diagnose │                         │  │
│  │                                  │ & adjust │                         │  │
│  │                                  └────┬─────┘                         │  │
│  │                                       │                               │  │
│  │         ┌─────────────────────────────┼─────────────────────────┐    │  │
│  │         ▼                             ▼                         ▼    │  │
│  │   ┌──────────┐               ┌──────────────┐           ┌────────┐  │  │
│  │   │ Wrong    │               │ Missing      │           │ PE bug │  │  │
│  │   │ parameter│               │ provision    │           │ or gap │  │  │
│  │   └────┬─────┘               └──────┬───────┘           └───┬────┘  │  │
│  │        │                            │                       │       │  │
│  │        ▼                            ▼                       ▼       │  │
│  │   Fix mapping                 Add provision           Flag for     │  │
│  │   & retry                     & retry                 human        │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Validation checks:                                                         │
│    □ Revenue impact within target range?                                    │
│    □ Direction correct (cut vs increase)?                                   │
│    □ Affected population reasonable?                                        │
│    □ Distributional pattern makes sense?                                    │
│                                                                             │
│  Diagnostic questions if out of range:                                      │
│    • Is fiscal note using different year/baseline?                          │
│    • Are we missing a provision (e.g., phase-in)?                           │
│    • Is parameter mapping wrong?                                            │
│    • Is there a PE modeling gap?                                            │
│    • Is fiscal note using dynamic scoring?                                  │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 10: DOCUMENT DISCREPANCIES
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Input: PE estimate vs external estimates                                   │
│  Output: Documented comparison for transparency                             │
│                                                                             │
│  Record:                                                                    │
│    {                                                                        │
│      "pe_estimate": -69800000,                                              │
│      "fiscal_note": -83600000,                                              │
│      "difference_pct": -16.5,                                               │
│      "explanation": "Fiscal note uses 2025 baseline; PE uses 2026",         │
│      "within_acceptable_range": true                                        │
│    }                                                                        │
│                                                                             │
│  This goes into the validation_metadata table for transparency              │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 11: HUMAN REVIEW CHECKPOINT
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Present to human:                                                          │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ BILL: UT SB60 - Income Tax Rate Reduction                          │     │
│  ├────────────────────────────────────────────────────────────────────┤     │
│  │                                                                     │     │
│  │ EXTERNAL RESEARCH                                                   │     │
│  │ ─────────────────                                                   │     │
│  │ • Fiscal Note: -$83.6M (Utah LFA)                                   │     │
│  │ • Tax Foundation: -$80M                                             │     │
│  │ • Back-of-envelope: -$60M (1.1% of $5.5B)                           │     │
│  │                                                                     │     │
│  │ POLICYENGINE ESTIMATE                                               │     │
│  │ ─────────────────────                                               │     │
│  │ • Revenue impact: -$69.8M                                           │     │
│  │ • Poverty reduction: 0.04%                                          │     │
│  │ • Households affected: 53%                                          │     │
│  │                                                                     │     │
│  │ VALIDATION                                                          │     │
│  │ ──────────                                                          │     │
│  │ ✓ Within acceptable range (-$50M to -$120M)                         │     │
│  │ ✓ Direction correct (tax cut → revenue decrease)                    │     │
│  │ ⚠ 16% below fiscal note - likely baseline year difference           │     │
│  │                                                                     │     │
│  │ REFORM                                                              │     │
│  │ ──────                                                              │     │
│  │ gov.states.ut.tax.income.main.rate: 0.045 → 0.0445                  │     │
│  │ Confidence: HIGH                                                    │     │
│  │                                                                     │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  [Approve] [Adjust] [Research More] [Reject]                                │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Step 12: SAVE TO DATABASE
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Save all artifacts:                                                        │
│    - research table: bill metadata                                          │
│    - reform_impacts table: PE results + version info                        │
│    - validation_metadata table: external sources, comparisons, discrepancies│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Confidence Scoring

The agent assigns confidence to each provision:

| Confidence | Meaning | Example |
|------------|---------|---------|
| **High (0.9+)** | Explicit numeric change | "rate shall be 4.45%" |
| **Medium (0.7-0.9)** | Clear intent, minor interpretation | "increased by $100" (from what?) |
| **Low (0.5-0.7)** | Requires interpretation | "adjusted for inflation" |
| **Flag for human** | Cannot determine | "as determined by the commissioner" |

### Data Sources for Research Step

| Source Type | Examples | How to Access |
|-------------|----------|---------------|
| **Official Fiscal Notes** | State LFA, legislative budget office | State legislature websites, LegiScan documents |
| **Think Tanks** | Tax Foundation, ITEP, CBPP | Web search, their state pages |
| **State-specific orgs** | Utah Foundation, Empire Center (NY) | Web search |
| **News coverage** | Local papers, tax reporters | Web search |
| **Our prior analyses** | Previous PE blog posts | Supabase `research` table |
| **Baseline data** | State tax revenue, filer counts | Census, state revenue reports |

### Knowledge Base Required

The agent needs access to:

```
1. Parameter mapping templates
   ┌─────────────────────────────────────────────────┐
   │ "income tax rate"     → gov.states.{st}.tax...  │
   │ "EITC"                → ...credits.eitc...      │
   │ "standard deduction"  → ...deductions.standard  │
   │ "child tax credit"    → ...credits.ctc...       │
   └─────────────────────────────────────────────────┘

2. State-specific parameter paths
   ┌─────────────────────────────────────────────────┐
   │ Utah:  gov.states.ut.tax.income.main.rate       │
   │ SC:    gov.states.sc.tax.income.rates.rate      │
   │ (varies by state!)                              │
   └─────────────────────────────────────────────────┘

3. Common bill patterns
   ┌─────────────────────────────────────────────────┐
   │ "Flat tax" bill     → single rate parameter     │
   │ "EITC match" bill   → match percentage param    │
   │ "Bracket" bill      → multiple rate + threshold │
   └─────────────────────────────────────────────────┘
```

---

## Scripts & Automation

### Script Summary

| Script | Trigger | Function |
|--------|---------|----------|
| `legiscan_monitor.py` | Scheduled (daily) | Discover new bills → `processed_bills` |
| `encode_bill.py` | Manual / agent | Run bill encoder agent |
| `compute_impacts.py` | Manual / GH Action | Run PE simulation → `reform_impacts` |
| `create_research.py` | Manual / agent | Create research item from bill |
| `check_staleness.py` | Scheduled (weekly) | Find outdated computations |
| `migrate_to_supabase.py` | One-time | Migrate existing JSON/JS data |
| `sync_to_app.py` | Optional | Export Supabase → static JSON |

### `scripts/compute_impacts.py`

Core computation engine:
- Fetches research item from Supabase
- Runs PolicyEngine microsimulation
- Captures version info (policyengine-us, dataset)
- Saves results back to Supabase

```bash
python scripts/compute_impacts.py --research-id ut-sb60
python scripts/compute_impacts.py --all-pending
python scripts/compute_impacts.py --recompute-stale 1.200.0
```

### `scripts/create_research.py`

Creates research items from LegiScan bills or manually:

```bash
# From LegiScan bill
python scripts/create_research.py --from-legiscan 12345 --policy-id 95604

# Manual entry
python scripts/create_research.py \
    --id ut-sb60 \
    --state UT \
    --title "Utah SB60" \
    --policy-id 95604
```

### GitHub Actions Workflow

```yaml
# .github/workflows/compute-impacts.yml
name: Compute Reform Impacts

on:
  workflow_dispatch:
    inputs:
      research_id:
        description: 'Research ID to compute (or "all-pending" or "stale")'
        required: true

  schedule:
    - cron: '0 0 * * 0'  # Sundays at midnight

jobs:
  compute:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install policyengine-us policyengine-us-data supabase

      - name: Compute impacts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
        run: |
          if [ "${{ inputs.research_id }}" = "all-pending" ]; then
            python scripts/compute_impacts.py --all-pending
          elif [ "${{ inputs.research_id }}" = "stale" ]; then
            python scripts/compute_impacts.py --recompute-stale 1.200.0
          else
            python scripts/compute_impacts.py --research-id ${{ inputs.research_id }}
          fi
```

---

## Typical Workflow Example

```
Day 1: LegiScan finds UT-SB60
       → Saves to processed_bills
       → Creates GitHub digest issue #123

Day 2: Human reviews issue, decides to analyze

       $ claude "encode bill UT-SB60"

       Agent executes:
       ├── Step 1: Fetches bill from processed_bills
       ├── Step 2: Gets bill text from le.utah.gov
       ├── Step 3: External research
       │   ├── Finds fiscal note: -$83.6M (Utah LFA)
       │   ├── Finds Tax Foundation analysis: -$80M
       │   └── Back-of-envelope: -$60M (1.1% of $5.5B)
       ├── Step 4: Sets target range: -$50M to -$120M
       ├── Step 5: Extracts provision: rate 4.5% → 4.45%
       ├── Step 6: Maps to: gov.states.ut.tax.income.main.rate
       ├── Step 7: Generates reform JSON
       ├── Step 8: Computes: -$69.8M
       ├── Step 9: Validates: ✓ Within range
       └── Step 10: Presents for human review

       Human: [Approve]

       Agent saves to Supabase:
       ├── research (id: ut-sb60, status: in_progress)
       ├── reform_impacts (policy_id: 95604, version info, impacts)
       └── validation_metadata (fiscal note, comparisons, discrepancies)

Day 3: Human writes blog post
       → Updates research.status → "published"
       → Adds URL to research record
       → App automatically displays new analysis

Day 30: Staleness check runs (scheduled)
        → Finds policyengine-us updated to 1.260.0
        → ut-sb60 computed with 1.250.0
        → GitHub Action triggers recompute
        → validation_metadata updated with new comparison
```

---

## Implementation Checklist

### Phase 1: Database Setup [COMPLETE]
- [x] Create `research` table in Supabase
- [x] Create `reform_impacts` table in Supabase
- [x] Create `validation_metadata` table in Supabase
- [x] Set up RLS policies (public read via anon key)
- [x] Create indexes
- [x] Create views (`stale_computations`, `pending_analysis`, `research_with_status`)

### Phase 2: Data Migration [COMPLETE]
- [x] Write `migrate_to_supabase.py` script
- [x] Migrate `research.js` data (28 items)
- [x] Migrate `reformImpacts.json` data (4 items: ut-sb60, ut-hb210, sc-h3492, ok-hb2229)
- [x] Validate migrated data

### Phase 2.5: Build-Time Sync [COMPLETE]
- [x] Write `sync_from_supabase.py` script
- [x] Update `research.js` to import from synced JSON
- [x] Create Makefile with `sync` and `build` targets
- [x] Keep API keys private (not exposed in client bundle)

### Phase 3: Computation Pipeline
- [ ] Write `compute_impacts.py` script
- [ ] Write `create_research.py` script
- [ ] Add version tracking to computations
- [ ] Test end-to-end flow

### Phase 4: GitHub Actions
- [ ] Create workflow for manual computation trigger
- [ ] Create scheduled workflow for staleness recompute
- [ ] Add secrets (SUPABASE_URL, SUPABASE_KEY)

### Phase 5: App Integration [COMPLETE - Build-Time Approach]
Instead of client-side queries, we use build-time sync:
- [x] `make sync` pulls data from Supabase to static JSON
- [x] `make build` runs sync then builds the app
- [x] No API keys exposed in the client bundle
- [x] App works offline after build

### Phase 6: Bill Encoder Agents [COMPLETE]
- [x] Define orchestrator agent (`.claude/agents/encode-policy.md`)
- [x] Define bill-researcher agent (`.claude/agents/bill-researcher.md`)
- [x] Define fiscal-finder agent (`.claude/agents/fiscal-finder.md`)
- [x] Define param-mapper agent (`.claude/agents/param-mapper.md`)
- [x] Define impact-calculator agent (`.claude/agents/impact-calculator.md`)
- [x] Define db-writer agent (`.claude/agents/db-writer.md`)
- [x] Create supabase-tracker-skill for DB schema knowledge
- [x] Create `/encode-bill` command to invoke workflow
- [x] Add 2 human checkpoints (mapping review, results review)

---

## Useful Queries

### Find stale computations
```sql
SELECT r.id, r.title, ri.policyengine_us_version, ri.computed_at
FROM research r
JOIN reform_impacts ri ON r.id = ri.id
WHERE ri.policyengine_us_version < '1.250.0'
ORDER BY ri.computed_at;
```

### Research items without computed impacts
```sql
SELECT r.id, r.title, r.state
FROM research r
LEFT JOIN reform_impacts ri ON r.id = ri.id
WHERE ri.computed IS NULL OR ri.computed = false;
```

### Bills discovered but not yet analyzed
```sql
SELECT pb.bill_id, pb.state, pb.bill_number, pb.title
FROM processed_bills pb
LEFT JOIN research r ON pb.bill_id = r.legiscan_bill_id
WHERE r.id IS NULL
  AND pb.skipped_reason IS NULL
ORDER BY pb.state, pb.bill_number;
```

### Impact summary by state
```sql
SELECT
  r.state,
  COUNT(*) as bill_count,
  SUM((ri.budgetary_impact->>'netCost')::numeric) as total_revenue_impact
FROM research r
JOIN reform_impacts ri ON r.id = ri.id
WHERE ri.computed = true
GROUP BY r.state
ORDER BY total_revenue_impact;
```

### Validation accuracy check
```sql
SELECT
  r.id,
  r.title,
  vm.fiscal_note_estimate,
  vm.pe_estimate,
  vm.difference_from_fiscal_note_pct,
  vm.within_range
FROM research r
JOIN validation_metadata vm ON r.id = vm.id
WHERE vm.fiscal_note_estimate IS NOT NULL
ORDER BY ABS(vm.difference_from_fiscal_note_pct) DESC;
```

### Bills requiring multiple iterations
```sql
SELECT
  r.id,
  r.title,
  vm.iterations,
  vm.iteration_log
FROM research r
JOIN validation_metadata vm ON r.id = vm.id
WHERE vm.iterations > 1
ORDER BY vm.iterations DESC;
```

---

## Open Questions

1. **Live queries vs static build?** - Should the React app query Supabase directly or use exported JSON?
2. **Agent autonomy level?** - Should the bill encoder create policies automatically or always require human approval?
3. **Historical versions?** - Should we keep history of computations or just the latest?
4. **Multi-state bills?** - How to handle federal bills that affect multiple states?
5. **Fiscal note disagreements?** - What's the acceptable threshold for PE vs fiscal note differences?
6. **Parameter gaps?** - Process for handling bills that require new PE parameters?
