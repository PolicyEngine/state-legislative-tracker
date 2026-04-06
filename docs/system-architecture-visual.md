# System Architecture: Bill to Output

The complete pipeline from a tax bill to a published impact estimate,
showing where each validation and diagnostic layer sits.

## Full Pipeline Visual

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BILL DISCOVERY & TRIAGE                             │
│                                                                             │
│  OpenStates API ──→ processed_bills table ──→ /triage-bills                │
│  (openstates_monitor.py)     (unscored)       (score 0-100)                │
│                                                                             │
│  Output: Bills ranked by modelability (parametric vs structural)            │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BILL RESEARCH (parallel agents)                     │
│                                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐                   │
│  │  bill-researcher     │    │  fiscal-finder            │                  │
│  │  • Fetch bill text   │    │  • Find fiscal note       │                  │
│  │  • Extract provisions│    │  • Search think tanks      │                  │
│  │  • Record sections   │    │  • Back-of-envelope calc   │                  │
│  │  • Effective dates   │    │  • Revenue-base reasoning  │                  │
│  └─────────┬───────────┘    └────────────┬─────────────┘                   │
│            │                              │                                 │
│            ▼                              ▼                                 │
│     Provisions array              Fiscal data JSON                         │
│     (what the bill changes)       (external estimates)                     │
└──────────────┬──────────────────────────┬──────────────────────────────────┘
               │                          │
               ▼                          │
┌─────────────────────────────────────────┼──────────────────────────────────┐
│                    PARAMETER MAPPING                                        │
│                                         │                                  │
│  param-mapper agent                     │                                  │
│  • Map provisions → PE parameter paths  │                                  │
│  • Generate reform_params JSON          │                                  │
│  • Validate paths exist in PE-US        │                                  │
│                                         │                                  │
│  Output: reform_params                  │                                  │
│  {                                      │                                  │
│    "gov.states.ga...brackets[0].rate":  │                                  │
│      {"2026-01-01.2100-12-31": 0.0499}  │                                  │
│  }                                      │                                  │
└──────────────┬──────────────────────────┼──────────────────────────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  ▓  LAYER 1: ENCODING VALIDATION (scoring agent)                        ▓  │
│  ▓                                                                      ▓  │
│  ▓  reform_params + bill text + fiscal data                             ▓  │
│  ▓       │                                                              ▓  │
│  ▓       ├─→ Structural checks:                                        ▓  │
│  ▓       │     Parameter paths exist?                                   ▓  │
│  ▓       │     Period ranges match bill effective dates?                 ▓  │
│  ▓       │     All filing statuses included?                            ▓  │
│  ▓       │     All provisions encoded?                                  ▓  │
│  ▓       │     Values match bill text exactly?                          ▓  │
│  ▓       │                                                              ▓  │
│  ▓       ├─→ If structural error found → FIX and re-run                ▓  │
│  ▓       │     (iterative, like autoresearch)                          ▓  │
│  ▓       │                                                              ▓  │
│  ▓       └─→ If encoding correct → proceed to compute                  ▓  │
│  ▓                                                                      ▓  │
│  ▓  CRITICAL: Bill values are IMMUTABLE. Never change 4.99% to match   ▓  │
│  ▓  a fiscal note. Fix paths/periods/structure only.                    ▓  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                                                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COMPUTE IMPACTS (compute_impacts.py)                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PE-US DATA PIPELINE (policyengine-us-data)                         │   │
│  │                                                                     │   │
│  │  Raw CPS ──→ Imputation ──→ Uprating ──→ Reweighting ──→ Dataset   │   │
│  │  (Census)    (QRF/PUF)     (national     (loss matrix     (state   │   │
│  │              fills missing   growth        ~500 targets)   .h5)    │   │
│  │              variables)      factors)                               │   │
│  │                                                                     │   │
│  │  ⚠ State income NOT directly calibrated                            │   │
│  │  ⚠ Only state population counts targeted                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Baseline simulation ──→ Reform simulation                                 │
│       │                       │                                            │
│       └───────┬───────────────┘                                            │
│               ▼                                                            │
│  Impact calculations:                                                      │
│  • budgetary_impact (state revenue change)                                 │
│  • poverty_impact (baseline vs reform poverty rate)                        │
│  • winners_losers (5-category distribution by decile)                      │
│  • decile_impact (relative + average by income decile)                     │
│  • district_impacts (per congressional district)                           │
│                                                                             │
│  Output: PE estimate (e.g., -$500M for GA HB1001)                          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  ▓  VALIDATION HARNESS (validation_harness.py)                          ▓  │
│  ▓                                                                      ▓  │
│  ▓  Build target from multiple strategies:                              ▓  │
│  ▓                                                                      ▓  │
│  ▓  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              ▓  │
│  ▓  │ Fiscal note   │  │ Revenue-base │  │ Back-of-     │              ▓  │
│  ▓  │ (if exists)   │  │ reasoning    │  │ envelope     │              ▓  │
│  ▓  │ HIGH conf.    │  │ MEDIUM conf. │  │ MED-LOW conf.│              ▓  │
│  ▓  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              ▓  │
│  ▓         │                  │                  │                      ▓  │
│  ▓  ┌──────┴────────┐  ┌─────┴────────┐         │                     ▓  │
│  ▓  │ Tax expend.   │  │ Similar bills│         │                     ▓  │
│  ▓  │ reports       │  │ (scaled)     │         │                     ▓  │
│  ▓  │ MEDIUM conf.  │  │ MEDIUM conf. │         │                     ▓  │
│  ▓  └──────┬────────┘  └──────┬───────┘         │                     ▓  │
│  ▓         │                  │                  │                      ▓  │
│  ▓         └──────────┬───────┴──────────────────┘                     ▓  │
│  ▓                    ▼                                                ▓  │
│  ▓              Triangulate                                            ▓  │
│  ▓              → Target: -$778M                                       ▓  │
│  ▓              → Confidence: HIGH                                     ▓  │
│  ▓              → Tolerance: ±15%                                      ▓  │
│  ▓                                                                      ▓  │
│  ▓  Compare: PE (-$500M) vs Target (-$778M) = 35.7% gap               ▓  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                                                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                          Gap > tolerance?
                          ┌────────┴────────┐
                          │ YES             │ NO
                          ▼                 ▼
┌──────────────────────────────┐  ┌──────────────────────────────────────────┐
│                              │  │  PUBLISH                                 │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │  │                                          │
│  ▓ LAYER 2: DATA DIAGNOSTIC▓  │  │  → Create PR (bill/ branch)             │
│  ▓ (validate_baseline.py)  ▓  │  │  → PR body includes:                    │
│  ▓                          ▓  │  │    • Provisions table                   │
│  ▓ Reform-specific:        ▓  │  │    • PE vs external comparison           │
│  ▓ 1. Detect reform type   ▓  │  │    • Calibration results                │
│  ▓    (rate? EITC? CTC?)   ▓  │  │    • Data diagnostic summary            │
│  ▓                          ▓  │  │  → PR merge triggers:                   │
│  ▓ 2. Select relevant      ▓  │  │    • publish-bill.yml                   │
│  ▓    diagnostics           ▓  │  │    • status → "published"              │
│  ▓    (top decile for rate  ▓  │  │    • Modal redeploy                    │
│  ▓     cuts, earned income  ▓  │  │                                          │
│  ▓     for EITC, children   ▓  │  └──────────────────────────────────────────┘
│  ▓     for CTC)             ▓  │
│  ▓                          ▓  │
│  ▓ 3. Check cache           ▓  │
│  ▓    (data_findings table) ▓  │
│  ▓    Hit → skip sim        ▓  │
│  ▓    Miss → run check      ▓  │
│  ▓                          ▓  │
│  ▓ 4. Store findings        ▓  │
│  ▓    durably (by variable, ▓  │
│  ▓    state, PE-US version) ▓  │
│  ▓                          ▓  │
│  ▓ 5. Attribute gap:        ▓  │
│  ▓    "15% from top-decile  ▓  │
│  ▓     overweight, 5% from  ▓  │
│  ▓     uprating drift"      ▓  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                              │
└──────────────┬───────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DIAGNOSIS & DOCUMENTATION                           │
│                                                                             │
│  diagnosis.json:                                                           │
│  {                                                                         │
│    "encoding_correct": true,                                               │
│    "gap_pct": 0.357,                                                       │
│    "root_cause": "PE 2026 baseline is 5.09% (HB1015 pre-scheduled),       │
│                   fiscal note measures from 5.19%",                        │
│    "data_diagnostic": {                                                    │
│      "reform_types": ["rate_change"],                                      │
│      "data_quality_score": +0.19,                                          │
│      "top_factors": [                                                      │
│        {"variable": "adjusted_gross_income", "diff": "+19%"},              │
│        {"variable": "household_count", "diff": "-14%"},                    │
│        {"variable": "top_decile_income_share", "diff": "+11%"}             │
│      ]                                                                     │
│    }                                                                       │
│  }                                                                         │
│                                                                             │
│  Written to:                                                               │
│  • validation_metadata (iteration log, PE estimate, discrepancy)           │
│  • model_notes.calibration (converged, root cause, target)                 │
│  • model_notes.data_diagnostic (reform-specific data quality)              │
│  • data_findings (durable per-variable findings)                           │
│                                                                             │
│  ──→ PUBLISH (with explained gap in PR body)                               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  ▓  OUTER LOOP: CROSS-BILL LEARNING (analyze_residuals.py)             ▓  │
│  ▓                                                                      ▓  │
│  ▓  After N bills:                                                      ▓  │
│  ▓  • State bias detection (MD always -15%, KS at half)                 ▓  │
│  ▓  • Strategy accuracy (revenue-base overestimates by 9%)             ▓  │
│  ▓  • Correction factors → fed back to harness for next bill           ▓  │
│  ▓  • State data profiles built from accumulated findings              ▓  │
│  ▓  • Version tracking: did PE-US v1.6.0 fix the GA gap?              ▓  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                                                                             │
│         │                                                                  │
│         ▼                                                                  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  ▓  FUTURE: US-DATA IMPROVEMENT CYCLE                                   ▓  │
│  ▓  (requires regression harness — see us-data-improvement-safety.md)   ▓  │
│  ▓                                                                      ▓  │
│  ▓  Findings from diagnostic ──→ Identify data pipeline stage           ▓  │
│  ▓                                                                      ▓  │
│  ▓  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐        ▓  │
│  ▓  │ Raw CPS  │  │Imputation│  │ Uprating │  │ Reweighting  │        ▓  │
│  ▓  │ (can't   │  │ (QRF     │  │ (growth  │  │ (loss matrix │        ▓  │
│  ▓  │  change) │  │  models) │  │  factors) │  │  targets)    │        ▓  │
│  ▓  │          │  │ HIGH risk│  │ LOW risk  │  │ MEDIUM risk  │        ▓  │
│  ▓  └──────────┘  └──────────┘  └─────┬────┘  └──────┬───────┘        ▓  │
│  ▓                                     │              │                ▓  │
│  ▓                    ┌────────────────┘              │                ▓  │
│  ▓                    ▼                               ▼                ▓  │
│  ▓           Test change on copy of dataset                            ▓  │
│  ▓                    │                                                ▓  │
│  ▓                    ▼                                                ▓  │
│  ▓           Regression test (ALL ~500 targets)                        ▓  │
│  ▓           • National SOI still on target?                           ▓  │
│  ▓           • Other states not degraded?                              ▓  │
│  ▓           • Target state improved?                                  ▓  │
│  ▓                    │                                                ▓  │
│  ▓              ┌─────┴─────┐                                          ▓  │
│  ▓              │           │                                          ▓  │
│  ▓           ACCEPT      REJECT                                        ▓  │
│  ▓           (PR to       (revert,                                     ▓  │
│  ▓            us-data)     try different                                ▓  │
│  ▓                         approach)                                   ▓  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


## Data Flow Summary

  ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌──────────────┐
  │   Bill    │──→ │  Encode   │──→ │  Compute   │──→ │   Validate   │
  │   Text    │    │  (params) │    │  (PE sim)  │    │  (harness)   │
  └──────────┘    └───────────┘    └────────────┘    └──────┬───────┘
                        ▲                                    │
                        │                              Gap > tolerance?
                   Fix structural                      ┌─────┴─────┐
                   errors only                         NO          YES
                                                       │           │
                                                       ▼           ▼
                                                   Publish    Data diagnostic
                                                   with       (reform-specific,
                                                   confidence  durable findings)
                                                               │
                                                               ▼
                                                          Explained gap
                                                          → Publish with
                                                            documentation


## Database Tables

  ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
  │    research      │────→│  reform_impacts   │────→│ validation_metadata  │
  │                  │     │                  │     │                     │
  │ id, state, title │     │ reform_params    │     │ fiscal_note_est     │
  │ status, url      │     │ budgetary_impact │     │ pe_estimate         │
  │ key_findings     │     │ poverty_impact   │     │ iteration_log       │
  │                  │     │ winners_losers   │     │ discrepancy_expl    │
  │                  │     │ model_notes:     │     │                     │
  │                  │     │  .calibration    │     └─────────────────────┘
  │                  │     │  .data_diagnostic│
  └─────────────────┘     └──────────────────┘
                                                    ┌─────────────────────┐
                                                    │   data_findings      │
                                                    │                     │
                                                    │ state, variable     │
                                                    │ pe_value, benchmark │
                                                    │ pct_diff            │
                                                    │ pe_us_version       │
                                                    │ times_confirmed     │
                                                    │ still_valid         │
                                                    └─────────────────────┘

                                                    ┌─────────────────────┐
                                                    │ calibration_learnings│
                                                    │                     │
                                                    │ pattern, learning   │
                                                    │ correction_factor   │
                                                    │ state, scope        │
                                                    └─────────────────────┘


## Files on Disk

  scripts/
    auto_calibrate.py         ← Layer 1 orchestrator
    validation_harness.py     ← Multi-strategy target builder
    validate_baseline.py      ← Layer 2 data diagnostic engine
    compute_impacts.py        ← PE microsimulation runner
    analyze_residuals.py      ← Outer loop cross-bill analysis
    db_schema.py              ← DB format utilities

  .claude/agents/
    reform-calibrator.md      ← Agent instructions (scoring + diagnosis)
    bill-researcher.md        ← Bill text extraction
    fiscal-finder.md          ← External estimate discovery
    param-mapper.md           ← PE parameter mapping

  results/{reform-id}/
    calibration_state.json    ← Current scoring state
    calibration.tsv           ← Attempt-by-attempt log
    harness_output.json       ← Target + strategy breakdown
    data_diagnostic.json      ← Variable-specific findings
    diagnosis.json            ← Root cause + data explanation
    snapshots/                ← Reform param versions

  docs/
    autoresearch-reform-calibration.md
    data-diagnostic-architecture.md
    us-data-calibration-targets.md
    us-data-improvement-safety.md
    system-architecture-visual.md  ← This file
```

<br>
