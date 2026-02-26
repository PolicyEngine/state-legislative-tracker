import { describe, it, expect } from "vitest";
import { buildApiPolicy, compareSemver, reformNeedsStructuralCode } from "./usePolicyEngineAPI";

describe("buildApiPolicy", () => {
  it("strips _use_reform and _skip_params from reform params", () => {
    const reform = {
      _use_reform: "ut_hb210_s2",
      _skip_params: ["gov.states.ut.tax.income"],
      "gov.states.ut.tax.income.rate": { "2026-01-01.2100-12-31": 0.0445 },
    };

    const policy = buildApiPolicy(reform);

    expect(policy).not.toHaveProperty("_use_reform");
    expect(policy).not.toHaveProperty("_skip_params");
    expect(policy).toHaveProperty("gov.states.ut.tax.income.rate");
  });

  it("strips any underscore-prefixed internal key", () => {
    const reform = {
      _some_future_internal_key: "value",
      "gov.states.ct.tax.income.rate": { "2026": 0.05 },
    };

    const policy = buildApiPolicy(reform);

    expect(Object.keys(policy)).toEqual(["gov.states.ct.tax.income.rate"]);
  });

  it("converts bare year keys to date ranges", () => {
    const reform = {
      "gov.states.ga.tax.income.rate": { "2026": 0.05 },
    };

    const policy = buildApiPolicy(reform);

    expect(policy["gov.states.ga.tax.income.rate"]).toEqual({
      "2026-01-01.2100-12-31": 0.05,
    });
  });

  it("passes through explicit date range keys unchanged", () => {
    const reform = {
      "gov.states.ct.tax.income.rate": {
        "2026-01-01.2026-12-31": 0.05,
      },
    };

    const policy = buildApiPolicy(reform);

    expect(policy["gov.states.ct.tax.income.rate"]).toEqual({
      "2026-01-01.2026-12-31": 0.05,
    });
  });

  it("converts date-only keys to date ranges matching microsim", () => {
    const reform = {
      "gov.contrib.states.ct.refundable_ctc.in_effect": {
        "2026-01-01": true,
      },
    };

    const policy = buildApiPolicy(reform);

    // Microsim treats "2026-01-01" as start=2026-01-01, stop=2100-12-31
    expect(
      policy["gov.contrib.states.ct.refundable_ctc.in_effect"]
    ).toEqual({
      "2026-01-01.2100-12-31": true,
    });
  });

  it("converts .brackets[N] to [N] in parameter paths", () => {
    const reform = {
      "gov.states.ga.tax.income.main.single.brackets[0].rate": {
        "2026": 0.01,
      },
      "gov.states.ga.tax.income.main.single.brackets[2].threshold": {
        "2026": 10000,
      },
    };

    const policy = buildApiPolicy(reform);

    expect(policy).toHaveProperty(
      "gov.states.ga.tax.income.main.single[0].rate"
    );
    expect(policy).toHaveProperty(
      "gov.states.ga.tax.income.main.single[2].threshold"
    );
    expect(policy).not.toHaveProperty(
      "gov.states.ga.tax.income.main.single.brackets[0].rate"
    );
  });

  it("only sends actual PE parameter paths for a reform with _use_reform", () => {
    // This is the exact pattern that caused the CT refundable CTC 500 error:
    // _use_reform and _skip_params leaked through to the API payload
    const reform = {
      _use_reform: "some_contrib_reform",
      _skip_params: ["gov.contrib.states.ct.refundable_ctc"],
      "gov.contrib.states.ct.refundable_ctc.in_effect": {
        "2026-01-01.2100-12-31": true,
      },
      "gov.states.ct.tax.income.credits.ctc.amount": {
        "2026-01-01.2100-12-31": 600,
      },
    };

    const policy = buildApiPolicy(reform);

    // Internal keys must not appear
    expect(Object.keys(policy).every((k) => !k.startsWith("_"))).toBe(true);
    // Actual params pass through
    expect(policy).toHaveProperty(
      "gov.contrib.states.ct.refundable_ctc.in_effect"
    );
    expect(policy).toHaveProperty(
      "gov.states.ct.tax.income.credits.ctc.amount"
    );
  });

  it("returns empty object for reform with only internal keys", () => {
    const reform = {
      _use_reform: "some_reform",
      _skip_params: [],
    };

    const policy = buildApiPolicy(reform);

    expect(policy).toEqual({});
  });
});

describe("compareSemver", () => {
  it("returns -1 when a < b", () => {
    expect(compareSemver("1.562.3", "1.584.0")).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(compareSemver("1.584.0", "1.562.3")).toBe(1);
  });

  it("returns 0 when equal", () => {
    expect(compareSemver("1.584.0", "1.584.0")).toBe(0);
  });

  it("compares major version first", () => {
    expect(compareSemver("2.0.0", "1.999.999")).toBe(1);
  });

  it("compares minor version second", () => {
    expect(compareSemver("1.100.0", "1.99.0")).toBe(1);
  });
});

describe("reformNeedsStructuralCode", () => {
  it("returns true for reforms with contrib paths", () => {
    expect(reformNeedsStructuralCode({
      "gov.contrib.states.ct.refundable_ctc.in_effect": { "2026-01-01": true },
    })).toBe(true);
  });

  it("returns true for reforms with _use_reform", () => {
    expect(reformNeedsStructuralCode({
      _use_reform: "ut_hb210_s2",
      "gov.states.ut.tax.income.rate": { "2026": 0.0445 },
    })).toBe(true);
  });

  it("returns false for purely parametric reforms", () => {
    expect(reformNeedsStructuralCode({
      "gov.states.ga.tax.income.main.single.brackets[0].rate": { "2026": 0.01 },
      "gov.states.ga.tax.income.main.single.brackets[0].threshold": { "2026": 0 },
    })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(reformNeedsStructuralCode(null)).toBe(false);
    expect(reformNeedsStructuralCode(undefined)).toBe(false);
  });
});
