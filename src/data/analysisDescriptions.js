/**
 * Bill descriptions for the state legislative tracker.
 *
 * Edit descriptions here — changes are version-controlled.
 * Everything else (provisions, analysis year, computed data) stays in Supabase.
 */

const descriptions = {
  // Arizona
  "az-hb2636": "Replaces Arizona's 2.5% flat individual income tax with a two-bracket progressive structure: 2.5% on the first $1M of taxable income, 8% on income above $1M. Same threshold for all filing statuses. Effective TY2027.",

  // Colorado
  "co-hb1062": "Eliminates the $20,000 (age 55-64) and $24,000 (age 65+) caps on Colorado's pension and annuity income subtraction, allowing taxpayers age 55+ to deduct all qualifying retirement income (pensions, annuities, IRA distributions, Social Security) from state taxable income, effective tax year 2027.",

  // Connecticut
  "ct-hb5133": "Increases Connecticut's top marginal income tax rate from 6.99% to 7.99% for high earners (single filers over $500,000, joint filers over $1,000,000).",
  "ct-sb78": "Eliminates the qualifying income thresholds for the personal income tax deductions for Social Security benefits. Currently, filers above $75K (single) / $100K (joint) can only deduct 75% of SS benefits; this bill makes 100% deductible for all.",
  "ct-sb69": "Eliminates Connecticut's state Earned Income Tax Credit (EITC), which currently provides 40% of the federal EITC to eligible low-income working families. We assume the $250 child bonus is also eliminated as the EITC statute is removed from the legal code.",
  "ct-tax-rebate-2026": "Governor Lamont's proposed one-time tax rebate providing $200 per person ($400 for joint filers) to Connecticut residents with AGI below $200,000 (single) or $400,000 (joint).",
  "ct-hb5134": "Creates a new refundable child tax credit of $600 per qualifying child (up to 3 children) for Connecticut families with federal AGI below $100,000 (single) or $200,000 (joint). Children must be under age 18. Effective tax year 2026.",
  "ct-sb100": "Reduces Connecticut's lowest two marginal income tax rates for taxpayers with AGI below $100,000 (single) or $200,000 (joint). Eliminates tax on the first $10,000/$20,000 of income and cuts the next bracket from 4.5% to 3%.",

  // Washington DC
  "dc-hjr142": "Congressional resolution disapproving the D.C. Income and Franchise Tax Conformity and Revision Emergency Amendment Act of 2025, which would eliminate the $1,000 Child Tax Credit and revert the EITC match for households with children from 100% to 85%.",

  // Georgia
  "ga-sb168": "Reduces Georgia's flat income tax rate from 5.09% to 4.19% for 2026, with 1.0pp annual cuts to eliminate the tax by 2031. Removes revenue trigger conditions and rate floor.",
  "ga-sb476": "Reduces Georgia income tax rate to 4.99% and increases standard deductions to $50,000 for single filers and $100,000 for joint filers, effective January 1, 2026.",

  // Iowa
  "ia-hf1020": "Modifies the Iowa child and dependent care credit by removing the $90,000 income cap and simplifying from 7 brackets to 4. Taxpayers with Iowa net income of $25,000 or more receive 50% of the federal credit (up from 30-40% for middle-income and 0% for high-income). Retroactive to January 1, 2025.",

  // Illinois
  "il-hb4680": "Increases the Illinois Earned Income Tax Credit match from 20% to 30% of the federal EITC, effective January 1, 2026.",

  // Kansas
  "ks-hb2629": "Kansas HB2629 increases the standard deduction base amounts for all filing statuses effective tax year 2026: single from $3,605 to $3,805, joint from $8,240 to $8,640, head of household from $6,180 to $6,480.",

  // Massachusetts
  "ma-h5007": "Initiative petition to reduce Massachusetts' personal income tax rate from 5% to 4% through a three-year phase-in: 4.67% in 2027, 4.33% in 2028, and 4.00% starting in 2029. Applies to both Part A (interest/dividends) and Part B (regular income). Does not affect the 4% surtax on income over $1M.",

  // Maryland
  "md-hb411": "Increases the Maryland standard deduction from $3,350 to $4,100 for single filers and from $6,700 to $8,200 for joint filers, heads of household, and surviving spouses, effective tax year 2026. Also updates the COLA base amounts.",

  // Michigan
  "mi-hb4170": "Amends the Income Tax Act to reduce Michigan's flat individual income tax rate from 4.25% to 4.05%, effective for tax years beginning after December 31, 2024 (retroactive to TY 2025).",
  "mi-invest-in-kids": "Constitutional amendment imposing a 5% income tax surcharge on income above $500,000 (single) or $1 million (joint) to fund K-12 education.",

  // Minnesota
  "mn-hf154": "Reduces Minnesota's first-tier individual income tax rate from 5.35% to 2.8%, a 2.55 percentage point cut affecting all filing statuses. Also rebases statutory bracket thresholds to 2025 inflation-adjusted values (no real-world threshold change). Effective for tax years beginning after December 31, 2024.",
  "mn-hf2197-ctc-wfc-marriage-penalty": "Increases CTC phaseout threshold for joint filers to $75,000 and other filers to $37,500, eliminates WFC for childless adults.",
  "mn-hf2502-ctc-marriage-penalty": "Increases child credit phaseout threshold for joint filers from $35,000 to $63,900 to eliminate marriage penalty.",

  // Missouri
  "mo-sb458": "Replaces Missouri's graduated income tax brackets (0%-4.7%) with a flat 4.0% rate on all taxable income, effective January 1, 2026. Also eliminates Missouri's federal income tax deduction (\u00a7143.171), which currently allows filers to deduct 5-35% of federal taxes paid. Includes a trigger mechanism for further rate reductions toward zero contingent on a constitutional amendment (not modeled).",

  // Mississippi
  "ms-sb2869": "Freezes the Mississippi income tax rate at 4% permanently, reversing the HB1 (Build Up Mississippi Act) phase-out schedule that would reduce the rate to 3% by 2030 and eventually eliminate it.",

  // New Jersey
  "nj-a1185-marriage-penalty-elimination": "Revises joint filer rate brackets to eliminate the marriage penalty by widening the 1.4% and 1.75% brackets and removing the 2.45% bracket for joint, head of household, and surviving spouse filers.",

  // North Carolina
  "nc-h459": "Freezes the North Carolina flat individual income tax rate at 4.25% for tax years 2026 through 2028, preventing the scheduled reduction to 3.99%. Suspends the rate reduction trigger mechanism and reinstates it for 2029+ with a shortened trigger table. Motivated by Hurricane Helene recovery costs.",

  // North Dakota
  "nd-hb1388": "North Dakota HB1388 eliminates the marriage penalty by restructuring income tax bracket thresholds so MFJ equals 2x single, HoH equals 1.5x single, and MFS uses the single schedule. It also repeals the existing marriage penalty credit (capped at ~$312). The bill passed the House 91-0 but failed in the Senate 13-33.",

  // New York
  "ny-a05435": "Increases the personal income tax rate on taxable income between $5M and $25M from 10.30% to 10.80%, and on income over $25M from 10.90% to 11.40%. Also updates the supplemental tax incremental benefit to reflect the higher rates.",
  "ny-a06774": "Increases the NY child and dependent care credit to 110% of the federal credit for taxpayers with NY AGI up to $50,000.",
  "ny-a5661": "Increases New York's Earned Income Tax Credit match rate from 30% to 45% of the federal EITC.",
  "ny-s4487": "Creates a $1,000 refundable supplemental credit for each qualifying newborn (child born in current or previous tax year, ages 0-1). This is in addition to the existing Empire State Child Credit. Effective April 1, 2026.",
  "ny-s9077": "Extends and expands the Empire State Child Credit through 2030+. Increases credit amounts annually and raises age eligibility to include 17-year-olds. Effective: January 1, 2027.",

  // Oklahoma
  "ok-hb2229": "Oklahoma HB2229 would double the state EITC match rate from 5% to 10% of the federal credit, effective for tax year 2026.",

  // Oregon
  "or-sb1507": "One provision of Oregon state budget bill SB1507 raises the EITC match rate effective for tax year 2026. The match rate increases to 17% for families with young children (under 3) and 14% for others.",

  // Rhode Island
  "ri-s2364": "Rhode Island S2364 increases the state earned-income tax credit from 16% to 30% of the federal earned-income credit, effective for tax years beginning on or after January 1, 2027.",

  // South Carolina
  "sc-h3492": "South Carolina H.3492 makes the state EITC partially refundable (50% of the nonrefundable amount), effective for tax year 2026.",
  "sc-h4216": "South Carolina H.4216 would replace the graduated income tax structure with a flat 3.99% rate across all income levels, effective for tax year 2026.",

  // Utah
  "ut-sb60": "Utah Senate Bill 60 would reduce the state flat income tax rate from 4.5% to 4.45%.",
  "ut-hb210": "Removes marriage penalties in Utah tax credits by equalizing phase-out thresholds for single and head-of-household filers, and creates a new marriage tax credit. Effective January 1, 2026.",
  "ut-hb290": "Utah HB290 raises child tax credit phaseout thresholds effective for tax year 2026. Single/HOH increases to $49k, Joint to $61k, and MFS to $30.5k, benefiting more middle-income families.",

  // Virginia
  "va-hb12": "Removes the sunset provision on Virginia's enhanced standard deduction amounts of $8,750 (single) / $17,500 (married filing jointly). Without this bill, these amounts revert to $3,000 / $6,000 after tax year 2026.",
  "va-hb979": "Virginia HB979 proposes comprehensive income tax reform effective January 1, 2027. The bill increases standard deductions (single: $3k to $10k, joint: $6k to $20k) and adds new tax brackets for high earners (8% on income $600k-$1M, 10% on income over $1M).",

  // Wisconsin
  "wi-ab1030": "Increases Wisconsin's Earned Income Tax Credit to 34% of the federal credit for all filers with children (up from 4%/11%/34%) and creates a new 15% credit for childless filers.",

  // West Virginia
  "wv-hb4927": "West Virginia HB4927 abolishes the personal income tax by setting all bracket rates to 0% for tax years beginning after December 31, 2026.",
  "wv-sb392": "Reduces West Virginia personal income tax rates across all five brackets by approximately 10%, effective January 1, 2026. The bill lowers rates from 2.22%-4.82% to 2.00%-4.34%.",
};

export default descriptions;

export function getDescription(reformId) {
  return descriptions[reformId] || null;
}
