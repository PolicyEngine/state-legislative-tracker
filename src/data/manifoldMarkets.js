/**
 * Mapping of bill IDs to Manifold Markets prediction market URLs.
 *
 * To add a new market, add an entry here with the bill ID (matching the
 * Supabase research table id) and the Manifold market slug.
 *
 * TODO: migrate to a `manifold_url` column on the Supabase `research` table.
 */
const MANIFOLD_BASE = "https://manifold.markets";

const manifoldMarkets = {
  "sc-h4216": `${MANIFOLD_BASE}/MaxGhenis/will-south-carolina-h4216-income-ta`,
  "sc-h3492": `${MANIFOLD_BASE}/MaxGhenis/will-south-carolina-h3492-partially`,
};

export default manifoldMarkets;
