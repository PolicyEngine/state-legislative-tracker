import { useState, useCallback } from "react";

const API_BASE = "https://api.policyengine.org";

export function usePolicyEngineAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Internal function that doesn't manage loading state
  const runCalculation = async (household, reform = null) => {
    const payload = { household };

    if (reform) {
      // Convert reform to API format with date ranges
      const apiPolicy = {};
      for (const [rawKey, value] of Object.entries(reform)) {
        // Convert bracket notation (brackets[0]) to dot notation (brackets.0) for API
        const key = rawKey.replace(/\[(\d+)\]/g, '.$1');
        if (typeof value === "object" && value !== null) {
          // Convert year keys to date range format
          apiPolicy[key] = {};
          for (const [period, val] of Object.entries(value)) {
            // If it's just a year, convert to date range format
            if (/^\d{4}$/.test(period)) {
              apiPolicy[key][`${period}-01-01.2100-12-31`] = val;
            } else {
              apiPolicy[key][period] = val;
            }
          }
        } else {
          apiPolicy[key] = value;
        }
      }
      payload.policy = apiPolicy;
    }

    console.log("API payload:", JSON.stringify(payload, null, 2));

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

  return { calculateHousehold, compareReform, loading, error };
}
