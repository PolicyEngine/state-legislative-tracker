import { describe, it, expect, vi } from "vitest";

vi.mock("@policyengine/ui-kit/visualization", () => ({
  loadCongressionalDistrictsGeo: vi.fn(async () => ({
    type: "FeatureCollection",
    features: [
      { properties: { DISTRICT_ID: "TX-01", CDSESSN: "119" } },
      { properties: { DISTRICT_ID: "TX-35", CDSESSN: "119" } },
      { properties: { DISTRICT_ID: "TN-09", CDSESSN: "119" } },
    ],
  })),
}));

import {
  DEFAULT_DISTRICT_CONGRESS,
  congressLabel,
  districtCongressOf,
  districtNumberOf,
  filterStateDistricts,
  isAtLarge,
  loadStateDistrictsGeo,
  ordinal,
} from "./districtGeo";

describe("districtCongressOf", () => {
  it("defaults untagged analyses to the 119th Congress", () => {
    expect(DEFAULT_DISTRICT_CONGRESS).toBe(119);
    expect(districtCongressOf(undefined, null)).toBe(119);
    expect(districtCongressOf({ modelNotes: {} }, null)).toBe(119);
  });

  it("reads the root tag from model_notes", () => {
    expect(districtCongressOf({ modelNotes: { district_congress: 120 } }, null)).toBe(120);
  });

  it("reads a year's own tag and does not borrow the root tag", () => {
    const impacts = {
      modelNotes: { district_congress: 120 },
      impactsByYear: { 2026: {}, 2027: { districtCongress: 120 } },
    };
    expect(districtCongressOf(impacts, "2026")).toBe(119);
    expect(districtCongressOf(impacts, "2027")).toBe(120);
  });
});

describe("labels", () => {
  it("writes ordinals", () => {
    expect(ordinal(119)).toBe("119th");
    expect(ordinal(120)).toBe("120th");
    expect(ordinal(121)).toBe("121st");
    expect(ordinal(111)).toBe("111th");
  });

  it("dates the 120th Congress label", () => {
    expect(congressLabel(119)).toBe("119th Congress districts");
    expect(congressLabel(120)).toBe("120th Congress districts (from January 3, 2027)");
  });
});

describe("districtNumberOf", () => {
  it("parses ui-kit DISTRICT_IDs", () => {
    expect(districtNumberOf({ DISTRICT_ID: "TX-05" })).toBe(5);
    expect(districtNumberOf({ DISTRICT_ID: "CA-52" })).toBe(52);
  });

  it("falls back to the Census district code", () => {
    expect(districtNumberOf({ CD119FP: "07" })).toBe(7);
    expect(districtNumberOf({ CD120FP: "00" })).toBe(0);
    expect(districtNumberOf({})).toBeNull();
  });

  it("spots at-large districts", () => {
    expect(isAtLarge({ NAMELSAD: "Congressional District (at Large)" })).toBe(true);
    expect(isAtLarge({ NAMELSAD: "Congressional District 4" })).toBe(false);
  });
});

describe("filterStateDistricts", () => {
  const geo = {
    features: [
      { properties: { DISTRICT_ID: "TN-01", CDSESSN: "120" } },
      { properties: { DISTRICT_ID: "TX-01", CDSESSN: "120" } },
    ],
  };

  it("keeps only the state's districts", () => {
    const out = filterStateDistricts(geo, "TN", 120);
    expect(out.features.map((f) => f.properties.DISTRICT_ID)).toEqual(["TN-01"]);
  });

  it("rejects a file from a different Congress", () => {
    expect(() => filterStateDistricts(geo, "TN", 119)).toThrow(/119th.*120th/);
  });
});

describe("loadStateDistrictsGeo", () => {
  it("loads one state's 119th districts", async () => {
    const out = await loadStateDistrictsGeo("TX", 119);
    expect(out.features.map((f) => f.properties.DISTRICT_ID)).toEqual(["TX-01", "TX-35"]);
  });

  it("refuses a Congress the installed ui-kit cannot draw", async () => {
    await expect(loadStateDistrictsGeo("TX", 120)).rejects.toThrow(/no 120th Congress/);
  });
});
