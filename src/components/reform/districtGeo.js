import { loadCongressionalDistrictsGeo } from "@policyengine/ui-kit/visualization";

// The Congress whose districts an analysis without a tag was computed on.
// Every analysis before tagging used the policyengine-us-data state files,
// which assign households to 119th Congress districts
// (make_block_cd_distributions.py: fetch_block_to_district_map(119)).
export const DEFAULT_DISTRICT_CONGRESS = 119;

// Congresses whose boundaries the installed ui-kit can draw. ui-kit 0.9's
// loader takes no argument and always returns the 119th file, so add 120 only
// after upgrading to the release with PolicyEngine/policyengine-ui-kit#41.
export const DRAWABLE_CONGRESSES = [119];

function toCongress(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DISTRICT_CONGRESS;
}

/**
 * The Congress whose districts the shown district results were computed on.
 * A multi-year analysis tags each year; only the root fields fall back to
 * model_notes.district_congress, which describes the latest write.
 */
export function districtCongressOf(impacts, selectedYear) {
  const yearEntry = selectedYear ? impacts?.impactsByYear?.[selectedYear] : null;
  if (yearEntry) return toCongress(yearEntry.districtCongress);
  return toCongress(impacts?.modelNotes?.district_congress);
}

export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

export function congressLabel(congress) {
  if (congress === 120) return "120th Congress districts (from January 3, 2027)";
  return `${ordinal(congress)} Congress districts`;
}

/** District number from a ui-kit boundary feature's properties ("TX-05" -> 5). */
export function districtNumberOf(properties) {
  const id = properties?.DISTRICT_ID;
  if (typeof id === "string" && id.includes("-")) {
    const n = parseInt(id.split("-")[1], 10);
    if (!Number.isNaN(n)) return n;
  }
  const fp = properties?.CD120FP ?? properties?.CD119FP ?? properties?.CDFP;
  const n = parseInt(fp, 10);
  return Number.isNaN(n) ? null : n;
}

export function isAtLarge(properties) {
  return /at large/i.test(properties?.NAMELSAD || "");
}

/** Keep one state's districts from a national boundary file. */
export function filterStateDistricts(geo, stateAbbr, congress) {
  const prefix = `${stateAbbr}-`;
  const features = (geo?.features || []).filter((f) =>
    f.properties?.DISTRICT_ID?.startsWith(prefix)
  );
  // The file must be the Congress we asked for: an older ui-kit ignores the
  // argument and returns the 119th file.
  const session = features[0]?.properties?.CDSESSN;
  if (session && Number(session) !== congress) {
    throw new Error(
      `Asked for ${ordinal(congress)} Congress districts but got the ${ordinal(Number(session))}`
    );
  }
  return { type: "FeatureCollection", features };
}

const cache = new Map();

/** One state's district boundaries for the given Congress, from ui-kit. */
export function loadStateDistrictsGeo(stateAbbr, congress) {
  if (!DRAWABLE_CONGRESSES.includes(congress)) {
    return Promise.reject(
      new Error(`This ui-kit version has no ${ordinal(congress)} Congress district boundaries`)
    );
  }
  const key = `${stateAbbr}:${congress}`;
  if (!cache.has(key)) {
    const promise = loadCongressionalDistrictsGeo(congress).then((geo) =>
      filterStateDistricts(geo, stateAbbr, congress)
    );
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return cache.get(key);
}
