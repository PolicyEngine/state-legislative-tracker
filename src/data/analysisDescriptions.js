/**
 * Analysis descriptions for reforms in the state legislative tracker.
 *
 * This file contains the provisions and model notes for each reform,
 * allowing version control and easier editing of these descriptions.
 *
 * Structure:
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
 */

const analysisDescriptions = {
  // Utah
  "ut-sb60": {
    provisions: [
      {
        label: "Utah Income Tax Rate",
        baseline: "4.5%",
        reform: "4.45%",
        parameter: "gov.states.ut.tax.income.rate",
        explanation: "Changes Utah's flat income tax rate from 4.5% to 4.45%."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  "ut-hb210": {
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
        explanation: "Creates a new nonrefundable marriage tax credit for married filers. Income limit of $90,000 (joint) or $45,000 (MFS)."
      },
      {
        label: "Child Tax Credit Phase-out",
        baseline: "$43,000",
        reform: "$27,000",
        changes: [
          { label: "Single filers", baseline: "$43,000", reform: "$27,000" },
          { label: "Head of household", baseline: "$43,000", reform: "$27,000" }
        ],
        explanation: "Changes the CTC phase-out start to equal half the $54,000 joint threshold."
      },
      {
        label: "Taxpayer Credit Phase-out",
        baseline: "$27,320",
        reform: "$18,626",
        changes: [
          { label: "Head of household", baseline: "$27,320", reform: "$18,626" }
        ],
        explanation: "Changes the taxpayer credit phase-out threshold for head-of-household filers to match single filers."
      },
      {
        label: "Retirement Credit Phase-out",
        baseline: "$25,000-$32,000",
        reform: "$16,000",
        changes: [
          { label: "Single filers", baseline: "$25,000", reform: "$16,000" },
          { label: "Head of household", baseline: "$32,000", reform: "$16,000" }
        ],
        explanation: "Changes the retirement credit phase-out threshold to equal half the $32,000 joint threshold."
      },
      {
        label: "Social Security Benefits Credit Phase-out",
        baseline: "$54,000-$90,000",
        reform: "$45,000",
        changes: [
          { label: "Single filers", baseline: "$54,000", reform: "$45,000" },
          { label: "Head of household", baseline: "$90,000", reform: "$45,000" }
        ],
        explanation: "Changes the SS benefits credit phase-out threshold to equal half the $90,000 joint threshold."
      }
    ],
    modelNotes: {
      analysisYear: 2026,
      effectiveDate: "January 1, 2026",
      note: "Substitute 2 version. Key change from original: EITC stays at 20% (not repealed), new marriage credit replaces taxpayer credit add-on."
    }
  },

  "ut-hb290": {
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
        explanation: "Increases the income thresholds at which Utah's Child Tax Credit begins to phase out for all filing statuses."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  // Oklahoma
  "ok-hb2229": {
    provisions: [
      {
        label: "Oklahoma State EITC",
        baseline: "5% of federal EITC",
        reform: "10% of federal EITC",
        parameter: "gov.states.ok.tax.income.credits.earned_income.eitc_fraction",
        explanation: "Doubles Oklahoma's state Earned Income Tax Credit from 5% to 10% of the federal EITC."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  // Oregon
  "or-sb1507": {
    provisions: [
      {
        label: "Oregon EITC Match Rate",
        baseline: "9%-12%",
        reform: "14%-17%",
        changes: [
          { label: "Families with young child (under 3)", baseline: "12%", reform: "17%" },
          { label: "All other filers", baseline: "9%", reform: "14%" }
        ],
        explanation: "Increases Oregon's EITC match rate as a percentage of the federal Earned Income Tax Credit."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  // South Carolina
  "sc-h3492": {
    provisions: [
      {
        label: "SC EITC Refundability",
        baseline: "Non-refundable",
        reform: "Fully refundable",
        parameter: "gov.contrib.states.sc.h3492.in_effect",
        explanation: "Changes the South Carolina EITC from non-refundable to fully refundable. Filers whose credit exceeds their tax liability would receive the difference as a refund."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  "sc-h4216": {
    provisions: [
      {
        label: "SC Income Tax Rate (Bracket 2)",
        baseline: "3%",
        reform: "3.99%",
        parameter: "gov.states.sc.tax.income.rates.brackets[1].rate",
        explanation: "Changes the second income tax bracket rate from 3% to 3.99%."
      },
      {
        label: "SC Income Tax Rate (Top Bracket)",
        baseline: "6.2%",
        reform: "3.99%",
        parameter: "gov.states.sc.tax.income.rates.brackets[2].rate",
        explanation: "Changes the top income tax bracket rate from 6.2% to 3.99%, creating a single rate across brackets."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  // Virginia
  "va-hb979": {
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
        explanation: "Triples Virginia standard deduction amounts, primarily benefiting lower and middle income households."
      },
      {
        label: "High-Earner Tax Brackets",
        baseline: "5.75% top rate",
        reform: "8% / 10% top rates",
        changes: [
          { label: "Income $600k-$1M", baseline: "5.75%", reform: "8%" },
          { label: "Income over $1M", baseline: "5.75%", reform: "10%" }
        ],
        explanation: "Adds new tax brackets for high earners: 8% on income between $600,000 and $1 million, and 10% on income over $1 million."
      }
    ],
    modelNotes: {
      analysisYear: 2027
    }
  },

  // New York
  "ny-s4487": {
    provisions: [
      {
        label: "NY S04487 Newborn Credit",
        baseline: "Not in effect",
        reform: "$1,000 per newborn (ages 0-1)",
        parameter: "gov.contrib.states.ny.s04487.in_effect",
        explanation: "Creates a new $1,000 refundable supplemental credit for each qualifying newborn (child born in current or previous tax year, ages 0-1). This is in addition to the existing Empire State Child Credit."
      }
    ],
    modelNotes: {
      analysisYear: 2026
    }
  },

  "ny-s9077": {
    provisions: [
      {
        label: "Extend Enhanced ESCC Structure",
        baseline: "Expires 2027",
        reform: "Extends permanently",
        explanation: "Extends the post-2024 Empire State Child Credit structure beyond 2027"
      },
      {
        label: "Credit for Young Children (Ages 0-3)",
        baseline: "$1,000",
        reform: "$1,500",
        explanation: "Increases from $1,000 (2026) to $1,150 (2027), $1,300 (2028), $1,500 (2029+)"
      },
      {
        label: "Credit for Older Children (Ages 4-16)",
        baseline: "$500",
        reform: "$1,500",
        explanation: "Increases from $500 (2026) to $750 (2027), $1,000 (2028), $1,250 (2029), $1,500 (2030+)"
      },
      {
        label: "Age Eligibility",
        baseline: "Under 17",
        reform: "Under 18",
        explanation: "Raises the age cap to include 17-year-olds in the credit"
      }
    ],
    modelNotes: {
      analysisYear: 2031,
      note: "Multi-year analysis showing impacts from 2027-2031 as credit amounts phase in"
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
 * Check if a reform has descriptions defined
 * @param {string} reformId - The reform ID
 * @returns {boolean} True if descriptions exist for this reform
 */
export function hasDescriptions(reformId) {
  return reformId in analysisDescriptions;
}
