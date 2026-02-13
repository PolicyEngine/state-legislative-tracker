/**
 * Analysis descriptions for reforms in the state legislative tracker.
 *
 * This file contains the main description and model notes for each reform,
 * allowing version control and easier editing of these descriptions.
 *
 * Structure:
 * - description: Short summary of the bill (1-2 sentences)
 * - modelNotes: Object with analysis metadata
 *   - analysisYear: The tax year being analyzed
 *   - effectiveDate: (optional) When the policy takes effect
 *   - note: (optional) Additional context
 *   - sponsor: (optional) Bill sponsor with party affiliation
 *
 * Note: Provisions (What We Model details) are stored in Supabase.
 */

const analysisDescriptions = {
  // Utah
  "ut-sb60": {
    description: "Reduces Utah's flat income tax rate from 4.5% to 4.45%, providing broad-based tax relief. Effective: January 1, 2026.",
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Sen. Lincoln Fillmore (R)"
    }
  },

  "ut-hb210": {
    description: "Creates a new marriage tax credit and adjusts phase-out thresholds for multiple credits to reduce marriage penalties in Utah's tax code. Effective: January 1, 2026.",
    modelNotes: {
      analysisYear: 2026,
      effectiveDate: "January 1, 2026",
      note: "Substitute 2 version. Key change from original: EITC remains at 20% (not repealed), new marriage credit replaces taxpayer credit add-on.",
      sponsor: "Rep. Melissa Garff Ballard (R)"
    }
  },

  "ut-hb290": {
    description: "Expands Utah's Child Tax Credit by raising the income phase-out thresholds for all filing statuses. Effective: January 1, 2026.",
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Rep. Tracy Miller (R)"
    }
  },

  // Oklahoma
  "ok-hb2229": {
    description: "Doubles Oklahoma's state Earned Income Tax Credit from 5% to 10% of the federal EITC. Effective: Tax year 2026.",
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Rep. Cyndi Munson (D)",
      billUrl: "https://www.oklegislature.gov/cf_pdf/2025-26%20INT/hB/HB2229%20INT.PDF"
    }
  },

  // Oregon
  "or-sb1507": {
    description: "Increases Oregon's EITC match rate from 9-12% to 14-17% of the federal credit, with enhanced benefits for families with young children. Governor's budget proposal.",
    modelNotes: {
      analysisYear: 2026,
      note: "Governor's budget proposal"
    }
  },

  // South Carolina
  "sc-h3492": {
    description: "Makes South Carolina's Earned Income Tax Credit fully refundable, allowing filers to receive the difference as a refund if their credit exceeds tax liability.",
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Reps. Gilda Cobb-Hunter (D) and Roger Kirby (D)"
    }
  },

  "sc-h4216": {
    description: "Establishes a flat 3.99% income tax rate in South Carolina, reducing the top rate from 6.2% while increasing the second bracket rate from 3%.",
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Rep. Bruce Bannister (R)"
    }
  },

  // Virginia
  "va-hb979": {
    description: "More than triples Virginia's standard deduction and adds new tax brackets of 8% and 10% for high earners above $600,000. Effective: Tax year 2027.",
    modelNotes: {
      analysisYear: 2027,
      sponsor: "Del. Vivian Watts (D)"
    }
  },

  // New York
  "ny-s4487": {
    description: "Creates a new $1,000 refundable supplemental credit for each qualifying newborn (ages 0-1), in addition to the existing Empire State Child Credit.",
    modelNotes: {
      analysisYear: 2026,
      sponsor: "Sen. Jacob Ashby (R)"
    }
  },

  "ny-s9077": {
    description: "Extends and expands the Empire State Child Credit through 2030+. Increases credit amounts annually and raises age eligibility to include 17-year-olds. Effective: January 1, 2027.",
    modelNotes: {
      analysisYear: 2031,
      note: "Multi-year analysis showing impacts from 2027-2031 as credit amounts phase in.",
      sponsor: "Sen. Andrew Gounardes (D)"
    }
  }
};

export default analysisDescriptions;

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
