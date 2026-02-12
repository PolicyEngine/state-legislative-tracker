# Bill Researcher Agent

Fetches and analyzes bill text to identify policy changes.

## Purpose

Given a bill identifier (state + bill number), this agent:
1. Fetches the full bill text from the state legislature website
2. Identifies which tax/benefit programs are affected
3. Extracts specific numeric changes (rates, thresholds, amounts)
4. Returns structured data for parameter mapping

## Inputs

- `state`: Two-letter state code (e.g., "UT", "SC")
- `bill_number`: Bill identifier (e.g., "SB60", "H3492", "HB2229")

## Process

### Step 1: Find Bill URL

Common state legislature URL patterns:
- **Utah**: `https://le.utah.gov/~{year}/bills/static/{bill}.html`
- **South Carolina**: `https://www.scstatehouse.gov/billsearch.php?billnumbers={number}`
- **Georgia**: `https://www.legis.ga.gov/legislation/{id}` (search via `https://www.legis.ga.gov/legislation/all`)
- **Oklahoma**: `https://www.oklegislature.gov/BillInfo.aspx?Bill={bill}`
- **New York**: `https://nyassembly.gov/leg/?bn={bill}`
- **Virginia**: `https://lis.virginia.gov/bill-details/{session}/{bill}`
- **Oregon**: `https://olis.oregonlegislature.gov/liz/{session}/Measures/Overview/{bill}`
- **California**: `https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id={session}{bill}`

Use WebFetch or WebSearch to find the bill page.

### Step 2: Extract Bill Text

Fetch the bill text. Look for:
- Enrolled/chaptered version if passed
- Latest version if in progress
- PDF links may need special handling

### Step 3: Identify Policy Changes

Look for language patterns:
- "shall be **reduced** from X to Y"
- "the rate shall be **X percent**"
- "**repeals** Section..."
- "**amends** Section X to read..."
- "credit equal to **X percent** of..."
- "phase-out begins at **$X**"

### Step 4: Categorize Changes

Identify which PolicyEngine programs are affected:
- **Income tax rates**: flat rate, bracket rates, thresholds
- **Credits**: EITC, CTC, property tax credits, renter credits
- **Exemptions**: personal exemption, dependent exemption
- **Deductions**: standard deduction, itemized caps

## Output Format

Return a structured summary:

```json
{
  "bill": {
    "state": "UT",
    "number": "SB60",
    "title": "Income Tax Rate Reduction",
    "session": "2026",
    "status": "Proposed",
    "url": "https://le.utah.gov/~2026/bills/static/SB60.html"
  },
  "effective_date": "2026-01-01",
  "provisions": [
    {
      "description": "Reduces flat income tax rate from 4.5% to 4.45%",
      "program": "income_tax",
      "change_type": "rate_reduction",
      "current_value": 0.045,
      "new_value": 0.0445,
      "affected_parameter": "gov.states.ut.tax.income.rate"
    }
  ],
  "fiscal_note_url": "https://le.utah.gov/~2026/fiscalnotes/SB0060.pdf",
  "sponsors": ["Sen. Smith"],
  "summary": "Brief plain-language summary of the bill"
}
```

## Tools Available

- `WebFetch`: Fetch bill pages
- `WebSearch`: Find bill URLs and fiscal notes
- `Read`: Read local files if bill text is cached
- `Grep/Glob`: Search existing codebase for similar bills

## Multi-Year Bills

Many tax bills phase in changes over multiple years (e.g., 1pp rate cut per year). Look for:
- "beginning in tax year X and each subsequent year"
- "reduced by X percentage points annually"
- "until the rate reaches Y percent"
- Tables or schedules showing year-by-year values

When detected, return a `rate_schedule` in the output:
```json
{
  "rate_schedule": {
    "2026": 0.0419,
    "2027": 0.0319,
    "2028": 0.0219,
    "2029": 0.0119,
    "2030": 0.0019,
    "2031": 0.0
  },
  "is_multi_year": true,
  "sunset_year": null
}
```

Also look for:
- **Revenue triggers**: cuts only happen if revenue thresholds are met
- **Rate floors**: minimum rate that cannot be cut below
- **Sunset provisions**: changes that expire after a certain year

## Tips

- Check for "substitute" or "amended" versions - use the latest
- Fiscal notes often have clearer summaries than bill text
- Look for "effective date" language to know when changes apply
- Some bills have multiple sections affecting different programs
- Always return both the state legislature URL and a LegiScan URL for cross-reference
- For graduated-rate states with bracket parameters, all filing statuses (single, joint, separate, surviving_spouse, head_of_household) usually change together
