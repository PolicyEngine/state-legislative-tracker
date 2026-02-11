/**
 * Analysis descriptions for reforms in the state legislative tracker.
 *
 * This file contains the provisions and model notes for each reform,
 * allowing version control and easier editing of these descriptions.
 *
 * Structure:
 * - description: Short summary of the bill (1-2 sentences)
 * - provisions: Array of policy changes being modeled
 *   - label: Display name of the provision
 *   - baseline: Current law value
 *   - reform: Proposed value
 *   - explanation: Description of the change
 *   - changes: (optional) Sub-changes for multi-value provisions
 *   - parameter: (optional) PolicyEngine parameter path
 *
 * - modelNotes: Object with analysis metadata
 *   - analysisYear: The tax year being analyzed
 *   - effectiveDate: (optional) When the policy takes effect
 *   - note: (optional) Additional context
 *   - sponsor: (optional) Bill sponsor with party affiliation
 */

const analysisDescriptions = {
  // Utah
  "ut-sb60": {
    description: "Reduces Utah's flat income tax rate from 4.5% to 4.45%, providing broad-based tax relief. Effective: January 1, 2026.",
    provisions: [
      {
        label: "Utah Income Tax Rate",
        baseline: "4.5%",
        reform: "4.45%",
        parameter: "gov.states.ut.tax.income.rate",
        explanation: "Reduces Utah's flat income tax rate from 4.5% to 4.45%, providing broad-based tax relief across all income levels."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Sen. Lincoln Fillmore (R)"
    }
  },

  "ut-hb210": {
    description: "Creates a new marriage tax credit and adjusts phase-out thresholds for multiple credits to reduce marriage penalties in Utah's tax code. Effective: January 1, 2026.",
    provisions: [
      {
        label: "Marriage Tax Credit",
        baseline: "None",
        reform: "$79-$158",
        changes: [
          { label: "Joint filers", baseline: "None", reform: "$158" },
          { label: "Surviving spouse", baseline: "None", reform: "$158" },
          { label: "Married filing separately", baseline: "None", reform: "$79" }
        ],
        explanation: "Establishes a new nonrefundable marriage tax credit for married filers with income below $90,000 (joint) or $45,000 (married filing separately)."
      },
      {
        label: "Child Tax Credit Phase-out",
        baseline: "$43,000",
        reform: "$27,000",
        changes: [
          { label: "Single filers", baseline: "$43,000", reform: "$27,000" },
          { label: "Head of household", baseline: "$43,000", reform: "$27,000" }
        ],
        explanation: "Adjusts the Child Tax Credit phase-out threshold to equal half of the $54,000 joint threshold, ensuring equitable treatment across filing statuses."
      },
      {
        label: "Taxpayer Credit Phase-out",
        baseline: "$27,320",
        reform: "$18,626",
        changes: [
          { label: "Head of household", baseline: "$27,320", reform: "$18,626" }
        ],
        explanation: "Aligns the taxpayer credit phase-out threshold for head-of-household filers with the threshold applicable to single filers."
      },
      {
        label: "Retirement Credit Phase-out",
        baseline: "$25,000-$32,000",
        reform: "$16,000",
        changes: [
          { label: "Single filers", baseline: "$25,000", reform: "$16,000" },
          { label: "Head of household", baseline: "$32,000", reform: "$16,000" }
        ],
        explanation: "Sets the retirement credit phase-out threshold at half of the $32,000 joint threshold for single and head-of-household filers."
      },
      {
        label: "Social Security Benefits Credit Phase-out",
        baseline: "$54,000-$90,000",
        reform: "$45,000",
        changes: [
          { label: "Single filers", baseline: "$54,000", reform: "$45,000" },
          { label: "Head of household", baseline: "$90,000", reform: "$45,000" }
        ],
        explanation: "Standardizes the Social Security benefits credit phase-out threshold at half of the $90,000 joint threshold."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      effectiveDate: "January 1, 2026",
      note: "Substitute 2 version. Key change from original: EITC remains at 20% (not repealed), new marriage credit replaces taxpayer credit add-on.",
      sponsor: "Rep. Melissa Garff Ballard (R)"
    }
  },

  "ut-hb290": {
    description: "Expands Utah's Child Tax Credit by raising the income phase-out thresholds for all filing statuses. Effective: January 1, 2026.",
    provisions: [
      {
        label: "Child Tax Credit Phase-out Thresholds",
        baseline: "$43,000-$54,000",
        reform: "$49,000-$61,000",
        changes: [
          { label: "Single filers", baseline: "$43,000", reform: "$49,000" },
          { label: "Head of household", baseline: "$43,000", reform: "$49,000" },
          { label: "Joint filers", baseline: "$54,000", reform: "$61,000" },
          { label: "Surviving spouse", baseline: "$54,000", reform: "$61,000" },
          { label: "Married filing separately", baseline: "$27,000", reform: "$30,500" }
        ],
        explanation: "Raises the income thresholds at which Utah's Child Tax Credit begins to phase out, expanding eligibility to additional middle-income families."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Rep. Tracy Miller (R)"
    }
  },

  // Oklahoma
  "ok-hb2229": {
    description: "Doubles Oklahoma's state Earned Income Tax Credit from 5% to 10% of the federal EITC. Effective: Tax year 2026.",
    provisions: [
      {
        label: "Oklahoma State EITC",
        baseline: "5% of federal EITC",
        reform: "10% of federal EITC",
        parameter: "gov.states.ok.tax.income.credits.earned_income.eitc_fraction",
        explanation: "Doubles Oklahoma's state Earned Income Tax Credit from 5% to 10% of the federal EITC, providing increased support for low- and moderate-income working families."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Rep. Cyndi Munson (D)",
      billUrl: "https://www.oklegislature.gov/cf_pdf/2025-26%20INT/hB/HB2229%20INT.PDF"
    }
  },

  // Oregon
  "or-sb1507": {
    description: "Increases Oregon's EITC match rate from 9-12% to 14-17% of the federal credit, with enhanced benefits for families with young children. Governor's budget proposal.",
    provisions: [
      {
        label: "Oregon EITC Match Rate",
        baseline: "9%-12%",
        reform: "14%-17%",
        changes: [
          { label: "Families with young child (under 3)", baseline: "12%", reform: "17%" },
          { label: "All other filers", baseline: "9%", reform: "14%" }
        ],
        explanation: "Increases Oregon's EITC match rate as a percentage of the federal Earned Income Tax Credit, with enhanced benefits for families with children under age 3."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      note: "Governor's budget proposal"
    }
  },

  // South Carolina
  "sc-h3492": {
    description: "Makes South Carolina's Earned Income Tax Credit fully refundable, allowing filers to receive the difference as a refund if their credit exceeds tax liability.",
    provisions: [
      {
        label: "SC EITC Refundability",
        baseline: "Non-refundable",
        reform: "Fully refundable",
        parameter: "gov.contrib.states.sc.h3492.in_effect",
        explanation: "Converts South Carolina's Earned Income Tax Credit from non-refundable to fully refundable, enabling filers whose credit exceeds their tax liability to receive the difference as a refund."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Reps. Gilda Cobb-Hunter (D) and Roger Kirby (D)"
    }
  },

  "sc-h4216": {
    description: "Establishes a flat 3.99% income tax rate in South Carolina, reducing the top rate from 6.2% while increasing the second bracket rate from 3%.",
    provisions: [
      {
        label: "SC Income Tax Rate (Bracket 2)",
        baseline: "3%",
        reform: "3.99%",
        parameter: "gov.states.sc.tax.income.rates.brackets[1].rate",
        explanation: "Increases the second income tax bracket rate from 3% to 3.99% as part of a transition to a flat tax structure."
      },
      {
        label: "SC Income Tax Rate (Top Bracket)",
        baseline: "6.2%",
        reform: "3.99%",
        parameter: "gov.states.sc.tax.income.rates.brackets[2].rate",
        explanation: "Reduces the top income tax bracket rate from 6.2% to 3.99%, establishing a flat tax rate across brackets."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Rep. Bruce Bannister (R)"
    }
  },

  // Virginia
  "va-hb979": {
    description: "More than triples Virginia's standard deduction and adds new tax brackets of 8% and 10% for high earners above $600,000. Effective: Tax year 2027.",
    provisions: [
      {
        label: "Standard Deduction Increase",
        baseline: "$3,000-$6,000",
        reform: "$10,000-$20,000",
        changes: [
          { label: "Single filers", baseline: "$3,000", reform: "$10,000" },
          { label: "Married filing separately", baseline: "$3,000", reform: "$10,000" },
          { label: "Surviving spouse", baseline: "$3,000", reform: "$10,000" },
          { label: "Head of household", baseline: "$3,000", reform: "$15,000" },
          { label: "Joint filers", baseline: "$6,000", reform: "$20,000" }
        ],
        explanation: "More than triples Virginia's standard deduction amounts, providing tax relief primarily to lower- and middle-income households."
      },
      {
        label: "High-Earner Tax Brackets",
        baseline: "5.75% top rate",
        reform: "8% / 10% top rates",
        changes: [
          { label: "Income $600k-$1M", baseline: "5.75%", reform: "8%" },
          { label: "Income over $1M", baseline: "5.75%", reform: "10%" }
        ],
        explanation: "Establishes two new tax brackets for high earners: 8% on taxable income between $600,000 and $1 million, and 10% on income exceeding $1 million."
      }
    ],
    modelNotes: {
      analysisYear: 2027,
      sponsor: "Del. Vivian Watts (D)"
    }
  },

  // New York
  "ny-s4487": {
    description: "Creates a new $1,000 refundable supplemental credit for each qualifying newborn (ages 0-1), in addition to the existing Empire State Child Credit.",
    provisions: [
      {
        label: "Supplemental Empire State Child Credit for Newborns",
        baseline: "Not in effect",
        reform: "$1,000 per newborn (ages 0-1)",
        parameter: "gov.contrib.states.ny.s04487.in_effect",
        explanation: "Creates a new $1,000 refundable supplemental credit for each qualifying newborn (child born in the current or previous tax year, ages 0-1), provided in addition to the existing Empire State Child Credit."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Sen. Jacob Ashby (R)"
    }
  },

  "ny-s9077": {
    description: "Extends and expands the Empire State Child Credit through 2030+. Increases credit amounts annually and raises age eligibility to include 17-year-olds. Effective: January 1, 2027.",
    provisions: [
      {
        label: "Extend Enhanced ESCC Structure",
        baseline: "Expires 2027",
        reform: "Extended permanently",
        explanation: "Extends the post-2024 Empire State Child Credit structure beyond 2027, preserving the enhanced credit amounts and expanded eligibility."
      },
      {
        label: "Credit for Young Children (Ages 0-3)",
        baseline: "$1,000",
        reform: "$1,500",
        explanation: "Phases in credit increases from $1,000 (2026) to $1,150 (2027), $1,300 (2028), and $1,500 (2029 and thereafter)."
      },
      {
        label: "Credit for Older Children (Ages 4-16)",
        baseline: "$500",
        reform: "$1,500",
        explanation: "Phases in credit increases from $500 (2026) to $750 (2027), $1,000 (2028), $1,250 (2029), and $1,500 (2030 and thereafter)."
      },
      {
        label: "Age Eligibility",
        baseline: "Under 17",
        reform: "Under 18",
        explanation: "Expands eligibility to include 17-year-olds in the Empire State Child Credit."
      }
    ],
    modelNotes: {
      analysisYear: 2031,
      note: "Multi-year analysis showing impacts from 2027-2031 as credit amounts phase in.",
      sponsor: "Sen. Andrew Gounardes (D)"
    }
  }
};

export default analysisDescriptions;

/**
 * Get provisions for a specific reform
 * @param {string} reformId - The reform ID (e.g., "ut-sb60")
 * @returns {Array} Array of provisions or empty array if not found
 */
export function getProvisions(reformId) {
  return analysisDescriptions[reformId]?.provisions || [];
}

/**
 * Get model notes for a specific reform
 * @param {string} reformId - The reform ID (e.g., "ut-sb60")
 * @returns {Object} Model notes object or empty object if not found
 */
export function getModelNotes(reformId) {
  return analysisDescriptions[reformId]?.modelNotes || {};
}

/**
 * Get description for a specific reform
 * @param {string} reformId - The reform ID (e.g., "ut-sb60")
 * @returns {string} Description or empty string if not found
 */
export function getDescription(reformId) {
  return analysisDescriptions[reformId]?.description || '';
}

/**
 * Check if a reform has descriptions defined
 * @param {string} reformId - The reform ID
 * @returns {boolean} True if descriptions exist for this reform
 */
export function hasDescriptions(reformId) {
  return reformId in analysisDescriptions;
}
