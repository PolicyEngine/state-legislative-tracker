import { describe, it, expect, vi } from "vitest";

// Like ui-kit 0.15: 119 or 120 returns that Congress's file, and anything else
// falls back to the 119th.
vi.mock("@policyengine/ui-kit/visualization", () => ({
  loadCongressionalDistrictsGeo: vi.fn(async (congress = 119) => {
    const session = String(congress) === "120" ? "120" : "119";
    return {
      type: "FeatureCollection",
      features: [
        { properties: { DISTRICT_ID: "TX-01", CDSESSN: session } },
        { properties: { DISTRICT_ID: "TX-35", CDSESSN: session } },
        { properties: { DISTRICT_ID: "TN-09", CDSESSN: session } },
      ],
    };
  }),
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
  rewindIfInverted,
} from "./districtGeo";
import { geoArea } from "d3-geo";

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

  it("loads one state's 120th districts", async () => {
    const out = await loadStateDistrictsGeo("TX", 120);
    expect(out.features.map((f) => f.properties.CDSESSN)).toEqual(["120", "120"]);
  });

  it("refuses a Congress the installed ui-kit cannot draw", async () => {
    await expect(loadStateDistrictsGeo("TX", 118)).rejects.toThrow(/no 118th Congress/);
  });
});

describe("rewindIfInverted", () => {
  // A one-degree square near Austin, wound clockwise as d3-geo expects.
  const ring = [[-98, 30], [-98, 31], [-97, 31], [-97, 30], [-98, 30]];
  const feature = (coordinates, type = "Polygon") => ({
    type: "Feature",
    properties: { DISTRICT_ID: "TX-10", CDSESSN: "120" },
    geometry: { type, coordinates },
  });

  it("leaves a correctly wound feature unchanged", () => {
    const ok = feature([ring]);
    expect(geoArea(ok)).toBeLessThan(2 * Math.PI);
    expect(rewindIfInverted(ok)).toBe(ok);
  });

  it("rewinds inverted polygons and multipolygons", () => {
    const inverted = feature([[...ring].reverse()]);
    expect(geoArea(inverted)).toBeGreaterThan(2 * Math.PI);
    expect(geoArea(rewindIfInverted(inverted))).toBeLessThan(2 * Math.PI);

    const invertedMulti = feature([[[...ring].reverse()]], "MultiPolygon");
    expect(geoArea(rewindIfInverted(invertedMulti))).toBeLessThan(2 * Math.PI);
  });

  it("is applied when a state's districts are filtered", () => {
    const geo = { type: "FeatureCollection", features: [feature([[...ring].reverse()])] };
    const { features } = filterStateDistricts(geo, "TX", 120);
    expect(geoArea(features[0])).toBeLessThan(2 * Math.PI);
  });
});
