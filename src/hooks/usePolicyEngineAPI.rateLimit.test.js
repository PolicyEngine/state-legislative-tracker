import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const DASHBOARD_API_CALCULATE_URL = "https://www.policyengine.org/api/household/calculate";
const WEBSITE_ORIGIN = "https://www.policyengine.org";
const MODAL_ORIGIN = "https://policyengine--state-legislative-tracker.modal.run";

const HOUSEHOLD = {
  people: { head: { age: { 2026: 35 }, employment_income: { 2026: 50000 } } },
  households: { household: { members: ["head"], state_code: { 2026: "UT" } } },
};
const REFORM = { "gov.states.ut.tax.income.rate": { 2026: 0.04 } };
const RESULT = { households: { household: { household_net_income: { 2026: 45000 } } } };

const LIMIT_REACHED_MESSAGE =
  "Everyone on your network, such as a workshop or an office, shares a limit on " +
  "calculations a minute, and it has been reached.";
const LIMIT_MAY_HAVE_BEEN_REACHED_MESSAGE =
  "Everyone on your network, such as a workshop or an office, shares a limit on " +
  "calculations a minute, which may have been reached.";
const NO_ANSWER_ON_ANOTHER_ORIGIN_MESSAGE =
  "PolicyEngine's calculation service could not be reached. Everyone on your network, " +
  "such as a workshop or an office, shares a limit on calculations a minute, which may " +
  "have been reached.";
const NO_ANSWER_ON_WEBSITE_MESSAGE =
  "PolicyEngine's calculation service could not be reached. Check your connection and " +
  "try again.";

const fetchMock = vi.fn();

function jsonAnswer(body, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

function okAnswer() {
  return jsonAnswer({ status: "ok", message: null, result: RESULT });
}

/** The firewall's answer over its limit: plain text, no Retry-After. */
function tooManyRequests() {
  return new Response("Too Many Requests", {
    status: 429,
    headers: { "Content-Type": "text/plain" },
  });
}

function calculateRequestCount() {
  return fetchMock.mock.calls.filter(([input]) => String(input) === DASHBOARD_API_CALCULATE_URL)
    .length;
}

/**
 * Loads a fresh copy of the hook's module, so that no pause or cached model
 * version carries over from another test, and renders the hook.
 */
async function renderPolicyEngineHook() {
  vi.resetModules();
  const policyEngineModule = await import("./usePolicyEngineAPI");
  const hook = renderHook(() => policyEngineModule.usePolicyEngineAPI({ readModelVersion: false }));
  return { hook, policyEngineModule };
}

/** Runs compareReform and resolves with what it threw, or null if it resolved. */
async function compareReformFailure(hook) {
  let thrownError = null;
  await act(async () => {
    thrownError = await hook.result.current.compareReform(HOUSEHOLD, REFORM).then(
      () => null,
      (error) => error,
    );
  });
  return thrownError;
}

beforeEach(() => {
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

describe("usePolicyEngineAPI when the dashboard API's rate limit refuses a calculation", () => {
  it("given the agreed wording then SHARED_LIMIT_EXPLANATION is exported without a final full stop", async () => {
    // Given
    const { policyEngineModule } = await renderPolicyEngineHook();

    // Then
    expect(policyEngineModule.SHARED_LIMIT_EXPLANATION).toBe(
      "Everyone on your network, such as a workshop or an office, shares a limit on calculations a minute",
    );
  });

  it("given a 429 then compareReform explains the shared limit and reports no error to show in place of the results", async () => {
    // Given
    fetchMock.mockImplementation(async () => tooManyRequests());
    const { hook } = await renderPolicyEngineHook();

    // When
    const thrownError = await compareReformFailure(hook);

    // Then
    expect(thrownError).toMatchObject({
      message: LIMIT_REACHED_MESSAGE,
      status: 429,
      rateLimited: true,
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.loading).toBe(false);
  });

  it("given no answer on the tracker's own host then compareReform says the shared limit may have been reached", async () => {
    // Given: the firewall's 429 has no CORS headers, so a page on another
    // origin sees a network failure instead.
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { hook } = await renderPolicyEngineHook();

    // When
    const thrownError = await compareReformFailure(hook);

    // Then
    expect(thrownError).toMatchObject({
      message: NO_ANSWER_ON_ANOTHER_ORIGIN_MESSAGE,
      status: null,
      rateLimited: true,
    });
    expect(hook.result.current.error).toBeNull();
  });

  it("given no answer on www.policyengine.org then compareReform reports a network failure and does not pause", async () => {
    // Given: there the firewall's 429 would be readable, so no answer is a
    // network failure.
    vi.stubGlobal("location", { origin: WEBSITE_ORIGIN });
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { hook } = await renderPolicyEngineHook();

    // When
    const thrownError = await compareReformFailure(hook);
    await compareReformFailure(hook);

    // Then
    expect(thrownError).toMatchObject({
      message: NO_ANSWER_ON_WEBSITE_MESSAGE,
      status: null,
      rateLimited: false,
    });
    expect(hook.result.current.error).toBe(NO_ANSWER_ON_WEBSITE_MESSAGE);
    expect(calculateRequestCount()).toBe(4);
  });

  it("given a 429 then a calculation within the minute is held back without sending a request", async () => {
    // Given
    fetchMock.mockImplementation(async () => tooManyRequests());
    const { hook } = await renderPolicyEngineHook();
    await compareReformFailure(hook);
    const requestsBeforeHoldingBack = calculateRequestCount();

    // When
    const thrownError = await compareReformFailure(hook);

    // Then
    expect(calculateRequestCount()).toBe(requestsBeforeHoldingBack);
    expect(thrownError).toMatchObject({
      message: LIMIT_MAY_HAVE_BEEN_REACHED_MESSAGE,
      rateLimited: true,
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.loading).toBe(false);
  });

  it("given a 429 then calculations are sent again once the minute is over", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] });
    const refusalTime = new Date("2026-11-13T12:00:00Z").getTime();
    vi.setSystemTime(refusalTime);
    fetchMock.mockImplementation(async () => tooManyRequests());
    const { hook } = await renderPolicyEngineHook();
    await compareReformFailure(hook);
    const requestsAfterRefusal = calculateRequestCount();
    fetchMock.mockImplementation(async () => okAnswer());

    // When
    vi.setSystemTime(refusalTime + 59_999);
    await compareReformFailure(hook);
    const requestsJustBeforeTheMinuteEnds = calculateRequestCount();
    vi.setSystemTime(refusalTime + 60_000);
    const thrownError = await compareReformFailure(hook);

    // Then
    expect(requestsJustBeforeTheMinuteEnds).toBe(requestsAfterRefusal);
    expect(thrownError).toBeNull();
    expect(calculateRequestCount()).toBe(requestsAfterRefusal + 2);
  });

  it("given the baseline fails for another reason and the reform is then refused for the limit then calculations pause", async () => {
    // Given: the baseline fails at once; the firewall refuses the reform a
    // moment later, after compareReform has already failed.
    let answerReform;
    const reformAnswered = new Promise((resolve) => {
      answerReform = resolve;
    });
    fetchMock.mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init.body));
      if (body.policy === undefined) {
        return jsonAnswer({ status: "error", message: "Internal error", result: null }, 500);
      }
      await reformAnswered;
      return tooManyRequests();
    });
    const { hook } = await renderPolicyEngineHook();
    const thrownError = await compareReformFailure(hook);
    await act(async () => {
      answerReform();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const requestsAfterRefusal = calculateRequestCount();

    // When
    const heldBackError = await compareReformFailure(hook);

    // Then
    expect(thrownError).toMatchObject({ message: "Internal error", status: 500, rateLimited: false });
    expect(heldBackError).toMatchObject({ rateLimited: true });
    expect(calculateRequestCount()).toBe(requestsAfterRefusal);
  });

  it("given a 504 then compareReform keeps its message, sends each calculation once and does not pause", async () => {
    // Given: the dashboard API has already waited for the Public API.
    fetchMock.mockImplementation(async () =>
      jsonAnswer({ status: "error", message: "The Public API did not answer in time.", result: null }, 504),
    );
    const { hook } = await renderPolicyEngineHook();

    // When
    const thrownError = await compareReformFailure(hook);
    const requestsAfterFirstClick = calculateRequestCount();
    await compareReformFailure(hook);

    // Then
    expect(thrownError).toMatchObject({
      message: "The Public API did not answer in time.",
      status: 504,
      rateLimited: false,
    });
    expect(hook.result.current.error).toBe("The Public API did not answer in time.");
    expect(requestsAfterFirstClick).toBe(2);
    expect(calculateRequestCount()).toBe(4);
  });

  it("given a pause then pauseHouseholdCalculations(0) ends it and listeners hear of both", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] });
    const { policyEngineModule } = await renderPolicyEngineHook();
    const {
      pauseHouseholdCalculations,
      householdCalculationPauseRemaining,
      householdCalculationPauseReason,
      onHouseholdCalculationPause,
    } = policyEngineModule;
    expect([
      typeof pauseHouseholdCalculations,
      typeof householdCalculationPauseRemaining,
      typeof householdCalculationPauseReason,
      typeof onHouseholdCalculationPause,
    ]).toEqual(["function", "function", "function", "function"]);
    const pausesHeard = [];
    const unsubscribe = onHouseholdCalculationPause(() => {
      pausesHeard.push({
        remaining: householdCalculationPauseRemaining(),
        reason: householdCalculationPauseReason(),
      });
    });

    // When
    pauseHouseholdCalculations();
    pauseHouseholdCalculations(30_000, LIMIT_REACHED_MESSAGE);
    pauseHouseholdCalculations(0);
    unsubscribe();
    pauseHouseholdCalculations();

    // Then
    expect(pausesHeard).toEqual([
      { remaining: 60_000, reason: LIMIT_MAY_HAVE_BEEN_REACHED_MESSAGE },
      { remaining: 30_000, reason: LIMIT_REACHED_MESSAGE },
      { remaining: 0, reason: LIMIT_MAY_HAVE_BEEN_REACHED_MESSAGE },
    ]);
  });
});
