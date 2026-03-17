/**
 * Custom key facts for bill analyses.
 *
 * Edit key facts here — changes are version-controlled.
 * When present, these override the auto-generated key facts.
 * When absent, key facts are auto-generated from computed impact data.
 *
 * Each entry is an array of strings. Numbers/values in the strings
 * will not be auto-bolded — write them as you want them displayed.
 */

const keyFacts = {
  // Example:
  // "ny-s9077": [
  //   "Phases in over 5 years, reaching $5.7B impact by 2031",
  //   "Expands child credit eligibility to include 17-year-olds",
  // ],
};

export default keyFacts;

export function getKeyFacts(reformId) {
  return keyFacts[reformId] || null;
}
