import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const DASHBOARD_API_CALCULATE_URL = "https://www.policyengine.org/api/household/calculate";
const DASHBOARD_API_METADATA_URL = "https://www.policyengine.org/api/metadata/us";

const HOUSEHOLD = {
  people: { head: { age: { 2026: 35 }, employment_income: { 2026: 50000 } } },
  households: { household: { members: ["head"], state_code: { 2026: "UT" } } },
};
const REFORM = {
  _use_reform: "ut_example",
  "gov.states.ut.tax.income.rate": { 2026: 0.04 },
};
const BASELINE_RESULT = { households: { household: { household_net_income: { 2026: 45000 } } } };
const REFORM_RESULT = { households: { household: { household_net_income: { 2026: 45500 } } } };

const fetchMock = vi.fn();

function jsonAnswer(body, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers only the dashboard API; any other address is unreachable. */
function answerFromDashboardApi({ calculate, metadataVersion = "1.600.0" }) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === DASHBOARD_API_METADATA_URL) {
      return jsonAnswer({ status: "ok", message: null, result: { version: metadataVersion } });
    }
    if (url === DASHBOARD_API_CALCULATE_URL) {
      return calculate(JSON.parse(String(init.body)));
    }
    throw new TypeError(`Failed to fetch ${url}`);
  });
}

function calculateRequests() {
  return fetchMock.mock.calls
    .filter(([input]) => String(input) === DASHBOARD_API_CALCULATE_URL)
    .map(([, init]) => JSON.parse(String(init.body)));
}

async function renderPolicyEngineHook() {
  // The hook caches the model version for the whole module, so each test
  // loads a fresh copy.
  vi.resetModules();
  const { usePolicyEngineAPI, buildApiPolicy } = await import("./usePolicyEngineAPI");
  return { hook: renderHook(() => usePolicyEngineAPI()), buildApiPolicy };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePolicyEngineAPI through the dashboard API", () => {
  it("given a household and a reform then compareReform calculates both through the dashboard API", async () => {
    // Given
    answerFromDashboardApi({
      calculate: (body) =>
        jsonAnswer({ status: "ok", message: null, result: body.policy ? REFORM_RESULT : BASELINE_RESULT }),
    });
    const { hook, buildApiPolicy } = await renderPolicyEngineHook();

    // When
    await act(async () => {
      await hook.result.current.compareReform(HOUSEHOLD, REFORM).catch(() => undefined);
    });

    // Then
    expect(calculateRequests()).toEqual([
      { country: "us", household: HOUSEHOLD },
      { country: "us", household: HOUSEHOLD, policy: buildApiPolicy(REFORM) },
    ]);
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.includes("api.policyengine.org"))).toBe(false);
  });

  it("given the dashboard API's answers then compareReform resolves with each calculation's result", async () => {
    // Given
    answerFromDashboardApi({
      calculate: (body) =>
        jsonAnswer({ status: "ok", message: null, result: body.policy ? REFORM_RESULT : BASELINE_RESULT }),
    });
    const { hook } = await renderPolicyEngineHook();

    // When
    let comparison;
    await act(async () => {
      comparison = await hook.result.current.compareReform(HOUSEHOLD, REFORM).catch(() => null);
    });

    // Then
    expect(comparison?.baseline?.result).toEqual(BASELINE_RESULT);
    expect(comparison?.reform?.result).toEqual(REFORM_RESULT);
  });

  it("given the hook mounts then it reads the model version from the dashboard API's metadata", async () => {
    // Given
    answerFromDashboardApi({ calculate: () => jsonAnswer({}), metadataVersion: "1.612.3" });

    // When
    const { hook } = await renderPolicyEngineHook();

    // Then
    await waitFor(() => expect(hook.result.current.apiVersion).toBe("1.612.3"));
  });

  it("given the dashboard API refuses a calculation then the error carries its message", async () => {
    // Given
    answerFromDashboardApi({
      calculate: () =>
        jsonAnswer({ status: "error", message: "Parameter gov.example does not exist.", result: null }, 400),
    });
    const { hook } = await renderPolicyEngineHook();

    // When
    let thrownError;
    await act(async () => {
      thrownError = await hook.result.current.compareReform(HOUSEHOLD, REFORM).then(
        () => null,
        (error) => error,
      );
    });

    // Then
    expect(thrownError?.message).toBe("Parameter gov.example does not exist.");
    expect(hook.result.current.error).toBe("Parameter gov.example does not exist.");
  });
});
