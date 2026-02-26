import { useState, useCallback, useEffect } from "react";

const API_BASE = "https://api.policyengine.org";

// Module-level cache so all hook instances share the same fetch
let _apiVersionPromise = null;

function fetchApiVersion() {
  if (!_apiVersionPromise) {
    _apiVersionPromise = fetch(`${API_BASE}/us/metadata`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.result?.version || null)
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

export function usePolicyEngineAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [apiVersion, setApiVersion] = useState(null);

  useEffect(() => {
    fetchApiVersion().then(setApiVersion);
  }, []);

  // Internal function that doesn't manage loading state
  const runCalculation = async (household, reform = null) => {
    const payload = { household };

    if (reform) {
      payload.policy = buildApiPolicy(reform);
    }

    const response = await fetch(`${API_BASE}/us/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("API error response:", data);
      throw new Error(data.message || data.error || `API error: ${response.status}`);
    }

    return data;
  };

  const calculateHousehold = useCallback(async (household, reform = null) => {
    setLoading(true);
    setError(null);

    try {
      return await runCalculation(household, reform);
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { calculateHousehold, compareReform, loading, error, apiVersion };
}
