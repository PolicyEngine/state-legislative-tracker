import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The household tab needs none of the other tabs, the reform's stored
// impacts or analytics.
vi.mock("../../context/DataContext", () => ({ useData: () => ({ getImpact: () => null }) }));
vi.mock("../../lib/analytics", () => ({ track: () => undefined }));
vi.mock("./BillOverview", () => ({ default: () => null }));
vi.mock("./AggregateImpacts", () => ({ default: () => null }));
vi.mock("./DistrictMap", () => ({ default: () => null }));

const DASHBOARD_API_CALCULATE_URL = "https://www.policyengine.org/api/household/calculate";
const MODAL_ORIGIN = "https://policyengine--state-legislative-tracker.modal.run";

const REFORM_CONFIG = {
  id: "ut-example",
  label: "Utah example reform",
  reform: { "gov.states.ut.tax.income.rate": { 2026: 0.04 } },
};
const BASELINE_RESULT = { households: { household: { household_net_income: { 2026: 45000 } } } };
const REFORM_RESULT = { households: { household: { household_net_income: { 2026: 45500 } } } };
// The reform's net income, shown only in the results.
const REFORM_NET_INCOME_TEXT = "$45,500";

const EXPLANATION_SENTENCE =
  "Everyone on your network, such as a workshop or an office, shares a limit on " +
  "calculations a minute.";

const fetchMock = vi.fn();

function jsonAnswer(body, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

function calculatedHousehold(body) {
  return jsonAnswer({
    status: "ok",
    message: null,
    result: body.policy ? REFORM_RESULT : BASELINE_RESULT,
  });
}

/** The firewall's answer over its limit: plain text, no Retry-After. */
function tooManyRequests() {
  return new Response("Too Many Requests", {
    status: 429,
    headers: { "Content-Type": "text/plain" },
  });
}

function refusedParameter() {
  return jsonAnswer(
    { status: "error", message: "Parameter gov.example does not exist.", result: null },
    400,
  );
}

/** Answers household calculations with `answerCalculation`; nothing else is reachable. */
function answerCalculationsWith(answerCalculation) {
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === DASHBOARD_API_CALCULATE_URL) {
      return answerCalculation(JSON.parse(String(init.body)));
    }
    throw new TypeError(`Failed to fetch ${String(input)}`);
  });
}

function calculateButton() {
  return screen.getByRole("button", { name: /^Calculat/ });
}

/** Clicks the Calculate button and waits until the calculation has finished. */
async function calculate() {
  fireEvent.click(calculateButton());
  await waitFor(() => expect(calculateButton()).not.toHaveTextContent("Calculating..."));
}

/** Loads a fresh copy of the component's modules, so that no pause carries over. */
async function renderHouseholdTab() {
  vi.resetModules();
  const { default: ReformAnalyzer } = await import("./ReformAnalyzer");
  render(<ReformAnalyzer reformConfig={REFORM_CONFIG} stateAbbr="UT" bill={null} />);
  fireEvent.click(screen.getByRole("button", { name: /Your Household/ }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { origin: MODAL_ORIGIN });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ReformAnalyzer's household tab when the dashboard API's rate limit refuses a calculation", () => {
  it("given an answer on screen when the next calculation is refused for the limit then the answer stays and the button counts down", async () => {
    // Given
    answerCalculationsWith(calculatedHousehold);
    await renderHouseholdTab();
    await calculate();
    expect(screen.getByText(REFORM_NET_INCOME_TEXT)).toBeInTheDocument();

    // When
    answerCalculationsWith(tooManyRequests);
    await calculate();

    // Then
    expect(screen.queryByText(REFORM_NET_INCOME_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/Error calculating impact/)).not.toBeInTheDocument();
    expect(calculateButton()).toHaveTextContent("Calculate again in 60 s");
    expect(calculateButton()).toBeDisabled();
    const explanation = screen.queryByRole("status");
    expect(explanation?.textContent).toBe(EXPLANATION_SENTENCE);
    expect(explanation?.parentElement?.textContent).toBe(
      `${EXPLANATION_SENTENCE} This page can calculate again in 60 s.`,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(calculateButton()).toHaveTextContent("Calculate again in 59 s");
    expect(screen.queryByRole("status")?.parentElement?.textContent).toBe(
      `${EXPLANATION_SENTENCE} This page can calculate again in 59 s.`,
    );

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(calculateButton()).toHaveTextContent("Calculate Impact");
    expect(calculateButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(REFORM_NET_INCOME_TEXT)).toBeInTheDocument();
  });

  it("given no answer yet when a calculation is refused for the limit then the results area keeps its empty state", async () => {
    // Given
    answerCalculationsWith(tooManyRequests);
    await renderHouseholdTab();

    // When
    await calculate();

    // Then
    expect(screen.queryByText(/Error calculating impact/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enter your details and click/)).toBeInTheDocument();
    expect(calculateButton()).toHaveTextContent("Calculate again in 60 s");
    expect(screen.queryByRole("status")?.textContent).toBe(EXPLANATION_SENTENCE);
  });

  it("given another failure replaced the answer when a calculation is refused for the limit then the earlier answer does not come back", async () => {
    // Given
    answerCalculationsWith(calculatedHousehold);
    await renderHouseholdTab();
    await calculate();
    answerCalculationsWith(refusedParameter);
    await calculate();
    expect(
      screen.getByText("Error calculating impact: Parameter gov.example does not exist."),
    ).toBeInTheDocument();
    expect(screen.queryByText(REFORM_NET_INCOME_TEXT)).not.toBeInTheDocument();
    expect(calculateButton()).toHaveTextContent("Calculate Impact");

    // When
    answerCalculationsWith(tooManyRequests);
    await calculate();

    // Then
    expect(screen.queryByText(/Error calculating impact/)).not.toBeInTheDocument();
    expect(screen.queryByText(REFORM_NET_INCOME_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enter your details and click/)).toBeInTheDocument();
    expect(calculateButton()).toHaveTextContent("Calculate again in 60 s");
  });
});
