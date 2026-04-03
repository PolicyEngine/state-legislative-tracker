/**
 * Pre-render script for SEO.
 *
 * Runs after `vite build`. Fetches published bills from Supabase and generates
 * per-bill HTML pages with unique <title>, meta tags, and <noscript> content
 * so that crawlers see real content instead of an empty SPA shell.
 *
 * Also generates state index pages, sitemap.xml, and robots.txt.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/prerender.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ffgngqlgfsvqartilful.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error("SUPABASE_ANON_KEY is required");
  process.exit(1);
}

const BASE_URL = "https://www.policyengine.org/us/state-legislative-tracker";
const DIST = join(dirname(new URL(import.meta.url).pathname), "..", "dist");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractBillNumber(id, title) {
  const titleMatch = title?.match(/\b(?!FY)([A-Z]{1,3}\.?\s*\d+(?:\s*S\d+)?)/i);
  if (titleMatch)
    return titleMatch[1].replace(/\s+/g, " ").replace(".", "").toUpperCase();
  if (title && !title.match(/\b[A-Z]{1,2}\d+\b/)) {
    const cleanTitle = title.split(/[:(]/)[0].trim();
    if (cleanTitle.length <= 40) return cleanTitle;
  }
  const parts = id.split("-");
  if (parts.length >= 2) return parts.slice(1).join("-").toUpperCase();
  return id.toUpperCase();
}

function formatCurrency(value) {
  if (value == null) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  const abs = Math.abs(num);
  if (abs >= 1e9)
    return `${num < 0 ? "-" : ""}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)
    return `${num < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)
    return `${num < 0 ? "-" : ""}$${(abs / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

// ── Template manipulation ────────────────────────────────────────────────────

function replaceTag(html, tag, attr, newValue) {
  // Replace <meta property="og:title" content="..."> style tags
  const re = new RegExp(
    `<meta\\s+(?:${attr}="${tag}"\\s+content="[^"]*"|content="[^"]*"\\s+${attr}="${tag}")\\s*/?>`,
    "i",
  );
  const replacement = `<meta ${attr}="${tag}" content="${escapeHtml(newValue)}" />`;
  if (re.test(html)) return html.replace(re, replacement);
  // Insert before </head> if not found
  return html.replace("</head>", `    ${replacement}\n  </head>`);
}

function setTitle(html, title) {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
}

function setDescription(html, desc) {
  return html.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
  );
}

function addCanonical(html, url) {
  return html.replace("</head>", `    <link rel="canonical" href="${url}" />\n  </head>`);
}

function addNoscript(html, content) {
  return html.replace(
    '<div id="root"></div>',
    `<div id="root"></div>\n    <noscript>${content}</noscript>`,
  );
}

function addJsonLd(html, data) {
  const json = JSON.stringify(data).replace(/<\//g, "<\\/");
  return html.replace(
    "</head>",
    `    <script type="application/ld+json">${json}</script>\n  </head>`,
  );
}

/** Strip leading state name/abbr and bill number from title to avoid duplication. */
function dedup(raw, stateAbbr, stateName, billNumber) {
  if (!raw) return raw;
  let t = raw;
  // Strip leading state name or abbreviation (e.g. "Oklahoma ", "NY ")
  const stateRe = new RegExp(
    `^(?:${stateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${stateAbbr})\\s*`,
    "i",
  );
  t = t.replace(stateRe, "").trim();
  // Strip leading bill number with optional colon (e.g. "SB168: ", "H.4216 ")
  t = t.replace(/^[A-Z]{1,3}\.?\s*\d+(?:\s*S\d+)?\s*:?\s*/i, "").trim();
  return t || raw;
}

function buildBillPage(template, bill, impact, state) {
  const billNumber = extractBillNumber(bill.id, bill.title);
  const stateName = STATE_NAMES[state] || state;
  // Build a clean page title avoiding duplication of state/bill-number
  const isStandardBillNum = /^[A-Z]{1,3}\s*\d+/.test(billNumber);
  const cleanedTitle = dedup(bill.title, state, stateName, billNumber);
  const title = isStandardBillNum
    ? `${state} ${billNumber}: ${cleanedTitle} | PolicyEngine`
    : `${state}: ${cleanedTitle} | PolicyEngine`;
  const description =
    bill.description ||
    `PolicyEngine analysis of ${state} ${billNumber} — ${bill.title}`;
  const canonicalUrl = `${BASE_URL}/${state}/${bill.id}`;

  let html = template;
  html = setTitle(html, title);
  html = setDescription(html, description);
  html = addCanonical(html, canonicalUrl);

  // OG tags
  html = replaceTag(html, "og:title", "property", title);
  html = replaceTag(html, "og:description", "property", description);
  html = replaceTag(html, "og:type", "property", "article");

  // Twitter
  html = replaceTag(html, "twitter:title", "name", title);
  html = replaceTag(html, "twitter:description", "name", description);

  // Noscript content for crawlers
  const parts = [`<h1>${escapeHtml(title)}</h1>`];
  parts.push(`<p>${escapeHtml(description)}</p>`);

  if (impact?.provisions && Array.isArray(impact.provisions)) {
    parts.push("<h2>Key Provisions</h2><ul>");
    for (const p of impact.provisions) {
      parts.push(
        `<li><strong>${escapeHtml(p.label)}</strong>: ${escapeHtml(p.explanation || "")} (${escapeHtml(p.baseline || "")} → ${escapeHtml(p.reform || "")})</li>`,
      );
    }
    parts.push("</ul>");
  }

  if (impact?.budgetary_impact) {
    const rev = impact.budgetary_impact.baseline_net_income != null &&
      impact.budgetary_impact.reform_net_income != null
      ? impact.budgetary_impact.reform_net_income - impact.budgetary_impact.baseline_net_income
      : null;
    const formatted = formatCurrency(rev);
    if (formatted) {
      parts.push(`<p>Estimated revenue impact: ${escapeHtml(formatted)}</p>`);
    }
  }

  parts.push(
    `<p><a href="${escapeHtml(canonicalUrl)}">View full analysis on PolicyEngine</a></p>`,
  );

  html = addNoscript(html, parts.join(""));

  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title.replace(" | PolicyEngine", ""),
    description,
    url: canonicalUrl,
    publisher: {
      "@type": "Organization",
      name: "PolicyEngine",
      url: "https://policyengine.org",
    },
  };
  if (bill.url) jsonLd.about = { "@type": "Legislation", url: bill.url, name: bill.title };
  if (impact?.computed_at) jsonLd.dateModified = impact.computed_at.split("T")[0];
  if (bill.created_at) jsonLd.datePublished = bill.created_at.split("T")[0];
  html = addJsonLd(html, jsonLd);

  return html;
}

function buildStatePage(template, state, bills) {
  const stateName = STATE_NAMES[state] || state;
  const title = `${stateName} (${state}) 2026 Legislative Tracker | PolicyEngine`;
  const description = `Track ${stateName} tax and benefit legislation for 2026. ${bills.length} bill${bills.length !== 1 ? "s" : ""} analyzed by PolicyEngine.`;
  const canonicalUrl = `${BASE_URL}/${state}`;

  let html = template;
  html = setTitle(html, title);
  html = setDescription(html, description);
  html = addCanonical(html, canonicalUrl);
  html = replaceTag(html, "og:title", "property", title);
  html = replaceTag(html, "og:description", "property", description);

  const parts = [`<h1>${escapeHtml(title)}</h1>`, `<p>${escapeHtml(description)}</p>`];
  if (bills.length > 0) {
    parts.push("<ul>");
    for (const b of bills) {
      const bn = extractBillNumber(b.id, b.title);
      parts.push(
        `<li><a href="${BASE_URL}/${state}/${b.id}">${escapeHtml(bn)}: ${escapeHtml(b.title)}</a></li>`,
      );
    }
    parts.push("</ul>");
  }

  html = addNoscript(html, parts.join(""));
  return html;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/index.html not found — run `npm run build` first");
    process.exit(1);
  }

  const template = readFileSync(join(DIST, "index.html"), "utf-8");

  // Fetch published bills
  const { data: bills, error: billsErr } = await supabase
    .from("research")
    .select("*")
    .eq("type", "bill")
    .neq("status", "in_review");

  if (billsErr) {
    console.error("Failed to fetch bills:", billsErr.message);
    process.exit(1);
  }

  // Fetch impacts
  const { data: impacts, error: impactsErr } = await supabase
    .from("reform_impacts")
    .select("*");

  if (impactsErr) {
    console.error("Failed to fetch impacts:", impactsErr.message);
    process.exit(1);
  }

  const impactMap = {};
  for (const i of impacts || []) {
    impactMap[i.id] = i;
  }

  // Group bills by state
  const billsByState = {};
  for (const bill of bills || []) {
    const state = bill.state?.toUpperCase();
    if (!state) continue;
    if (!billsByState[state]) billsByState[state] = [];
    billsByState[state].push(bill);
  }

  const today = new Date().toISOString().split("T")[0];
  const sitemapEntries = [{ url: BASE_URL, lastmod: today }];
  let billCount = 0;

  // Write the set of valid route prefixes for the server to use for 404 detection
  const validRoutes = new Set(["sitemap.xml", "robots.txt"]);
  for (const state of Object.keys(billsByState)) {
    validRoutes.add(state);
    for (const bill of billsByState[state]) {
      validRoutes.add(`${state}/${bill.id}`);
    }
  }
  // Also include all 50 states + DC as valid SPA routes (even without bills)
  for (const code of Object.keys(STATE_NAMES)) {
    validRoutes.add(code);
  }
  writeFileSync(
    join(DIST, "_valid_routes.json"),
    JSON.stringify([...validRoutes].sort()),
  );

  // Update homepage with noscript navigation links
  const homeParts = [
    "<h1>2026 State Legislative Tracker | PolicyEngine</h1>",
    "<p>Track PolicyEngine&apos;s state-level tax and benefit policy research across all 50 states.</p>",
    "<h2>States with Analyzed Legislation</h2>",
    "<nav><ul>",
  ];
  for (const [state, stateBills] of Object.entries(billsByState).sort()) {
    const stateName = STATE_NAMES[state] || state;
    homeParts.push(
      `<li><a href="${BASE_URL}/${state}">${escapeHtml(stateName)}</a> — ${stateBills.length} bill${stateBills.length !== 1 ? "s" : ""}`,
    );
    homeParts.push("<ul>");
    for (const b of stateBills) {
      const bn = extractBillNumber(b.id, b.title);
      homeParts.push(
        `<li><a href="${BASE_URL}/${state}/${b.id}">${escapeHtml(bn)}: ${escapeHtml(b.title)}</a></li>`,
      );
    }
    homeParts.push("</ul></li>");
  }
  homeParts.push("</ul></nav>");
  let homeHtml = addNoscript(template, homeParts.join(""));
  homeHtml = addCanonical(homeHtml, BASE_URL);
  writeFileSync(join(DIST, "index.html"), homeHtml);

  // Generate pages per state
  for (const [state, stateBills] of Object.entries(billsByState)) {
    // State index page
    const stateDir = join(DIST, state);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "index.html"),
      buildStatePage(template, state, stateBills),
    );
    // Find most recent update across bills in this state for state page lastmod
    let stateLastmod = null;
    for (const bill of stateBills) {
      const impact = impactMap[bill.id];
      const d = impact?.computed_at || bill.updated_at || bill.created_at;
      if (d && (!stateLastmod || d > stateLastmod)) stateLastmod = d;
    }
    sitemapEntries.push({
      url: `${BASE_URL}/${state}`,
      lastmod: stateLastmod ? stateLastmod.split("T")[0] : today,
    });

    // Per-bill pages
    for (const bill of stateBills) {
      const impact = impactMap[bill.id];
      const billDir = join(stateDir, bill.id);
      mkdirSync(billDir, { recursive: true });
      writeFileSync(
        join(billDir, "index.html"),
        buildBillPage(template, bill, impact, state),
      );
      const billLastmod = impact?.computed_at || bill.updated_at || bill.created_at;
      sitemapEntries.push({
        url: `${BASE_URL}/${state}/${bill.id}`,
        lastmod: billLastmod ? billLastmod.split("T")[0] : today,
      });
      billCount++;
    }
  }

  // Sitemap
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapEntries.map(
      ({ url, lastmod }) =>
        `  <url><loc>${escapeHtml(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>weekly</changefreq></url>`,
    ),
    "</urlset>",
  ].join("\n");
  writeFileSync(join(DIST, "sitemap.xml"), sitemap);

  // Robots.txt — no Sitemap directive here because this is served from
  // modal.run; the sitemap is submitted via Google Search Console under
  // policyengine.org to avoid cross-domain "URL not allowed" errors.
  writeFileSync(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n`,
  );

  console.log(
    `Pre-rendered ${billCount} bill pages across ${Object.keys(billsByState).length} states`,
  );
  console.log(
    `Generated sitemap.xml (${sitemapEntries.length} URLs) and robots.txt`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
