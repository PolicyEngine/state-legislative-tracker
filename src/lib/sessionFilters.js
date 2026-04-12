export const ALL_YEARS = "all";
export const CURRENT_SCOPE = "current";
export const ALL_ACTIVITY_SCOPE = "all_activity";

export const CURRENT_FEDERAL_SESSION = {
  id: CURRENT_SCOPE,
  label: "119th Congress",
  description: "January 3, 2025 to January 3, 2027",
  years: ["2026", "2025"],
};

export function extractYearsFromText(text) {
  if (!text) return [];
  const matches = text.match(/\b20\d{2}\b/g) || [];
  return sortYearsDesc(Array.from(new Set(matches)));
}

export function extractYearFromDate(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
}

export function sortYearsDesc(years) {
  return [...years].sort((a, b) => Number(b) - Number(a));
}

export function collectYears(...itemGroups) {
  const years = new Set();
  for (const group of itemGroups) {
    for (const item of group || []) {
      const year = typeof item === "string" ? item : extractYearFromDate(item?.date || item?.last_action_date);
      if (year) years.add(year);
    }
  }
  return sortYearsDesc(Array.from(years));
}

export function buildSessionYearSet(selectedScope, sessionYears) {
  return selectedScope === CURRENT_SCOPE ? new Set(sessionYears) : null;
}

export function matchesYearFilter(item, selectedYear, dateField = "date") {
  if (!selectedYear || selectedYear === ALL_YEARS) return true;
  return extractYearFromDate(item?.[dateField]) === selectedYear;
}

export function matchesSessionScope(item, sessionYearSet, dateField = "date") {
  if (!sessionYearSet) return true;
  const year = extractYearFromDate(item?.[dateField]);
  return year ? sessionYearSet.has(year) : false;
}
