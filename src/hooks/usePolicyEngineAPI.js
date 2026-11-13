import { useState, useCallback, useEffect } from "react";
import {
  createPolicyEngineApiClient,
  DEFAULT_BASE_URL,
  PolicyEngineApiError,
  RATE_LIMIT_WAIT_MILLISECONDS,
} from "@policyengine/api-client";

// www.policyengine.org's dashboard API, which forwards to the PolicyEngine
// Public API with PolicyEngine's credential. The tracker's pages are served
// from www.policyengine.org, so these are same-origin requests there.
const policyengine = createPolicyEngineApiClient();

/**
 * What the page says about the firewall's limit on household calculations
 * (30 a minute for each IP address), which everyone behind one address
 * shares. Callers add the final full stop.
 */
export const SHARED_LIMIT_EXPLANATION =
  "Everyone on your network, such as a workshop or an office, shares a " +
  "limit on calculations a minute";

/**
 * When the page may send household calculations again after a refusal for
 * the firewall's limit, in `Date.now()` milliseconds. Every household
 * calculation checks it before it is sent.
 */
let householdCalculationsPausedUntil = 0;
const pauseListeners = new Set();

/**
 * Stops the page from sending household calculations for `milliseconds`
 * (the firewall's one-minute window unless given); 0 ends a pause.
 */
export function pauseHouseholdCalculations(milliseconds = RATE_LIMIT_WAIT_MILLISECONDS) {
  householdCalculationsPausedUntil = Date.now() + milliseconds;
  pauseListeners.forEach((listener) => listener());
}

/** Milliseconds until the page may send household calculations again; 0 when it may now. */
export function householdCalculationPauseRemaining() {
  return Math.max(0, householdCalculationsPausedUntil - Date.now());
}

/** Calls `listener` whenever a pause starts or is ended early; returns the unsubscribe function. */
export function onHouseholdCalculationPause(listener) {
  pauseListeners.add(listener);
  return () => {
    pauseListeners.delete(listener);
  };
}

/**
 * Whole seconds until the page may calculate again after a refusal for the
 * firewall's limit, 0 when it may now. Counts down once a second during a
 * pause.
 */
export function useHouseholdCalculationPause() {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    Math.ceil(householdCalculationPauseRemaining() / 1000)
  );
  useEffect(() => {
    let countdown;
    const update = () => {
      const seconds = Math.ceil(householdCalculationPauseRemaining() / 1000);
      setSecondsRemaining(seconds);
      if (seconds > 0 && countdown === undefined) {
        countdown = setInterval(update, 1000);
      } else if (seconds === 0 && countdown !== undefined) {
        clearInterval(countdown);
        countdown = undefined;
      }
    };
    update();
    const unsubscribe = onHouseholdCalculationPause(update);
    return () => {
      unsubscribe();
      if (countdown !== undefined) {
        clearInterval(countdown);
      }
    };
  }, []);
  return secondsRemaining;
}

/**
 * A household calculation failed. `message` is written for the user;
 * `rateLimited` says whether the firewall's limit may have refused it: a
 * 429, no readable answer on another origin (which is how such a page sees
 * the firewall's 429), or a calculation held back during the pause after a
 * refusal.
 */
export class HouseholdCalculationError extends Error {
  constructor(message, { status, rateLimited, cause }) {
    super(message, { cause });
    this.name = "HouseholdCalculationError";
    /** The dashboard API's HTTP status, or null when no answer was read. */
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

/**
 * Whether the page is served from the dashboard API's own origin
 * (www.policyengine.org), where the firewall's 429 is readable.
 */
function pageSharesDashboardApiOrigin() {
  return globalThis.location?.origin === new URL(DEFAULT_BASE_URL).origin;
}

/** Turns a failure of the dashboard API client into a message for the user. */
function classifyCalculationFailure(error) {
  if (error.status === 429) {
    return new HouseholdCalculationError(
      `${SHARED_LIMIT_EXPLANATION}, and it has been reached.`,
      { status: 429, rateLimited: true, cause: error }
    );
  }
  if (error.status === null) {
    if (pageSharesDashboardApiOrigin()) {
      // The firewall's 429 would be readable here, so this is a network
      // failure.
      return new HouseholdCalculationError(
        "PolicyEngine's calculation service could not be reached. Check " +
          "your connection and try again.",
        { status: null, rateLimited: false, cause: error }
      );
    }
    // On another origin, such as the tracker's own Modal host, the
    // firewall's 429 has no CORS headers, so the browser reports a network
    // failure. So does the dashboard API's 403 for an origin it does not
    // allow.
    return new HouseholdCalculationError(
      "PolicyEngine's calculation service could not be reached. " +
        `${SHARED_LIMIT_EXPLANATION}, which may have been reached.`,
      { status: null, rateLimited: true, cause: error }
    );
  }
  // Any other refusal keeps the dashboard API's own message.
  return new HouseholdCalculationError(error.message, {
    status: error.status,
    rateLimited: false,
    cause: error,
  });
}

// Module-level cache so all hook instances share the same fetch
let _apiVersionPromise = null;

function fetchApiVersion() {
  if (!_apiVersionPromise) {
    _apiVersionPromise = policyengine
      .getMetadata("us")
      .then((metadata) => metadata?.version || null)
      .catch(() => null);
  }
  return _apiVersionPromise;
}

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Check if a reform requires structural code (contrib reforms, _use_reform)
 * vs being purely parametric (just changing existing parameter values).
 * Structural reforms need a specific policyengine-us version on the API;
 * parametric reforms work on any version.
 */
export function reformNeedsStructuralCode(reformParams) {
  if (!reformParams || typeof reformParams !== "object") return false;
  return Object.keys(reformParams).some(
    (key) => key.startsWith("_use_reform") || key.includes(".contrib.")
  );
}

/**
 * Convert reform_params (as stored in Supabase) to PE API policy format.
 * - Strips internal keys (_use_reform, _skip_params, etc.)
 * - Converts bracket notation (brackets[0] → [0])
 * - Converts bare year keys ("2026") to date ranges ("2026-01-01.2100-12-31")
 */
export function buildApiPolicy(reform) {
  const apiPolicy = {};
  for (const [rawKey, value] of Object.entries(reform)) {
    // Skip internal keys used only by the local microsim
    if (rawKey.startsWith("_")) continue;
    // Convert local param paths to API format:
    // Local microsim uses "brackets[0].rate", API uses "[0].rate" (no "brackets" prefix)
    const key = rawKey.replace(/\.brackets\[(\d+)\]/g, '[$1]');
    if (typeof value === "object" && value !== null) {
      // Normalize period keys to match microsim behavior:
      //   "2026"           → "2026-01-01.2100-12-31"  (bare year → permanent)
      //   "2026-01-01"     → "2026-01-01.2100-12-31"  (date-only → permanent)
      //   "2026-01-01.XYZ" → passed through as-is      (already a range)
      apiPolicy[key] = {};
      for (const [period, val] of Object.entries(value)) {
        if (/^\d{4}$/.test(period)) {
          apiPolicy[key][`${period}-01-01.2100-12-31`] = val;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
          apiPolicy[key][`${period}.2100-12-31`] = val;
        } else {
          apiPolicy[key][period] = val;
        }
      }
    } else {
      apiPolicy[key] = value;
    }
  }
  return apiPolicy;
}

/**
 * Household calculations through the dashboard API. `readModelVersion`
 * reads the deployed policyengine-us version from the country metadata, a
 * large download; pass false when the version isn't needed, as for reforms
 * that need no structural code.
 *
 * `error` is the message of a failure to show in place of the results. A
 * failure the firewall's limit may have caused leaves it null: the page
 * keeps its last answer and explains the limit by the Calculate button.
 */
export function usePolicyEngineAPI({ readModelVersion = true } = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [apiVersion, setApiVersion] = useState(null);

  useEffect(() => {
    if (!readModelVersion) return undefined;
    let cancelled = false;
    fetchApiVersion().then((version) => {
      if (!cancelled) setApiVersion(version);
    });
    return () => {
      cancelled = true;
    };
  }, [readModelVersion]);

  // Internal function that doesn't manage loading state. Resolves with
  // {status, message, result}, the shape ResultsDisplay reads; the Public
  // API's other answer fields are not kept.
  const runCalculation = async (household, reform = null) => {
    const request = { country: "us", household };

    if (reform) {
      request.policy = buildApiPolicy(reform);
    }

    if (householdCalculationPauseRemaining() > 0) {
      // Held back during the pause after a refusal, so never sent. The
      // pause may have started from a request with no answer, which only
      // may have met the limit.
      throw new HouseholdCalculationError(
        `${SHARED_LIMIT_EXPLANATION}, which may have been reached.`,
        { status: null, rateLimited: true }
      );
    }

    try {
      const result = await policyengine.calculateHousehold(request);
      return { status: "ok", message: null, result };
    } catch (err) {
      console.error("Dashboard API error:", err.status ?? "no answer", err.body ?? err.message);
      if (!(err instanceof PolicyEngineApiError)) {
        throw err;
      }
      const failure = classifyCalculationFailure(err);
      if (failure.rateLimited) {
        // Pause at once, even if the household's other calculation has
        // already failed and the caller never sees this refusal.
        pauseHouseholdCalculations();
      }
      throw failure;
    }
  };

  const calculateHousehold = useCallback(async (household, reform = null) => {
    setLoading(true);
    setError(null);

    try {
      return await runCalculation(household, reform);
    } catch (err) {
      setError(err.rateLimited ? null : err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const compareReform = useCallback(async (household, reformParameters) => {
    setLoading(true);
    setError(null);

    try {
      // Run baseline and reform calculations in parallel
      const [baseline, reform] = await Promise.all([
        runCalculation(household),
        runCalculation(household, reformParameters),
      ]);

      return { baseline, reform };
    } catch (err) {
      setError(err.rateLimited ? null : err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { calculateHousehold, compareReform, loading, error, apiVersion };
}
