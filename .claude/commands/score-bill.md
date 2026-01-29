# Score Bill

Score a legislative bill by extracting policy changes and running PolicyEngine analysis.

## Arguments
- `$ARGUMENTS` - Bill identifier (e.g., "UT SB60", "OK HB2229") or URL to bill text

## Workflow

### Step 1: Get Bill Text

Since LegiScan API may hit rate limits, use multiple sources:

1. **Web Search** first to find bill details:
   ```
   WebSearch: "{State} {BillNumber} {Year} income tax bill text"
   ```

2. **BillTrack50** often has good summaries:
   ```
   https://www.billtrack50.com/billdetail/{bill_id}
   ```

3. **State Legislature** websites for official text:
   - Utah: `https://le.utah.gov/~{year}/bills/static/{bill}.html`
   - Oklahoma: `http://www.oklegislature.gov/BillInfo.aspx?Bill={bill}`
   - etc.

Extract: bill title, sponsor, status, effective date, and the specific policy changes.

### Step 2: Extract Policy Changes

Analyze the bill text to identify:
- **Tax rate changes** (income tax rates, brackets)
- **Credit changes** (EITC, CTC, property tax credits)
- **Deduction changes** (standard deduction, itemized limits)
- **Exemption changes** (personal exemptions, dependent exemptions)
- **Effective dates** for each change

Summarize in structured format:
```
State: [XX]
Bill: [Bill Number]
Title: [Short title]
Sponsor: [Name (Party)]
Status: [In Committee / Passed / Signed]
Effective Date: [YYYY-MM-DD]

Policy Changes:
1. [Description of change 1]
   - Current: [current value]
   - Proposed: [new value]
```

### Step 3: Map to PolicyEngine Parameters

Search policyengine-us GitHub for the corresponding parameters:

1. **Browse the parameter tree** via GitHub API:
   ```
   https://api.github.com/repos/PolicyEngine/policyengine-us/contents/policyengine_us/parameters/gov/states/{state_lower}/tax/income
   ```

2. **Common parameter paths**:
   | Policy Type | Parameter Path |
   |-------------|----------------|
   | Income tax rate (flat) | `gov.states.{state}.tax.income.rate` |
   | Income tax rates (graduated) | `gov.states.{state}.tax.income.rates.rate` |
   | EITC match | `gov.states.{state}.tax.income.credits.earned_income.eitc_fraction` |
   | CTC | `gov.states.{state}.tax.income.credits.ctc.*` |
   | Standard deduction | `gov.states.{state}.tax.income.deductions.standard.*` |

3. **Fetch the actual YAML** to verify current value:
   ```
   https://raw.githubusercontent.com/PolicyEngine/policyengine-us/master/policyengine_us/parameters/gov/states/{state}/tax/income/credits/earned_income/eitc_fraction.yaml
   ```

4. If a parameter doesn't exist, note it as **"NOT MODELABLE"** and explain why.

### Step 4: Confirm with User

Present the proposed reform configuration:

```
## {State} {BillNumber} - Reform Configuration

**Bill:** {BillNumber} ({Sponsor})
**Title:** {Title}
**Status:** {Status}
**Effective:** Tax years beginning {Date}

### Policy Change
| | Current | Proposed |
|---|---------|----------|
| {Parameter Name} | {current_value} | {new_value} |

### PolicyEngine Parameter
```
{parameter.path.here}
```
- Current value in PE: {value}
- Proposed value: {new_value}

### Proposed Reform Config
```python
{
    "id": "{state}-{bill}-{description}",
    "state": "{state_lower}",
    "label": "{State} {Bill}: {Short Description}",
    "reform": {
        "{parameter.path}": {
            "2026-01-01.2100-12-31": {value}
        }
    }
}
```

**Confirm to proceed?**
```

Wait for user confirmation before continuing.

### Step 5: Add Reform to compute_impacts.py

Edit `scripts/compute_impacts.py`:

1. Add to the `REFORMS` list (~line 44):
   ```python
   {
       "id": "{reform_id}",
       "state": "{state_lower}",
       "label": "{Label}",
       "reform": {
           "{parameter.path}": {
               "2026-01-01.2100-12-31": {value}
           }
       }
   }
   ```

2. Add state to `CONGRESSIONAL_DISTRICTS` if not present (~line 34):
   ```python
   "{STATE}": {
       1: "Congressional District 1",
       2: "Congressional District 2",
       # ... add all districts
   }
   ```

3. Add state FIPS code to `STATE_FIPS` dict (~line 197):
   ```python
   "{STATE}": {fips_code},
   ```

   Common FIPS codes: AL=1, AK=2, AZ=4, CA=6, CO=8, FL=12, GA=13, IL=17, NY=36, OK=40, TX=48, UT=49

### Step 6: Run Computation

```bash
python scripts/compute_impacts.py
```

This will:
- Create policy via PolicyEngine API (`/us/policy`)
- Poll for economy-wide impacts (`/us/economy/{id}/over/2`) - takes 1-3 minutes
- Download **state-specific dataset** from Hugging Face (`policyengine/policyengine-us-data`)
- Compute district-level impacts via Microsimulation using `{STATE}.h5`
- Save results to `src/data/reformImpacts.json`

**Data Sources:**
| Impact Type | Source | Dataset |
|-------------|--------|---------|
| Statewide (budget, poverty, deciles) | PolicyEngine API | Enhanced CPS (remote) |
| District-level | Local Microsimulation | `states/{STATE}.h5` from HuggingFace |

Monitor output for:
```
Processing: {Reform Label}
  State: {STATE}
  Creating policy...
  Policy ID: {id}
  Fetching economy impact (this may take a few minutes)...
  Computing... (attempt X/60)
  Computing district-level impacts...
    Downloading {STATE} dataset from Hugging Face...
    Dataset ready: ~/.cache/huggingface/.../states/{STATE}.h5
    Running baseline simulation...
    Running reform simulation...
    District 1: ${X} avg benefit
    District 2: ${X} avg benefit
  Done! Impacts computed.
```

### Step 7: Link Reform in states.js (REQUIRED!)

Edit `src/data/states.js` to add the bill to the state's `activeBills` array:

```javascript
{STATE}: {
    // ... existing config ...
    activeBills: [
      {
        bill: "{BillNumber}",
        status: "{In Committee|Passed|Signed}",
        description: "{Short description}",
        url: "{bill_url}",
        reformConfig: {
          id: "{reform_id}",  // Must match compute_impacts.py
          label: "{Label}",
          description: "{Description}",
          reform: {
            "{parameter.path}": {
              "2026": {value}  // Note: simplified date format for frontend
            }
          }
        }
      }
    ],
  },
```

**Important**: The `reformConfig.id` MUST match the `id` in `compute_impacts.py` to link the computed results.

### Step 8: Verify in UI

The dev server should hot-reload. Verify:
1. Click on the state in the map
2. See the bill in "Active Bills" section
3. Click "Analyze Impact" button
4. Confirm all tabs work: Statewide, Districts, Household Calculator

### Step 9: Summary

Output results:
```
## {State} {BillNumber} - Scoring Complete

| Metric | Value |
|--------|-------|
| **Budget Impact** | ${X} million |
| **Poverty Reduction** | {X} pp ({X}%) |
| **Child Poverty Reduction** | {X} pp ({X}%) |
| **Winners** | {X}% of households |
| **Losers** | {X}% |

### Files Modified
- `scripts/compute_impacts.py` - Added reform config
- `src/data/reformImpacts.json` - Computed results (auto-generated)
- `src/data/states.js` - Linked to state's activeBills

### Next Steps
- [ ] Test in UI at http://localhost:5174
- [ ] Add to research.js (optional)
- [ ] Create PR
```

### Step 10: Add to Research (Optional)

If user wants, add to `src/data/research.js`:

```javascript
{
    id: "{reform_id}",
    state: "{STATE}",
    type: "blog",
    status: "planned",  // or "published" if article exists
    title: "{State} {BillNumber}: {Title}",
    description: "{Description}",
    keyFindings: [
      "Budget impact: ${X} million",
      "{X}% of residents benefit",
    ],
    tags: ["{relevant}", "{tags}"],
}
```

## Example Usage

```
/score-bill OK HB2229
/score-bill UT SB60
/score-bill https://www.billtrack50.com/billdetail/1788567
```

## Quick Reference

### Files to Edit
| File | Purpose |
|------|---------|
| `scripts/compute_impacts.py` | REFORMS list, STATE_FIPS, CONGRESSIONAL_DISTRICTS |
| `src/data/states.js` | Link reform to state's activeBills |
| `src/data/research.js` | Optional research entry |
| `src/data/reformImpacts.json` | Auto-generated by computation |

### Parameter Lookup
```
https://api.github.com/repos/PolicyEngine/policyengine-us/contents/policyengine_us/parameters/gov/states/{state}/tax/income
```

### State FIPS Codes
AL=1, AK=2, AZ=4, AR=5, CA=6, CO=8, CT=9, DE=10, FL=12, GA=13, HI=15, ID=16, IL=17, IN=18, IA=19, KS=20, KY=21, LA=22, ME=23, MD=24, MA=25, MI=26, MN=27, MS=28, MO=29, MT=30, NE=31, NV=32, NH=33, NJ=34, NM=35, NY=36, NC=37, ND=38, OH=39, OK=40, OR=41, PA=42, RI=44, SC=45, SD=46, TN=47, TX=48, UT=49, VT=50, VA=51, WA=53, WV=54, WI=55, WY=56

### Requirements
- `policyengine-us` - For local microsimulation
- `huggingface_hub` - For downloading state datasets (no fallback to national dataset)

### State Datasets
State-specific datasets with congressional district geocoding:
```
https://huggingface.co/policyengine/policyengine-us-data/tree/main/states
```
Files: `{STATE}.h5` (e.g., `OK.h5`, `UT.h5`, `CA.h5`)
- Downloaded automatically and cached in `~/.cache/huggingface/`
- Required for district-level impacts (no fallback to national data)
