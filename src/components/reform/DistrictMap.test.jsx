import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let mockImpacts = null;
vi.mock("../../context/DataContext", () => ({
  useData: () => ({ getImpact: () => mockImpacts }),
}));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@policyengine/ui-kit/visualization", () => ({
  loadCongressionalDistrictsGeo: vi.fn(async () => {
    throw new Error("boundary file failed to load");
  }),
}));

import DistrictMap, { CardBasedDistrictView } from "./DistrictMap";

const results = (state, count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`${state}-${i + 1}`, { avgBenefit: (i + 1) * 10 }])
  );

describe("district results without a drawable map", () => {
  it("lists Alabama's districts when the analysis is tagged with the 120th Congress", async () => {
    mockImpacts = { districtImpacts: results("AL", 7), modelNotes: { district_congress: 120 } };
    render(<DistrictMap stateAbbr="AL" reformId="al-test" />);
    expect(await screen.findByText("District 7")).toBeInTheDocument();
    expect(screen.getByText(/120th Congress aren't available in this app yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Click on a district/)).not.toBeInTheDocument();
  });

  it("lists every North Carolina district instead of saying data is missing", async () => {
    mockImpacts = { districtImpacts: results("NC", 14), modelNotes: { district_congress: 120 } };
    render(<DistrictMap stateAbbr="NC" reformId="nc-test" />);
    expect(await screen.findByText("District 14")).toBeInTheDocument();
    expect(screen.queryByText(/not available for this/)).not.toBeInTheDocument();
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
  });

  it("says when an analysis has no district results", () => {
    render(<CardBasedDistrictView stateAbbr="OK" yearImpacts={{}} congress={119} />);
    expect(screen.getByText("District results are not available for this analysis")).toBeInTheDocument();
  });
});
