import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useData } from "../context/DataContext";
import { useProcessedBills, StageBadge, BillActionModal, AnalysisRequestModal } from "./BillActivityFeed";
import { stateData } from "../data/states";
import { colors, typography, spacing } from "../designTokens";
import { BASE_PATH } from "../lib/basePath";

// ============== Helpers ==============

const formatUSD = (n, { compact = true } = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const prefix = n < 0 ? "−" : "";
  if (!compact) return `${prefix}$${abs.toLocaleString()}`;
  if (abs >= 1e12) return `${prefix}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${prefix}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${prefix}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${prefix}$${(abs / 1e3).toFixed(1)}K`;
  return `${prefix}$${abs.toFixed(0)}`;
};

// Pick the impact payload to display — prefer the latest year from impactsByYear, else root.
function resolveYearImpact(imp) {
  if (!imp) return null;
  const byYear = imp.impactsByYear;
  if (byYear && typeof byYear === "object") {
    const years = Object.keys(byYear).sort();
    if (years.length) return byYear[years[years.length - 1]];
  }
  return imp;
}

function readBudget(imp) {
  const y = resolveYearImpact(imp);
  const b = y?.budgetaryImpact;
  if (!b) return null;
  // stateRevenueImpact: negative when state loses revenue (tax cut); netCost: total $ cost.
  if (b.stateRevenueImpact != null) return b.stateRevenueImpact;
  if (b.netCost != null) return b.netCost;
  if (b.budgetaryImpact != null) return b.budgetaryImpact;
  return null;
}

function readPovertyPct(imp) {
  const y = resolveYearImpact(imp);
  const p = y?.povertyImpact;
  if (p?.percentChange != null) return p.percentChange; // already a %
  return null;
}

function winnersLosersShares(imp) {
  const y = resolveYearImpact(imp);
  const wl = y?.winnersLosers;
  if (!wl) return null;
  const gainRaw = (wl.gainMore5Pct || 0) + (wl.gainLess5Pct || 0);
  const loseRaw = (wl.loseMore5Pct || 0) + (wl.loseLess5Pct || 0);
  const gain = gainRaw * 100;
  const lose = loseRaw * 100;
  const neutral = Math.max(0, 100 - gain - lose);
  return { gain, lose, neutral };
}

// ============== Session scopes ==============

const CURRENT_CALENDAR_YEAR = new Date().getFullYear();

// Ordered newest-first. Each item: { id, label, years: Set<number>|null (null = all time) }
const FEDERAL_SESSIONS = [
  { id: "current", label: "119th Congress", years: new Set([2025, 2026]) },
  { id: "118", label: "118th Congress", years: new Set([2023, 2024]) },
  { id: "117", label: "117th Congress", years: new Set([2021, 2022]) },
  { id: "all", label: "All sessions", years: null },
];

const STATE_SESSIONS_FULL = [
  { id: "current", label: `${CURRENT_CALENDAR_YEAR} session`, years: new Set([CURRENT_CALENDAR_YEAR]) },
  { id: String(CURRENT_CALENDAR_YEAR - 1), label: `${CURRENT_CALENDAR_YEAR - 1} session`, years: new Set([CURRENT_CALENDAR_YEAR - 1]) },
  { id: String(CURRENT_CALENDAR_YEAR - 2), label: `${CURRENT_CALENDAR_YEAR - 2} session`, years: new Set([CURRENT_CALENDAR_YEAR - 2]) },
  { id: "all", label: "All sessions", years: null },
];

function getSessionOptions(jurisdictionFilter) {
  return jurisdictionFilter === "federal" ? FEDERAL_SESSIONS : STATE_SESSIONS_FULL;
}

// Keep only sessions where actual data exists. Always keep "all". For federal, always
// keep "current" (119th Congress) even if empty, so the newest option stays pickable.
function filterAvailableSessions(allOptions, jurisdictionFilter, yearsWithData) {
  return allOptions.filter((o) => {
    if (o.id === "all") return true;
    if (o.id === "current" && jurisdictionFilter === "federal") return true;
    if (!o.years) return true;
    for (const y of o.years) {
      if (yearsWithData.has(y)) return true;
    }
    return false;
  });
}

function resolveSessionYears(jurisdictionFilter, sessionScope) {
  const opts = getSessionOptions(jurisdictionFilter);
  return (opts.find((o) => o.id === sessionScope) || opts[0]).years;
}

function yearOfDate(dateLike) {
  if (!dateLike) return null;
  const m = String(dateLike).match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

// Every 4-digit year found anywhere in the string.
function yearsOfString(dateLike) {
  if (!dateLike) return [];
  const matches = String(dateLike).match(/\b(\d{4})\b/g) || [];
  return matches.map(Number);
}

function inSessionYears(yearSet, ...dateCandidates) {
  if (!yearSet) return true;
  let sawAnyYear = false;
  for (const d of dateCandidates) {
    const years = yearsOfString(d);
    if (years.length === 0) continue;
    sawAnyYear = true;
    if (years.some((y) => yearSet.has(y))) return true;
  }
  // If we never parsed any year, be lenient and include the row so we don't
  // silently hide unknown-year data.
  return !sawAnyYear;
}

function impactScore(b) {
  const imp = b.impact;
  if (!imp) return -Infinity;
  const budget = Math.abs(readBudget(imp) || 0);
  const shares = winnersLosersShares(imp);
  const reach = shares ? (shares.gain + shares.lose) / 100 : 0;
  return budget + reach * 1e9;
}

// ============== Main ==============

export default function RedesignHome() {
  const { research, reformImpacts } = useData();
  const { bills: rawBills, loading: billsLoading } = useProcessedBills(null);
  const [jurisdictionFilter, setJurisdictionFilter] = useState("all"); // all | federal | state
  const [selectedState, setSelectedState] = useState(null); // state abbr when drilled
  const [sessionScope, setSessionScope] = useState("current"); // current | <year> | all
  const [actionBill, setActionBill] = useState(null);
  const [requestBill, setRequestBill] = useState(null);

  // STATE:BILLNUM → { researchId, state } lookup, so tracker rows can route to
  // their scored analysis page (or open the request-analysis modal if unscored).
  const billToResearchId = useMemo(() => {
    const lookup = {};
    for (const r of research) {
      if (r.type !== "bill" || r.status === "in_review") continue;
      const parts = r.id.split("-");
      if (parts.length < 2) continue;
      const state = parts[0].toUpperCase();
      const num = parts.slice(1).join("").toUpperCase();
      lookup[`${state}:${num}`] = { researchId: r.id, state };
    }
    return lookup;
  }, [research]);

  const normalizeBillNum = (n) =>
    (n || "").replace(/\s+/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2").toUpperCase();

  const handleTrackerRowClick = (bill) => {
    const key = `${bill.state}:${normalizeBillNum(bill.bill_number)}`;
    const match = billToResearchId[key];
    if (match) {
      const isFederal = match.state === "all" || match.state === "federal";
      const destination = `${BASE_PATH}/${isFederal ? "federal" : match.state.toLowerCase()}/${match.researchId}`;
      history.pushState(null, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else {
      setActionBill({ ...bill, isAnalyzed: false, analysisMatch: null });
    }
  };

  const sessionYears = useMemo(
    () => resolveSessionYears(jurisdictionFilter, sessionScope),
    [jurisdictionFilter, sessionScope],
  );

  // Map normalized "STATE:BILLNUM" → legislative year (from processed_bills).
  // research.date is the PE scoring date, not the bill's session; the authoritative
  // year lives on the processed_bills row's last_action_date.
  const billYearByKey = useMemo(() => {
    const m = new Map();
    for (const b of rawBills) {
      if (!b.state || !b.bill_number) continue;
      const num = b.bill_number.replace(/\s+/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2").toUpperCase();
      const y = yearOfDate(b.last_action_date) || yearOfDate(b.introduced_date);
      if (y != null) m.set(`${b.state.toUpperCase()}:${num}`, y);
    }
    return m;
  }, [rawBills]);

  // Returns every year that's plausibly associated with this bill (empty if unknown).
  // Prefers the processed_bills join, falls back to every year mentioned in
  // session_name / last_action_date / date (NY-style biennial sessions contain two years).
  function billLegislativeYears(researchItem) {
    const parts = researchItem.id.split("-");
    if (parts.length >= 2) {
      const state = parts[0].toUpperCase();
      const num = parts.slice(1).join("").toUpperCase();
      const joined = billYearByKey.get(`${state}:${num}`);
      if (joined != null) return [joined];
    }
    return [
      ...yearsOfString(researchItem.session_name),
      ...yearsOfString(researchItem.last_action_date),
      ...yearsOfString(researchItem.date),
    ];
  }

  // Years that actually have data under the current jurisdiction — used to hide
  // empty session options (except the newest federal session and "all").
  const yearsWithData = useMemo(() => {
    const years = new Set();
    const isFederalRow = (s) => s === "US" || s === "all" || s === "federal";
    const wantFederal = jurisdictionFilter === "federal";
    const wantState = jurisdictionFilter === "state";
    const include = (stateVal) => {
      if (wantFederal) return isFederalRow(stateVal);
      if (wantState) return !isFederalRow(stateVal);
      return true;
    };
    for (const b of rawBills) {
      if (!include(b.state)) continue;
      const y = yearOfDate(b.last_action_date) || yearOfDate(b.introduced_date);
      if (y != null) years.add(y);
    }
    for (const r of research) {
      if (r.type !== "bill" || r.status === "in_review") continue;
      const stateLike = (r.state || "").toString();
      const jurisLike = r.jurisdiction_code === "US" || stateLike === "all" || stateLike === "federal" ? "US" : stateLike.toUpperCase();
      if (!include(jurisLike)) continue;
      const y = yearOfDate(r.date) || yearOfDate(r.last_action_date);
      if (y != null) years.add(y);
    }
    return years;
  }, [rawBills, research, jurisdictionFilter]);

  const availableSessionOptions = useMemo(
    () => filterAvailableSessions(getSessionOptions(jurisdictionFilter), jurisdictionFilter, yearsWithData),
    [jurisdictionFilter, yearsWithData],
  );

  const scoredBills = useMemo(() => {
    return research
      .filter((r) => r.type === "bill" && r.status !== "in_review")
      .filter((r) => {
        if (jurisdictionFilter === "federal") return r.state === "all" || r.state === "federal" || r.jurisdiction_code === "US";
        if (jurisdictionFilter === "state") return r.state !== "all" && r.state !== "federal" && r.jurisdiction_code !== "US";
        return true;
      })
      .filter((r) => !selectedState || (r.state || "").toUpperCase() === selectedState)
      .filter((r) => {
        if (!sessionYears) return true;
        const years = billLegislativeYears(r);
        if (years.length === 0) return true; // unknown-year bills stay visible
        return years.some((y) => sessionYears.has(y));
      })
      .map((r) => ({ ...r, impact: reformImpacts[r.id] || null }))
      .filter((r) => r.impact)
      .sort((a, b) => impactScore(b) - impactScore(a));
  }, [research, reformImpacts, jurisdictionFilter, selectedState, sessionYears]);

  const topImpact = scoredBills.slice(0, 6);

  const docket = useMemo(() => {
    const filtered = rawBills
      .filter((b) => (jurisdictionFilter === "federal" ? b.state === "US" : jurisdictionFilter === "state" ? b.state !== "US" : true))
      .filter((b) => !selectedState || b.state === selectedState)
      .filter((b) => inSessionYears(sessionYears, b.last_action_date, b.introduced_date));
    return filtered.slice(0, 30);
  }, [rawBills, jurisdictionFilter, selectedState, sessionYears]);

  const enacted = useMemo(() => {
    return rawBills
      .filter((b) => b.status === "Signed into Law")
      .filter((b) => (jurisdictionFilter === "federal" ? b.state === "US" : jurisdictionFilter === "state" ? b.state !== "US" : true))
      .filter((b) => !selectedState || b.state === selectedState)
      .filter((b) => inSessionYears(sessionYears, b.last_action_date, b.introduced_date))
      .slice(0, 8);
  }, [rawBills, jurisdictionFilter, selectedState, sessionYears]);

  const momentum = useMemo(() => {
    // If a non-current session is scoped, show the most recent actions within
    // that session instead of a 7-day window (which only makes sense for now).
    const isCurrent = sessionScope === "current";
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    return rawBills
      .filter((b) => b.last_action_date)
      .filter((b) => (isCurrent ? new Date(b.last_action_date).getTime() >= cutoff : true))
      .filter((b) => (jurisdictionFilter === "federal" ? b.state === "US" : jurisdictionFilter === "state" ? b.state !== "US" : true))
      .filter((b) => !selectedState || b.state === selectedState)
      .filter((b) => inSessionYears(sessionYears, b.last_action_date, b.introduced_date))
      .slice(0, 10);
  }, [rawBills, jurisdictionFilter, selectedState, sessionScope, sessionYears]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: colors.background.tertiary, paddingBottom: spacing["4xl"] }}>
      <Masthead scoredCount={scoredBills.length} totalCount={rawBills.length} momentumCount={momentum.length} />
      <main style={{ maxWidth: "1280px", margin: "0 auto", padding: `${spacing.lg} ${spacing["2xl"]}` }}>
        <FilterStrip
          jurisdictionFilter={jurisdictionFilter}
          setJurisdictionFilter={setJurisdictionFilter}
          selectedState={selectedState}
          clearSelectedState={() => setSelectedState(null)}
          onSelectState={setSelectedState}
          sessionScope={sessionScope}
          onSessionChange={setSessionScope}
          sessionOptions={availableSessionOptions}
        />
        <ImpactIndexCard bills={topImpact} />
        <div
          className="redesign-three-col"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)",
            gap: spacing.lg,
            marginTop: spacing.lg,
          }}
        >
          <DocketCard
            docket={docket}
            loading={billsLoading}
            onBillClick={handleTrackerRowClick}
            billToResearchId={billToResearchId}
            normalizeBillNum={normalizeBillNum}
          />
          <MomentumCard
            momentum={momentum}
            onBillClick={handleTrackerRowClick}
            billToResearchId={billToResearchId}
            normalizeBillNum={normalizeBillNum}
          />
          <EnactedCard
            bills={enacted}
            onBillClick={handleTrackerRowClick}
            billToResearchId={billToResearchId}
            normalizeBillNum={normalizeBillNum}
          />
        </div>
        <RequestCta />
        {actionBill && (
          <BillActionModal
            bill={actionBill}
            onClose={() => setActionBill(null)}
            onViewAnalysis={() => {
              if (actionBill.analysisMatch) {
                const isFederal = actionBill.analysisMatch.state === "all" || actionBill.analysisMatch.state === "federal";
                const dest = `${BASE_PATH}/${isFederal ? "federal" : actionBill.analysisMatch.state.toLowerCase()}/${actionBill.analysisMatch.researchId}`;
                history.pushState(null, "", dest);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }
              setActionBill(null);
            }}
            onRequestAnalysis={() => {
              setRequestBill(actionBill);
              setActionBill(null);
            }}
          />
        )}
        {requestBill && (
          <AnalysisRequestModal bill={requestBill} onClose={() => setRequestBill(null)} />
        )}
      </main>
    </div>
  );
}

// ============== Masthead ==============

function Masthead({ scoredCount, totalCount, momentumCount }) {
  return (
    <header
      style={{
        backgroundColor: colors.white,
        borderBottom: `1px solid ${colors.border.light}`,
        boxShadow: "var(--shadow-elevation-low)",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          padding: `${spacing.lg} ${spacing["2xl"]}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.lg,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
          <img src="/policyengine-favicon.svg" alt="PolicyEngine" style={{ height: "28px", width: "auto" }} />
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: typography.fontSize.lg,
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
                letterSpacing: "-0.015em",
                color: colors.secondary[900],
                lineHeight: 1.2,
              }}
            >
              Bill Tracker
            </h1>
            <div
              style={{
                fontSize: typography.fontSize.xs,
                color: colors.text.tertiary,
                fontFamily: typography.fontFamily.body,
                marginTop: "2px",
              }}
            >
              Tax & benefit legislation, quantified
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: spacing["2xl"] }}>
          <StatPill label="Scored" value={scoredCount} accent={colors.primary[600]} />
          <StatPill label="Tracked" value={totalCount} />
          <StatPill label="Moved this week" value={momentumCount} />
        </div>
      </div>
    </header>
  );
}

function StatPill({ label, value, accent }) {
  return (
    <div>
      <div
        style={{
          fontSize: typography.fontSize["2xl"],
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: accent || colors.secondary[900],
          letterSpacing: "-0.02em",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "10px",
          fontWeight: typography.fontWeight.medium,
          color: colors.text.tertiary,
          fontFamily: typography.fontFamily.body,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginTop: "4px",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ============== Filter strip ==============

function FilterStrip({ jurisdictionFilter, setJurisdictionFilter, selectedState, clearSelectedState, onSelectState, sessionScope, onSessionChange, sessionOptions }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.lg,
        flexWrap: "wrap",
        marginBottom: spacing.lg,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "2px",
          backgroundColor: colors.gray[100],
          borderRadius: spacing.radius.lg,
          padding: "3px",
        }}
      >
        {[
          { id: "all", label: "All" },
          { id: "federal", label: "Federal" },
          { id: "state", label: "State" },
        ].map((t) => {
          const active = jurisdictionFilter === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setJurisdictionFilter(t.id);
                if (t.id !== "state") clearSelectedState?.();
              }}
              style={{
                padding: `6px ${spacing.md}`,
                border: "none",
                borderRadius: spacing.radius.md,
                backgroundColor: active ? colors.white : "transparent",
                boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                color: active ? colors.secondary[900] : colors.text.tertiary,
                fontSize: typography.fontSize.sm,
                fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.medium,
                fontFamily: typography.fontFamily.body,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {jurisdictionFilter === "state" && (
        <>
          <div style={{ width: "1px", height: "20px", backgroundColor: colors.border.light }} />
          <StatePicker selected={selectedState} onChange={onSelectState} onClear={clearSelectedState} />
        </>
      )}
      <div style={{ width: "1px", height: "20px", backgroundColor: colors.border.light }} />
      <SessionPicker options={sessionOptions} selected={sessionScope} onChange={onSessionChange} />
    </div>
  );
}

// ============== Session picker (inline popover) ==============

function SessionPicker({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  // If selected id no longer exists in the current jurisdiction's options (e.g. switched
  // between state/federal), snap back to "current".
  useEffect(() => {
    if (!options.some((o) => o.id === selected)) onChange("current");
  }, [options, selected, onChange]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    setAnchor(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onReflow = () => { if (triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect()); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  const current = options.find((o) => o.id === selected) || options[0];
  const active = selected !== "current";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: `5px ${spacing.md}`,
          border: `1px solid ${active ? colors.primary[300] : colors.border.light}`,
          backgroundColor: active ? colors.primary[50] : colors.white,
          color: active ? colors.primary[800] : colors.text.secondary,
          borderRadius: "999px",
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          fontWeight: typography.fontWeight.semibold,
          cursor: "pointer",
          transition: "all 0.15s",
          minHeight: "28px",
        }}
      >
        {current.label}
        <span style={{ opacity: 0.6, fontSize: "9px" }}>▾</span>
      </button>
      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: anchor.bottom + 4,
            left: Math.max(8, Math.min(window.innerWidth - 240 - 8, anchor.left)),
            width: "240px",
            backgroundColor: colors.white,
            borderRadius: spacing.radius.lg,
            border: `1px solid ${colors.border.light}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 1000,
            overflow: "hidden",
          }}
          role="listbox"
        >
          {options.map((o, idx) => {
            const isActive = selected === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  border: "none",
                  borderBottom: idx === options.length - 1 ? "none" : `1px solid ${colors.border.light}`,
                  background: isActive ? colors.primary[50] : "transparent",
                  padding: `${spacing.sm} ${spacing.md}`,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: typography.fontFamily.body,
                  fontSize: typography.fontSize.sm,
                  fontWeight: isActive ? typography.fontWeight.semibold : typography.fontWeight.medium,
                  color: isActive ? colors.primary[800] : colors.secondary[900],
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = colors.gray[50]; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                {o.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// ============== State picker (inline popover) ==============

function StatePicker({ selected, onChange, onClear }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const states = useMemo(
    () => Object.entries(stateData).map(([abbr, s]) => ({ abbr, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const filtered = useMemo(() => {
    if (!query) return states;
    const q = query.toLowerCase();
    return states.filter((s) => s.name.toLowerCase().startsWith(q) || s.abbr.toLowerCase().startsWith(q));
  }, [states, query]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    setAnchor(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onReflow = () => { if (triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect()); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  const activeStyle = selected ? {
    borderColor: colors.primary[300],
    backgroundColor: colors.primary[50],
    color: colors.primary[800],
  } : {
    borderColor: colors.border.light,
    backgroundColor: colors.white,
    color: colors.text.secondary,
  };

  return (
    <>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: `5px ${spacing.md}`,
            border: `1px solid ${activeStyle.borderColor}`,
            backgroundColor: activeStyle.backgroundColor,
            color: activeStyle.color,
            borderRadius: "999px",
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            fontWeight: typography.fontWeight.semibold,
            cursor: "pointer",
            transition: "all 0.15s",
            minHeight: "28px",
          }}
        >
          {selected ? (stateData[selected]?.name || selected) : "Pick a state"}
          <span style={{ opacity: 0.6, fontSize: "9px" }}>▾</span>
        </button>
        {selected && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear state filter"
            style={{
              border: "none",
              background: "transparent",
              color: colors.text.tertiary,
              cursor: "pointer",
              fontSize: "14px",
              lineHeight: 1,
              padding: "4px 6px",
              borderRadius: spacing.radius.sm,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.secondary[900])}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.text.tertiary)}
          >
            ×
          </button>
        )}
      </div>
      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: anchor.bottom + 4,
            left: Math.max(8, Math.min(window.innerWidth - 260 - 8, anchor.left)),
            width: "260px",
            maxHeight: "min(360px, 60vh)",
            display: "flex",
            flexDirection: "column",
            backgroundColor: colors.white,
            borderRadius: spacing.radius.lg,
            border: `1px solid ${colors.border.light}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 1000,
            overflow: "hidden",
          }}
          role="listbox"
        >
          <div style={{ padding: spacing.sm, borderBottom: `1px solid ${colors.border.light}` }}>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a state…"
              style={{
                width: "100%",
                padding: "6px 10px",
                border: `1px solid ${colors.border.light}`,
                borderRadius: spacing.radius.sm,
                fontSize: typography.fontSize.sm,
                fontFamily: typography.fontFamily.body,
                outline: "none",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", padding: "4px 0" }}>
            {filtered.length === 0 && (
              <div style={{ padding: `${spacing.sm} ${spacing.md}`, color: colors.text.tertiary, fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.body }}>
                No matches.
              </div>
            )}
            {filtered.map((s) => {
              const active = selected === s.abbr;
              return (
                <button
                  key={s.abbr}
                  type="button"
                  onClick={() => {
                    onChange(s.abbr);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px 1fr",
                    gap: spacing.sm,
                    alignItems: "center",
                    width: "100%",
                    border: "none",
                    background: active ? colors.primary[50] : "transparent",
                    padding: `6px ${spacing.md}`,
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: typography.fontFamily.body,
                    color: active ? colors.primary[800] : colors.secondary[900],
                    fontSize: typography.fontSize.sm,
                    fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.medium,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = colors.gray[50]; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: typography.fontWeight.bold,
                      color: active ? colors.primary[700] : colors.text.tertiary,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.abbr}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}


// ============== Card shell ==============

function Card({ children, padded = false, style }) {
  return (
    <div
      style={{
        backgroundColor: colors.white,
        borderRadius: spacing.radius["2xl"],
        boxShadow: "var(--shadow-elevation-low)",
        border: `1px solid ${colors.border.light}`,
        overflow: "hidden",
        ...(padded ? { padding: spacing.lg } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ eyebrow, title, subtitle, right }) {
  return (
    <div
      style={{
        padding: `${spacing.md} ${spacing.lg}`,
        borderBottom: `1px solid ${colors.border.light}`,
        backgroundColor: colors.background.secondary,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: spacing.md,
      }}
    >
      <div>
        {eyebrow && (
          <div
            style={{
              fontSize: "10px",
              fontWeight: typography.fontWeight.semibold,
              color: colors.primary[600],
              fontFamily: typography.fontFamily.body,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "4px",
            }}
          >
            {eyebrow}
          </div>
        )}
        <h2
          style={{
            margin: 0,
            fontSize: typography.fontSize.base,
            fontWeight: typography.fontWeight.bold,
            color: colors.secondary[900],
            fontFamily: typography.fontFamily.primary,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <div
            style={{
              fontSize: typography.fontSize.xs,
              color: colors.text.tertiary,
              fontFamily: typography.fontFamily.body,
              marginTop: "2px",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

// ============== Impact Index ==============

function ImpactIndexCard({ bills }) {
  return (
    <Card>
      <CardHeader eyebrow="Leading the index" title="Impact Index" subtitle="Scored bills ranked by fiscal reach and household impact" />
      {bills.length === 0 ? (
        <div
          style={{
            padding: spacing.xl,
            textAlign: "center",
            color: colors.text.tertiary,
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
          }}
        >
          Awaiting scored legislation.
        </div>
      ) : (
        <div>
          <ImpactHeaderRow />
          {bills.map((b, i) => (
            <ImpactRow key={b.id} rank={i + 1} bill={b} last={i === bills.length - 1} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ImpactHeaderRow() {
  const headerStyle = {
    fontSize: "10px",
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.tertiary,
    fontFamily: typography.fontFamily.body,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "36px 56px minmax(0, 1fr) 200px 140px",
        gap: spacing.md,
        padding: `${spacing.sm} ${spacing.lg}`,
        borderBottom: `1px solid ${colors.border.light}`,
        backgroundColor: colors.gray[50],
      }}
    >
      <div style={headerStyle}>#</div>
      <div style={headerStyle}>Locus</div>
      <div style={headerStyle}>Bill</div>
      <div style={headerStyle}>Households affected</div>
      <div style={{ ...headerStyle, textAlign: "right" }}>Budget, yr 1</div>
    </div>
  );
}

function ImpactRow({ rank, bill, last }) {
  const imp = bill.impact;
  const budget = readBudget(imp);
  const shares = winnersLosersShares(imp);
  const povertyPct = readPovertyPct(imp);

  const isFederal = bill.state === "all" || bill.state === "federal" || bill.jurisdiction_code === "US";
  const locus = isFederal ? "FED" : (bill.state || "").toUpperCase();
  const destination = `${BASE_PATH}/${isFederal ? "federal" : locus.toLowerCase()}/${bill.id}`;

  return (
    <a
      href={destination}
      onClick={(e) => {
        e.preventDefault();
        history.pushState(null, "", destination);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "36px 56px minmax(0, 1fr) 200px 140px",
        gap: spacing.md,
        padding: `${spacing.md} ${spacing.lg}`,
        borderBottom: last ? "none" : `1px solid ${colors.border.light}`,
        textDecoration: "none",
        color: "inherit",
        alignItems: "center",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.gray[50])}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <div
        style={{
          fontSize: typography.fontSize.base,
          fontWeight: typography.fontWeight.bold,
          color: colors.text.tertiary,
          fontFamily: typography.fontFamily.primary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(rank).padStart(2, "0")}
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2px 6px",
          borderRadius: spacing.radius.sm,
          border: `1px solid ${colors.primary[200]}`,
          backgroundColor: colors.primary[50],
          color: colors.primary[700],
          fontSize: "10px",
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.body,
          width: "40px",
        }}
      >
        {locus}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
            color: colors.secondary[900],
            fontFamily: typography.fontFamily.primary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: "-0.005em",
          }}
          title={bill.title}
        >
          {bill.title}
        </div>
        <div
          style={{
            fontSize: typography.fontSize.xs,
            color: colors.text.tertiary,
            fontFamily: typography.fontFamily.body,
            marginTop: "2px",
            display: "flex",
            gap: spacing.sm,
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: typography.fontWeight.medium, color: colors.text.secondary }}>{bill.id.toUpperCase()}</span>
          {povertyPct != null && povertyPct !== 0 && (
            <>
              <span>·</span>
              <span style={{ color: povertyPct < 0 ? colors.primary[700] : colors.red[600] }}>
                {povertyPct < 0 ? "↓" : "↑"} poverty {Math.abs(povertyPct).toFixed(2)}%
              </span>
            </>
          )}
        </div>
      </div>
      <div>
        {shares ? (
          <>
            <div
              style={{
                display: "flex",
                height: "8px",
                borderRadius: "999px",
                overflow: "hidden",
                backgroundColor: colors.gray[100],
              }}
            >
              <div style={{ width: `${shares.gain}%`, backgroundColor: colors.primary[600] }} />
              <div style={{ width: `${shares.neutral}%`, backgroundColor: "transparent" }} />
              <div style={{ width: `${shares.lose}%`, backgroundColor: colors.red[500] }} />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "10px",
                fontFamily: typography.fontFamily.body,
                marginTop: "4px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: colors.primary[700], fontWeight: typography.fontWeight.semibold }}>
                ▲ {shares.gain.toFixed(1)}%
              </span>
              <span style={{ color: colors.red[600], fontWeight: typography.fontWeight.semibold }}>
                ▼ {shares.lose.toFixed(1)}%
              </span>
            </div>
          </>
        ) : (
          <span style={{ color: colors.text.tertiary, fontSize: typography.fontSize.xs, fontStyle: "italic" }}>pending</span>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontSize: typography.fontSize.xl,
            fontWeight: typography.fontWeight.bold,
            color: budget != null ? (budget > 0 ? colors.red[600] : colors.primary[700]) : colors.text.tertiary,
            fontFamily: typography.fontFamily.primary,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {formatUSD(budget)}
        </div>
        <div
          style={{
            fontSize: "10px",
            color: colors.text.tertiary,
            fontFamily: typography.fontFamily.body,
            marginTop: "4px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: typography.fontWeight.medium,
          }}
        >
          state revenue / yr
        </div>
      </div>
    </a>
  );
}

// ============== Docket ==============

function DocketCard({ docket, loading, onBillClick, billToResearchId, normalizeBillNum }) {
  return (
    <Card>
      <CardHeader eyebrow="All tracked" title="On the Docket" subtitle={`${docket.length} bills`} />
      <div style={{ maxHeight: "520px", overflowY: "auto" }}>
        {loading && (
          <div
            style={{
              padding: spacing.xl,
              textAlign: "center",
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}
          >
            Loading…
          </div>
        )}
        {!loading && docket.length === 0 && (
          <div
            style={{
              padding: spacing.xl,
              textAlign: "center",
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}
          >
            No bills match the current view.
          </div>
        )}
        {!loading && docket.map((b, i) => (
          <DocketRow
            key={`${b.state}-${b.bill_number}-${i}`}
            bill={b}
            last={i === docket.length - 1}
            onClick={() => onBillClick(b)}
            isScored={!!billToResearchId[`${b.state}:${normalizeBillNum(b.bill_number)}`]}
          />
        ))}
      </div>
    </Card>
  );
}

function DocketRow({ bill, last, onClick, isScored }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        display: "grid",
        gridTemplateColumns: "36px minmax(0, 1fr) 60px",
        gap: spacing.sm,
        padding: `${spacing.sm} ${spacing.lg}`,
        borderBottom: last ? "none" : `1px solid ${colors.border.light}`,
        alignItems: "center",
        cursor: "pointer",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.gray[50])}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2px 4px",
          borderRadius: spacing.radius.sm,
          border: `1px solid ${colors.gray[200]}`,
          backgroundColor: colors.gray[50],
          color: colors.gray[700],
          fontSize: "10px",
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.body,
          height: "20px",
        }}
      >
        {bill.state}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.semibold,
              color: colors.secondary[900],
              fontFamily: typography.fontFamily.body,
            }}
          >
            {bill.bill_number}
          </span>
          <StageBadge stage={bill.status || "Introduced"} />
          {isScored && (
            <span
              style={{
                fontSize: "9px",
                color: colors.primary[700],
                fontFamily: typography.fontFamily.body,
                fontWeight: typography.fontWeight.semibold,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
              title="PolicyEngine analysis available"
            >
              PE
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: colors.text.secondary,
            fontFamily: typography.fontFamily.body,
            marginTop: "2px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.3,
          }}
          title={bill.title}
        >
          {bill.title}
        </div>
      </div>
      <div
        style={{
          fontSize: "10px",
          color: colors.text.tertiary,
          fontFamily: typography.fontFamily.body,
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {bill.last_action_date
          ? new Date(bill.last_action_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "—"}
      </div>
    </div>
  );
}

// ============== Enacted (Signed into Law) ==============

function EnactedCard({ bills, onBillClick, billToResearchId, normalizeBillNum }) {
  return (
    <Card>
      <CardHeader eyebrow="Signed into law" title="Enacted" subtitle={`${bills.length} bill${bills.length === 1 ? "" : "s"}`} />
      <div style={{ maxHeight: "520px", overflowY: "auto" }}>
        {bills.length === 0 ? (
          <div
            style={{
              padding: spacing.xl,
              textAlign: "center",
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}
          >
            Nothing enacted yet.
          </div>
        ) : (
          bills.map((b, i) => (
            <EnactedRow
              key={`enacted-${b.state}-${b.bill_number}-${i}`}
              bill={b}
              last={i === bills.length - 1}
              onClick={() => onBillClick(b)}
              isScored={!!billToResearchId[`${b.state}:${normalizeBillNum(b.bill_number)}`]}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function EnactedRow({ bill, last, onClick, isScored }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        padding: `${spacing.sm} ${spacing.lg}`,
        borderBottom: last ? "none" : `1px solid ${colors.border.light}`,
        cursor: "pointer",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.primary[50])}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "6px", marginBottom: "2px" }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "baseline", minWidth: 0 }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: typography.fontWeight.semibold,
              color: colors.primary[700],
              fontFamily: typography.fontFamily.body,
            }}
          >
            {bill.state} · {bill.bill_number}
          </span>
          {isScored && (
            <span
              style={{
                fontSize: "9px",
                color: colors.primary[700],
                fontWeight: typography.fontWeight.semibold,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
              title="PolicyEngine analysis available"
            >
              PE
            </span>
          )}
        </div>
        <span style={{ fontSize: "10px", color: colors.text.tertiary, fontFamily: typography.fontFamily.body }}>
          {bill.last_action_date ? new Date(bill.last_action_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
        </span>
      </div>
      <div
        style={{
          fontSize: "11px",
          color: colors.text.secondary,
          fontFamily: typography.fontFamily.body,
          lineHeight: 1.35,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
        title={bill.title}
      >
        {bill.title}
      </div>
    </div>
  );
}

// ============== Momentum ==============

function MomentumCard({ momentum, onBillClick, billToResearchId, normalizeBillNum }) {
  return (
    <Card>
      <CardHeader eyebrow="Last 7 days" title="Moving this Week" subtitle="Stage changes" />
      <div style={{ maxHeight: "520px", overflowY: "auto" }}>
        {momentum.length === 0 ? (
          <div
            style={{
              padding: spacing.xl,
              textAlign: "center",
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}
          >
            Quiet week.
          </div>
        ) : (
          momentum.map((b, i) => (
            <MomentumRow
              key={`m-${i}`}
              bill={b}
              last={i === momentum.length - 1}
              onClick={() => onBillClick(b)}
              isScored={!!billToResearchId[`${b.state}:${normalizeBillNum(b.bill_number)}`]}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function MomentumRow({ bill, last, onClick, isScored }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        padding: `${spacing.sm} ${spacing.lg}`,
        borderBottom: last ? "none" : `1px solid ${colors.border.light}`,
        cursor: "pointer",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.gray[50])}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px", gap: "6px" }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "baseline", minWidth: 0 }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: typography.fontWeight.semibold,
              color: colors.primary[700],
              fontFamily: typography.fontFamily.body,
            }}
          >
            {bill.state} · {bill.bill_number}
          </span>
          {isScored && (
            <span
              style={{
                fontSize: "9px",
                color: colors.primary[700],
                fontFamily: typography.fontFamily.body,
                fontWeight: typography.fontWeight.semibold,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
              title="PolicyEngine analysis available"
            >
              PE
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: "10px",
            color: colors.text.tertiary,
            fontFamily: typography.fontFamily.body,
          }}
        >
          {bill.last_action_date
            ? new Date(bill.last_action_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "—"}
        </span>
      </div>
      <div style={{ marginBottom: "4px" }}>
        <StageBadge stage={bill.status || "Introduced"} />
      </div>
      <div
        style={{
          fontSize: "11px",
          color: colors.text.secondary,
          fontFamily: typography.fontFamily.body,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: 1.3,
        }}
        title={bill.title}
      >
        {bill.title}
      </div>
    </div>
  );
}

// ============== Request CTA ==============

function RequestCta() {
  return (
    <div
      style={{
        marginTop: spacing.lg,
        backgroundColor: colors.white,
        borderRadius: spacing.radius["2xl"],
        border: `1px solid ${colors.border.light}`,
        boxShadow: "var(--shadow-elevation-low)",
        padding: spacing.lg,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.lg,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div
          style={{
            fontSize: "10px",
            fontWeight: typography.fontWeight.semibold,
            color: colors.primary[600],
            fontFamily: typography.fontFamily.body,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "4px",
          }}
        >
          Commission analysis
        </div>
        <h3
          style={{
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.bold,
            color: colors.secondary[900],
            fontFamily: typography.fontFamily.primary,
            letterSpacing: "-0.01em",
          }}
        >
          Bill you care about not in here?
        </h3>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: typography.fontSize.sm,
            color: colors.text.secondary,
            fontFamily: typography.fontFamily.body,
            maxWidth: "560px",
            lineHeight: 1.45,
          }}
        >
          Point us at a bill and we'll run distributional impact, poverty reach, and district-level cuts — usually within a week.
        </p>
      </div>
      <a
        href="mailto:hello@policyengine.org?subject=Bill%20analysis%20request"
        style={{
          padding: `${spacing.sm} ${spacing.lg}`,
          backgroundColor: colors.primary[600],
          color: colors.white,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.body,
          textDecoration: "none",
          borderRadius: spacing.radius.lg,
          whiteSpace: "nowrap",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.primary[700])}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = colors.primary[600])}
      >
        Request analysis →
      </a>
    </div>
  );
}

