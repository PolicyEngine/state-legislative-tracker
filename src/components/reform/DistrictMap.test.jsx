import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

let mockImpacts = null;
// The boundary file the loader returns; null makes the load fail.
let mockGeo = null;
vi.mock("../../context/DataContext", () => ({
  useData: () => ({ getImpact: () => mockImpacts }),
}));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@policyengine/ui-kit/visualization", () => ({
  loadCongressionalDistrictsGeo: vi.fn(async () => {
    if (!mockGeo) throw new Error("boundary file failed to load");
    return mockGeo;
  }),
}));

import { loadCongressionalDistrictsGeo } from "@policyengine/ui-kit/visualization";
import DistrictMap, { CardBasedDistrictView } from "./DistrictMap";

beforeEach(() => {
  mockGeo = null;
  loadCongressionalDistrictsGeo.mockClear();
});

const results = (state, count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`${state}-${i + 1}`, { avgBenefit: (i + 1) * 10 }])
  );

// One-degree squares in a row, wound clockwise as d3-geo expects.
const boundaries = (state, count, session) => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => {
    const x = -88 + i;
    return {
      type: "Feature",
      properties: {
        DISTRICT_ID: `${state}-${String(i + 1).padStart(2, "0")}`,
        CDSESSN: session,
        NAMELSAD: `Congressional District ${i + 1}`,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[x, 32], [x, 33], [x + 1, 33], [x + 1, 32], [x, 32]]],
      },
    };
  }),
});

describe("district map for the 120th Congress", () => {
  it("draws the 120th boundaries for an analysis tagged 120", async () => {
    mockGeo = boundaries("AL", 7, "120");
    mockImpacts = { districtImpacts: results("AL", 7), modelNotes: { district_congress: 120 } };
    render(<DistrictMap stateAbbr="AL" reformId="al-test" />);
    await waitFor(() => expect(screen.queryByText("Loading map...")).not.toBeInTheDocument());
    expect(loadCongressionalDistrictsGeo).toHaveBeenCalledWith(120);
    expect(screen.queryByText(/listed by district/)).not.toBeInTheDocument();
    expect(screen.getByText(/120th Congress districts \(from January 3, 2027\)/)).toBeInTheDocument();
    expect(await screen.findByText(/Click on a district/)).toBeInTheDocument();
  });
});

describe("district results without a drawable map", () => {
  it("lists Alabama's districts when the analysis is tagged with a Congress the app can't draw", async () => {
    mockGeo = boundaries("AL", 7, "119");
    mockImpacts = { districtImpacts: results("AL", 7), modelNotes: { district_congress: 121 } };
    render(<DistrictMap stateAbbr="AL" reformId="al-test" />);
    expect(await screen.findByText("District 7")).toBeInTheDocument();
    expect(screen.getByText(/121st Congress aren't available in this app yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Click on a district/)).not.toBeInTheDocument();
    expect(loadCongressionalDistrictsGeo).not.toHaveBeenCalled();
  });

  it("lists every North Carolina district when the 120th map fails to load", async () => {
    mockImpacts = { districtImpacts: results("NC", 14), modelNotes: { district_congress: 120 } };
    render(<DistrictMap stateAbbr="NC" reformId="nc-test" />);
    expect(await screen.findByText("District 14")).toBeInTheDocument();
    expect(screen.getByText(/The district map didn't load/)).toBeInTheDocument();
    expect(screen.queryByText(/not available for this/)).not.toBeInTheDocument();
    expect(screen.getByText(/120th Congress districts/)).toBeInTheDocument();
    expect(screen.queryByText(/Click on a district/)).not.toBeInTheDocument();
  });

  it("uses the selected year's results and that year's tag", async () => {
    mockImpacts = {
      districtImpacts: results("UT", 4),
      modelNotes: { district_congress: 120 },
      impactsByYear: {
        2026: { districtImpacts: results("UT", 4) },
        2027: { districtImpacts: { "UT-1": { avgBenefit: 99 } }, districtCongress: 120 },
      },
    };
    render(<CardBasedDistrictView stateAbbr="UT" yearImpacts={mockImpacts.impactsByYear[2027]} congress={120} />);
    expect(screen.getByText("District 1")).toBeInTheDocument();
    expect(screen.getByText("+$99")).toBeInTheDocument();
    expect(screen.queryByText("District 2")).not.toBeInTheDocument();
  });

  it("explains a failed load of a drawable Congress's boundaries", async () => {
    mockImpacts = { districtImpacts: results("SC", 7) };
    render(<DistrictMap stateAbbr="SC" reformId="sc-test" />);
    expect(await screen.findByText(/The district map didn't load/)).toBeInTheDocument();
    expect(screen.getByText("District 7")).toBeInTheDocument();
    expect(screen.queryByText(/Click on a district/)).not.toBeInTheDocument();
  });

  it("says when an analysis has no district results", () => {
    render(<CardBasedDistrictView stateAbbr="OK" yearImpacts={{}} congress={119} />);
    expect(screen.getByText("District results are not available for this analysis")).toBeInTheDocument();
  });
});
