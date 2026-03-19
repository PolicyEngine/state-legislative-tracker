import { describe, it, expect } from "vitest";

/**
 * Tests for the availableYears derivation logic from PR #148.
 *
 * In ReformAnalyzer, availableYears is computed as:
 *   aggregateImpacts?.impactsByYear
 *     ? Object.keys(aggregateImpacts.impactsByYear).sort()
 *     : aggregateImpacts?.analysisYear
 *       ? [aggregateImpacts.analysisYear.toString()]
 *       : null
 *
 * In HouseholdForm, the fallback is:
 *   availableYears?.length > 0 ? availableYears : DEFAULT_TAX_YEARS
 */

const DEFAULT_TAX_YEARS = ["2026", "2027", "2028", "2029"];

function deriveAvailableYears(aggregateImpacts) {
  return aggregateImpacts?.impactsByYear
    ? Object.keys(aggregateImpacts.impactsByYear).sort()
    : aggregateImpacts?.analysisYear
      ? [aggregateImpacts.analysisYear.toString()]
      : null;
}

function resolveTaxYears(availableYears) {
  return availableYears?.length > 0 ? availableYears : DEFAULT_TAX_YEARS;
}

describe("availableYears derivation (ReformAnalyzer)", () => {
  it("returns sorted year keys for multi-year analyses", () => {
    const impacts = {
      impactsByYear: { "2028": {}, "2026": {}, "2027": {} },
    };
    expect(deriveAvailableYears(impacts)).toEqual(["2026", "2027", "2028"]);
  });

  it("returns single-element array for single-year analyses", () => {
    const impacts = { analysisYear: 2026 };
    expect(deriveAvailableYears(impacts)).toEqual(["2026"]);
  });

  it("converts numeric analysisYear to string", () => {
    const impacts = { analysisYear: 2029 };
    const result = deriveAvailableYears(impacts);
    expect(result).toEqual(["2029"]);
    expect(typeof result[0]).toBe("string");
  });

  it("returns null when no impact data exists", () => {
    expect(deriveAvailableYears(null)).toBeNull();
    expect(deriveAvailableYears(undefined)).toBeNull();
    expect(deriveAvailableYears({})).toBeNull();
  });

  it("prefers impactsByYear over analysisYear when both exist", () => {
    const impacts = {
      impactsByYear: { "2027": {}, "2028": {} },
      analysisYear: 2026,
    };
    expect(deriveAvailableYears(impacts)).toEqual(["2027", "2028"]);
  });
});

describe("resolveTaxYears (HouseholdForm fallback)", () => {
  it("uses provided years when available", () => {
    expect(resolveTaxYears(["2026", "2027"])).toEqual(["2026", "2027"]);
  });

  it("falls back to defaults when availableYears is null", () => {
    expect(resolveTaxYears(null)).toEqual(DEFAULT_TAX_YEARS);
  });

  it("falls back to defaults when availableYears is undefined", () => {
    expect(resolveTaxYears(undefined)).toEqual(DEFAULT_TAX_YEARS);
  });

  it("falls back to defaults when availableYears is empty array", () => {
    expect(resolveTaxYears([])).toEqual(DEFAULT_TAX_YEARS);
  });

  it("uses single-year array without falling back", () => {
    expect(resolveTaxYears(["2026"])).toEqual(["2026"]);
  });
});

describe("year sync (stale year fix)", () => {
  // Simulates the useEffect logic in HouseholdForm:
  // if selected year is not in taxYears, reset to first available
  function syncYear(currentYear, taxYears) {
    if (taxYears.length > 0 && !taxYears.includes(currentYear)) {
      return taxYears[0];
    }
    return currentYear;
  }

  it("resets year when current selection is not in available years", () => {
    expect(syncYear("2026", ["2027", "2028"])).toBe("2027");
  });

  it("keeps year when current selection is valid", () => {
    expect(syncYear("2027", ["2027", "2028"])).toBe("2027");
  });

  it("resets to first year for single-year analyses", () => {
    expect(syncYear("2026", ["2029"])).toBe("2029");
  });

  it("keeps year when using default years and 2026 is selected", () => {
    expect(syncYear("2026", DEFAULT_TAX_YEARS)).toBe("2026");
  });
});
