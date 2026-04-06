# Reform-Specific Data Diagnostic Architecture

**Status**: Design phase
**Depends on**: autoresearch-reform-calibration.md (Layer 1: encoding validation)
**Problem**: Current data diagnostics are generic (same 4 checks for every reform). Real data issues are reform-specific — an EITC expansion cares about low-income coverage, a top-bracket rate cut cares about high-earner representation.

## 1. The Core Insight

Every reform touches specific PE variables. The data quality for **those specific variables** determines the accuracy of that reform's estimate. Diagnostics should be:

1. **Reform-specific** — driven by what the reform actually changes
2. **Variable-aware** — check the PE variables that feed into the reform's impact
3. **Durable** — findings persist and accumulate across reforms
4. **Self-correcting** — new runs confirm or revise old findings

## 2. How Reforms Map to Variables

A reform that changes `gov.states.ga.tax.income.main.single.brackets[5].rate` ultimately flows through a variable chain:

```
Reform parameter
  → state_income_tax (output variable)
    → taxable_income
      → adjusted_gross_income
        → employment_income, investment_income, business_income, ...
      → deductions (standard vs itemized)
      → exemptions
    → tax bracket structure
      → which brackets are populated, by how many filers
    → filing_status distribution
```

Different reforms care about different parts of this chain:

| Reform Type | Key Variables to Diagnose |
|---|---|
| Top bracket rate cut | High-income population, top decile AGI, investment income |
| Flat rate cut | Total AGI, overall filer count, effective rate |
| EITC expansion | Earned income at low end, qualifying children, filing status |
| CTC expansion | Households with children, income in phase-out range |
| Standard deduction increase | Itemizer ratio, AGI near std deduction threshold |
| Property tax credit | Homeownership rate, property tax amounts |
| Retirement income exemption | Population 65+, retirement income amounts |

## 3. The Variable Diagnostic Registry

Instead of hardcoded checks, maintain a registry of diagnostic checks indexed by PE variable. Each check knows:

- What PE variable it validates
- What public benchmark to compare against
- How to compute the comparison
- What reform types it's relevant to

```python
DIAGNOSTIC_REGISTRY = {
    "adjusted_gross_income": {
        "benchmark": "IRS SOI state totals",
        "source_url": "https://www.irs.gov/statistics/soi-tax-stats",
        "check": lambda baseline, state, year: compare_total_agi(baseline, state, year),
        "relevant_to": ["rate_change", "deduction_change", "exemption_change"],
    },
    "earned_income": {
        "benchmark": "IRS SOI wage/salary income",
        "check": lambda baseline, state, year: compare_earned_income(baseline, state, year),
        "relevant_to": ["eitc_change", "rate_change"],
    },
    "household_count_children": {
        "benchmark": "Census ACS households with children under 18",
        "check": lambda baseline, state, year: compare_child_households(baseline, state, year),
        "relevant_to": ["ctc_change", "dependent_exemption"],
    },
    "filing_status_distribution": {
        "benchmark": "IRS SOI returns by filing status",
        "check": lambda baseline, state, year: compare_filing_status(baseline, state, year),
        "relevant_to": ["bracket_change", "marriage_penalty"],
    },
    "itemizer_ratio": {
        "benchmark": "IRS SOI itemized vs standard deduction",
        "check": lambda baseline, state, year: compare_itemizer_ratio(baseline, state, year),
        "relevant_to": ["deduction_change", "salt_change"],
    },
    # ... more variables
}
```

### 3.1 Reform Type Detection

Parse reform_params to determine reform type:

```python
def detect_reform_type(reform_params, provisions):
    """Classify reform to select relevant diagnostics."""
    types = set()
    for path in reform_params.keys():
        if path.startswith("_"): continue
        path_lower = path.lower()
        if "rate" in path_lower or "bracket" in path_lower:
            types.add("rate_change")
            # Check if it's top bracket specifically
            if "brackets[5]" in path or "brackets[4]" in path:
                types.add("top_bracket_change")
        if "eitc" in path_lower or "earned_income" in path_lower:
            types.add("eitc_change")
        if "ctc" in path_lower or "child" in path_lower:
            types.add("ctc_change")
        if "deduction" in path_lower or "standard" in path_lower:
            types.add("deduction_change")
        if "exemption" in path_lower:
            types.add("exemption_change")
        if "property" in path_lower:
            types.add("property_tax_change")
    return types
```

### 3.2 Diagnostic Selection

Given a reform type, select only the relevant checks:

```python
def select_diagnostics(reform_types):
    """Select diagnostic checks relevant to this reform."""
    selected = []
    for var_name, config in DIAGNOSTIC_REGISTRY.items():
        if any(rt in config["relevant_to"] for rt in reform_types):
            selected.append((var_name, config))
    return selected
```

## 4. Durable Learning: The Data Findings Store

### 4.1 Schema

```sql
CREATE TABLE data_findings (
    id              SERIAL PRIMARY KEY,
    state           TEXT NOT NULL,
    variable        TEXT NOT NULL,        -- PE variable name
    year            INT NOT NULL,
    
    -- The finding
    pe_value        NUMERIC,
    benchmark_value NUMERIC,
    benchmark_source TEXT,
    pct_diff        NUMERIC,             -- (PE - benchmark) / benchmark
    finding         TEXT,                 -- Human-readable explanation
    
    -- Provenance
    reform_id       TEXT,                 -- Which reform first discovered this
    pe_us_version   TEXT,                 -- Which PE-US version
    dataset_version TEXT,                 -- Which dataset version
    
    -- Durability tracking
    confirmed_by    TEXT[],               -- Reform IDs that re-confirmed this
    times_confirmed INT DEFAULT 1,
    last_verified   TIMESTAMPTZ DEFAULT NOW(),
    still_valid     BOOLEAN DEFAULT TRUE,
    
    -- Uniqueness: one finding per (state, variable, year, pe_us_version)
    UNIQUE(state, variable, year, pe_us_version)
);
```

### 4.2 The Lifecycle of a Finding

```
Reform ga-hb1001 runs (rate change in GA):
  │
  ├── Check: does a finding exist for (GA, adjusted_gross_income, 2026)?
  │     → No → run diagnostic, store finding
  │     "GA AGI total: PE $408B vs IRS $343B (+19%)"
  │
Reform ga-hb463 runs (another GA rate change):
  │
  ├── Check: does a finding exist for (GA, adjusted_gross_income, 2026)?
  │     → Yes, from ga-hb1001, same PE-US version
  │     → Re-verify: still +19%? Yes → confirmed_by += ["ga-hb463"]
  │     → Skip full diagnostic, use cached finding
  │     → Save ~40 seconds
  │
Reform ga-sb520 runs (EITC expansion in GA):
  │
  ├── Check: does a finding exist for (GA, earned_income, 2026)?
  │     → No → this is a different variable! Run diagnostic.
  │     "GA earned income: PE $180B vs IRS $165B (+9%)"
  │     → NEW finding stored
  │
  ├── Check: does a finding exist for (GA, adjusted_gross_income, 2026)?
  │     → Yes, confirmed twice → use it (EITC also depends on AGI)
  │
PE-US version updates (new data release):
  │
  ├── All findings for old version marked still_valid = FALSE
  │     → Next reform in any state re-runs diagnostics
  │     → Findings for new version built from scratch
  │     → Can compare: "GA AGI gap improved from +19% to +12% with v1.5.0"
```

### 4.3 Finding Queries

```python
def get_existing_findings(state, variables, year, pe_us_version):
    """Check what we already know about these variables in this state."""
    results = supabase.table("data_findings").select("*").match({
        "state": state, "year": year, "pe_us_version": pe_us_version,
        "still_valid": True,
    }).in_("variable", variables).execute()
    return {row["variable"]: row for row in results.data}

def should_recheck(finding, max_age_days=30):
    """Should we re-verify this finding?"""
    age = (datetime.now() - finding["last_verified"]).days
    return age > max_age_days

def confirm_finding(finding_id, reform_id):
    """Mark a finding as re-confirmed by another reform."""
    supabase.rpc("confirm_data_finding", {
        "finding_id": finding_id,
        "confirming_reform": reform_id,
    })
```

## 5. The Iterative Diagnostic Loop (Redesigned)

### 5.1 Entry Point

```python
def diagnose_data_gap(reform_id, state, year, reform_params, provisions, baseline):
    """Reform-specific, learning-aware data diagnostic.
    
    1. Detect reform type from params
    2. Select relevant diagnostics
    3. Check for existing findings (skip if fresh)
    4. Run needed checks, store new findings
    5. Produce attribution report
    """
    
    # Step 1: What kind of reform is this?
    reform_types = detect_reform_type(reform_params, provisions)
    
    # Step 2: Which variables matter?
    diagnostics = select_diagnostics(reform_types)
    
    # Step 3: What do we already know?
    variables = [var_name for var_name, _ in diagnostics]
    existing = get_existing_findings(state, variables, year, pe_us_version)
    
    findings = []
    for var_name, config in diagnostics:
        if var_name in existing and not should_recheck(existing[var_name]):
            # Use cached finding
            findings.append(existing[var_name])
            confirm_finding(existing[var_name]["id"], reform_id)
            print(f"  {var_name}: using cached finding ({existing[var_name]['pct_diff']:+.1%})")
        else:
            # Run fresh check
            result = config["check"](baseline, state, year)
            store_finding(state, var_name, year, result, reform_id)
            findings.append(result)
            print(f"  {var_name}: NEW finding ({result['pct_diff']:+.1%})")
    
    # Step 4: Attribute the gap
    return build_attribution(findings, reform_types)
```

### 5.2 Attribution Logic

Different reform types weight findings differently:

```python
def build_attribution(findings, reform_types):
    """Weight findings by relevance to this specific reform."""
    
    weights = {}
    if "top_bracket_change" in reform_types:
        weights = {
            "top_decile_income": 0.40,
            "adjusted_gross_income": 0.25,
            "filing_status_distribution": 0.15,
            "household_count": 0.10,
            "effective_tax_rate": 0.10,
        }
    elif "eitc_change" in reform_types:
        weights = {
            "earned_income_low": 0.35,
            "qualifying_children": 0.25,
            "filing_status_distribution": 0.20,
            "household_count": 0.10,
            "poverty_rate": 0.10,
        }
    elif "rate_change" in reform_types:
        weights = {
            "adjusted_gross_income": 0.35,
            "effective_tax_rate": 0.25,
            "income_distribution": 0.20,
            "household_count": 0.10,
            "filing_status_distribution": 0.10,
        }
    # ... more reform types
    
    # Weight each finding's pct_diff by its relevance
    attributed = {}
    for finding in findings:
        var = finding["variable"]
        weight = weights.get(var, 0.05)  # Default low weight
        attributed[var] = {
            "pct_diff": finding["pct_diff"],
            "weight": weight,
            "weighted_contribution": finding["pct_diff"] * weight,
        }
    
    return attributed
```

## 6. Cross-Reform Learning

### 6.1 State Data Profile

Over time, the findings accumulate into a **state data profile** — a comprehensive picture of PE data quality for each state:

```json
{
    "state": "GA",
    "pe_us_version": "1.5.0",
    "profile_date": "2026-04-06",
    "variable_quality": {
        "adjusted_gross_income": {
            "pct_diff": 0.19,
            "confidence": "high",
            "confirmed_by": ["ga-hb1001", "ga-hb463", "ga-sb520"],
            "finding": "PE total AGI 19% above IRS SOI"
        },
        "earned_income": {
            "pct_diff": 0.09,
            "confidence": "medium",
            "confirmed_by": ["ga-sb520"],
            "finding": "PE earned income 9% above IRS SOI"
        },
        "household_count": {
            "pct_diff": -0.14,
            "confidence": "high",
            "confirmed_by": ["ga-hb1001", "ga-hb463"],
            "finding": "PE has 14% fewer households than IRS returns"
        }
    },
    "overall_quality": "moderate",
    "known_issues": [
        "Fewer households but higher per-household income → overweighted high earners",
        "Investment income appears overrepresented in top decile"
    ]
}
```

### 6.2 Profile Queries

Future reforms query the profile before running:

```python
def get_state_profile(state, pe_us_version):
    """Get accumulated data quality profile for a state."""
    findings = supabase.table("data_findings").select("*").match({
        "state": state, "pe_us_version": pe_us_version, "still_valid": True,
    }).execute()
    
    profile = {}
    for f in findings.data:
        var = f["variable"]
        if var not in profile or f["times_confirmed"] > profile[var]["times_confirmed"]:
            profile[var] = f
    
    return profile
```

### 6.3 Version Tracking

When PE-US or the dataset updates, findings are invalidated:

```python
def on_version_update(new_pe_us_version, new_dataset_version):
    """Invalidate findings from old versions."""
    supabase.table("data_findings").update({
        "still_valid": False
    }).neq("pe_us_version", new_pe_us_version).execute()
    
    # Log version transition
    print(f"  Invalidated findings for PE-US != {new_pe_us_version}")
    print(f"  Next reform run will rebuild findings for the new version")
```

This is the key durability mechanism: findings are tied to a specific PE-US version. When the data improves (new CPS vintage, better imputation, weight recalibration), old findings are retired and new ones are built — so the system can track whether updates actually fixed known issues.

## 7. Integration with Existing Pipeline

### 7.1 During /encode-bill

```
Phase 5: Compute impacts
  → run_simulations() produces baseline + reformed
  → compute all impact metrics
  
Phase 5.5: Data diagnostic (NEW, automatic)
  → detect_reform_type(reform_params)
  → select relevant diagnostics
  → check existing findings (cache hit?)
  → run fresh checks if needed
  → attribute the gap
  → store findings in data_findings table
  → add to model_notes.data_diagnostic
  
Phase 6: Create PR
  → PR body includes data diagnostic section:
    "PE baseline for GA runs 19% above IRS SOI for total AGI.
     This is a known, stable finding (confirmed by 3 prior reforms).
     Expected reform-level gap: ~15-20% for rate-change reforms."
```

### 7.2 During analyze_residuals.py (outer loop)

```
Read all data_findings from DB
Group by state → build state profiles
Group by variable → find cross-state patterns
  → "employment_income is well-calibrated across all states (<5% diff)"
  → "investment_income is consistently 15-25% high in Southern states"
  → "household_count is 10-15% low in most states vs IRS returns"
Report which PE-US data improvements would have the most impact
```

## 8. What "Holds Forever"

Every diagnostic run produces findings that:

1. **Persist in DB** — not local files. Any machine can query them.
2. **Are version-tagged** — tied to PE-US version. When data updates, findings are re-validated.
3. **Accumulate confidence** — the more reforms confirm a finding, the more reliable it is.
4. **Are reform-specific** — different reforms test different parts of the data, building coverage over time.
5. **Are queryable by future runs** — next reform checks "what do we already know?" before running diagnostics.
6. **Track improvement** — when a new PE-US version drops a state's AGI gap from 19% to 8%, that's visible.

The knowledge base looks like:

```
After 10 reforms:
  GA: AGI +19%, earned income +9%, HH count -14% (3 reforms confirmed each)
  MD: AGI -8%, earned income -12% (consistent with known DLS gap)
  UT: AGI +3%, earned income +2% (well calibrated)
  KS: AGI -40%, earned income -35% (severe CPS coverage issue)

After PE-US v1.6.0 update:
  GA: AGI +12% (improved from +19%), HH count -10% (improved from -14%)
  → Data update helped GA, still room for improvement
  KS: AGI -38% (barely improved) → flag for PE-US data team
```

## 9. Implementation Phases

### Phase 1: Diagnostic Registry + Reform Type Detection
- Build `DIAGNOSTIC_REGISTRY` with checks for the 5 most common reform types
- Implement `detect_reform_type()` from reform_params
- Wire into existing diagnostic flow

### Phase 2: Data Findings Table + Caching
- Create `data_findings` table in Supabase
- Implement find/store/confirm cycle
- Cache hits skip redundant checks

### Phase 3: Attribution Weights
- Different reform types weight findings differently
- Produce reform-specific gap explanations

### Phase 4: State Profiles + Cross-Reform Analysis
- Build state profiles from accumulated findings
- Version tracking and invalidation on PE-US updates
- Integrate into analyze_residuals.py outer loop

### Phase 5: Frontend Integration
- State profile displayed on calibration dashboard
- Per-reform data diagnostic in bill analysis view
- Version-over-version improvement tracking
