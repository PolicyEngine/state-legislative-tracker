export const FEDERAL_JURISDICTION = "federal";

export function isFederalJurisdiction(jurisdiction) {
  return jurisdiction === FEDERAL_JURISDICTION;
}

export function isStateJurisdiction(jurisdiction) {
  return Boolean(jurisdiction) && !isFederalJurisdiction(jurisdiction);
}

export function getJurisdictionLabel(jurisdiction, stateData) {
  if (isFederalJurisdiction(jurisdiction)) {
    return "Federal";
  }
  return stateData[jurisdiction]?.name || jurisdiction;
}
