import { useState, useEffect, useCallback, useMemo } from "react";
import USMap from "./components/USMap";
import StatePanel from "./components/StatePanel";
import Breadcrumb from "./components/Breadcrumb";
import StateSearchCombobox from "./components/StateSearchCombobox";
import ReformAnalyzer from "./components/reform/ReformAnalyzer";
import { RecentActivitySidebar } from "./components/BillActivityFeed";
import { useData } from "./context/DataContext";
import { stateData } from "./data/states";
import { colors, mapColors, typography, spacing } from "./designTokens";
import { track } from "./lib/analytics";
import { BASE_PATH } from "./lib/basePath";

function parsePath() {
  // Support old hash URLs for backward compat
  const hash = window.location.hash.replace(/^#/, "");
  // Strip BASE_PATH prefix before parsing
  const raw = hash || window.location.pathname;
  const path = (BASE_PATH ? raw.replace(BASE_PATH, "") : raw).replace(/^\//, "");
  if (!path) return { state: null, billId: null };
  const parts = path.split("/");
  const state = parts[0].toUpperCase();
  const billId = parts[1] || null;
  return { state: stateData[state] ? state : null, billId };
}

function notifyParent(path) {
  window.parent.postMessage({ type: "pathchange", path }, "*");
  window.parent.postMessage({ type: "hashchange", hash: path.replace(/^\//, "") }, "*");
}

function App() {
  const { statesWithBills, getBillsForState } = useData();
  const [selectedState, setSelectedState] = useState(() => parsePath().state);
  const [billId, setBillId] = useState(() => parsePath().billId);

  const activeStates = useMemo(
    () =>
      Object.entries(statesWithBills)
        .map(([abbr, count]) => ({ abbr, name: stateData[abbr]?.name, count }))
        .filter((s) => s.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [statesWithBills],
  );

  // Redirect old hash URLs to path URLs
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      history.replaceState(null, "", BASE_PATH + "/" + hash);
    }
  }, []);

  const handleStateSelect = useCallback((abbr) => {
    setSelectedState(abbr);
    setBillId(null);
    if (abbr) {
      history.pushState(null, "", BASE_PATH + "/" + abbr);
      notifyParent("/" + abbr);
      track("state_selected", { state_abbr: abbr, state_name: stateData[abbr]?.name });
    } else {
      history.pushState(null, "", BASE_PATH + "/");
      notifyParent("/");
    }
  }, []);

  const handleBillSelect = useCallback((stateAbbr, id) => {
    setSelectedState(stateAbbr);
    setBillId(id);
    history.pushState(null, "", `${BASE_PATH}/${stateAbbr}/${id}`);
    notifyParent(`/${stateAbbr}/${id}`);
  }, []);

  const handleNavigateHome = useCallback(() => {
    handleStateSelect(null);
  }, [handleStateSelect]);

  const handleNavigateState = useCallback(() => {
    if (selectedState) {
      handleStateSelect(selectedState);
    }
  }, [selectedState, handleStateSelect]);

  useEffect(() => {
    const onPopState = () => {
      const { state, billId: bid } = parsePath();
      setSelectedState(state);
      setBillId(bid);
      const strippedPath = BASE_PATH
        ? window.location.pathname.replace(BASE_PATH, "")
        : window.location.pathname;
      notifyParent(strippedPath);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Resolve bill for bill page
  const activeBill = useMemo(() => {
    if (!selectedState || !billId) return null;
    const bills = getBillsForState(selectedState);
    return bills.find((b) => b.id === billId) || null;
  }, [selectedState, billId, getBillsForState]);

  // Determine view
  const isBillPage = selectedState && billId && activeBill?.reformConfig;
  const isStatePage = selectedState && !isBillPage;

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Header */}
      <header
        className="header-accent"
        style={{
          backgroundColor: colors.white,
          boxShadow: "var(--shadow-elevation-low)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ maxWidth: "1400px", margin: "0 auto", padding: `${spacing.xl} ${spacing["2xl"]}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: spacing.lg }}>
              <a href="https://policyengine.org" target="_blank" rel="noopener noreferrer">
                <img
                  src="/policyengine-favicon.svg"
                  alt="PolicyEngine"
                  style={{ height: "40px", width: "auto" }}
                />
              </a>
              <div>
                <h1 style={{
                  margin: 0,
                  color: colors.secondary[900],
                  fontSize: typography.fontSize["2xl"],
                  fontWeight: typography.fontWeight.bold,
                  fontFamily: typography.fontFamily.primary,
                  letterSpacing: "-0.02em",
                }}>
                  2026 State Legislative Tracker
                </h1>
                <p style={{
                  margin: "2px 0 0",
                  color: colors.text.secondary,
                  fontSize: typography.fontSize.sm,
                  fontFamily: typography.fontFamily.body,
                }}>
                  PolicyEngine State Tax Research
                </p>
              </div>
            </div>
            <StateSearchCombobox onSelect={handleStateSelect} statesWithBills={statesWithBills} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: `${spacing["2xl"]} ${spacing["2xl"]} ${spacing["4xl"]}` }}>

        {/* === Bill Page === */}
        {isBillPage && (
          <div className="animate-fade-in-up">
            <Breadcrumb
              stateAbbr={selectedState}
              billLabel={activeBill.reformConfig.label || activeBill.bill}
              onNavigateHome={handleNavigateHome}
              onNavigateState={handleNavigateState}
            />
            <ReformAnalyzer
              reformConfig={activeBill.reformConfig}
              stateAbbr={selectedState}
              billUrl={activeBill.url}
              bill={activeBill}
            />
          </div>
        )}

        {/* === State Page === */}
        {isStatePage && (
          <div className="animate-fade-in-up">
            <Breadcrumb
              stateAbbr={selectedState}
              onNavigateHome={handleNavigateHome}
            />
            <StatePanel
              stateAbbr={selectedState}
              onNavigateHome={handleNavigateHome}
              onBillSelect={(id) => handleBillSelect(selectedState, id)}
            />
          </div>
        )}

        {/* === Home Page === */}
        {!selectedState && (
          <>
            {/* Intro */}
            <div className="animate-fade-in-up" style={{ marginBottom: spacing["2xl"] }}>
              <h2 style={{
                margin: `0 0 ${spacing.sm}`,
                color: colors.secondary[900],
                fontSize: typography.fontSize["3xl"],
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
                letterSpacing: "-0.02em",
              }}>
                State Tax Policy Research
              </h2>
              <p style={{
                margin: 0,
                color: colors.text.secondary,
                fontSize: typography.fontSize.base,
                fontFamily: typography.fontFamily.body,
                maxWidth: "none",
                lineHeight: "1.6",
              }}>
                Explore state legislative sessions and PolicyEngine analysis. <strong>Select a state</strong> to see tax changes, active bills, and related research.
              </p>
            </div>

            {/* Two-column layout: Map + sidebar */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 340px",
              gap: spacing.lg,
              alignItems: "start",
              marginBottom: spacing["2xl"],
            }}>
              {/* Left column: Map + chips + quick links */}
              <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
                {/* Map */}
                <div
                  className="animate-fade-in-up"
                  style={{
                    backgroundColor: colors.white,
                    borderRadius: spacing.radius["2xl"],
                    boxShadow: "var(--shadow-elevation-low)",
                    border: `1px solid ${colors.border.light}`,
                    padding: spacing.lg,
                    transition: "box-shadow 0.3s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <USMap
                        selectedState={selectedState}
                        onStateSelect={handleStateSelect}
                      />
                    </div>
                    {/* Legend */}
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: spacing.sm,
                      paddingLeft: spacing.lg,
                      marginLeft: spacing.lg,
                      borderLeft: `1px solid ${colors.border.light}`,
                      alignSelf: "center",
                      flexShrink: 0,
                    }}>
                      <LegendItem color={mapColors.inSession} label="In Session" />
                      <LegendItem color={mapColors.upcoming} label="Upcoming" />
                      <LegendItem color={mapColors.ended} label="Ended" />
                      <LegendItem color={mapColors.noSession} label="No 2026 Session" />
                    </div>
                  </div>

                  {/* State chips by region */}
                  {activeStates.length > 0 && (
                    <div style={{
                      marginTop: spacing.lg,
                      paddingTop: spacing.md,
                      borderTop: `1px solid ${colors.border.light}`,
                    }}>
                      <h4 style={{
                        margin: `0 0 ${spacing.md}`,
                        color: colors.text.tertiary,
                        fontSize: typography.fontSize.xs,
                        fontWeight: typography.fontWeight.semibold,
                        fontFamily: typography.fontFamily.primary,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        textAlign: "center",
                      }}>
                        States with Published Analysis
                      </h4>
                      <RegionChips states={activeStates} onSelect={handleStateSelect} />
                    </div>
                  )}
                </div>

                {/* Quick Links */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: spacing.md,
                }}>
                  <QuickLinkCard
                    href="https://policyengine.org/us/research"
                    title="Full Research Library"
                    description="Browse all PolicyEngine state and federal research"
                  />
                  <QuickLinkCard
                    href="https://app.policyengine.org/us/reports"
                    title="Build a Reform"
                    description="Model your own tax policy reforms"
                  />
                  <QuickLinkCard
                    href="mailto:hello@policyengine.org?subject=State Legislative Analysis Request"
                    title="Get in Contact"
                    description="Get custom analysis for your state's legislation"
                  />
                </div>
              </div>

              {/* Right column: Recent Activity */}
              <div className="animate-fade-in-up" style={{ position: "sticky", top: "80px" }}>
                <RecentActivitySidebar onStateSelect={handleStateSelect} onBillSelect={handleBillSelect} />
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        backgroundColor: colors.secondary[900],
        color: colors.white,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Gradient accent at top */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "3px",
          background: "linear-gradient(90deg, #2C7A7B 0%, #38B2AC 50%, #0EA5E9 100%)",
        }} />
        <div style={{
          maxWidth: "1400px",
          margin: "0 auto",
          padding: `${spacing["2xl"]} ${spacing["2xl"]}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <p style={{
            margin: 0,
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.gray[400],
          }}>
            © {new Date().getFullYear()} PolicyEngine. Open-source tax and benefit policy simulation.
          </p>
          <div style={{ display: "flex", gap: spacing.lg }}>
            <FooterLink href="https://github.com/policyengine">GitHub</FooterLink>
            <FooterLink href="https://policyengine.org">PolicyEngine.org</FooterLink>
          </div>
        </div>
      </footer>
    </div>
  );
}

const REGIONS = {
  Northeast: ["CT", "ME", "MA", "NH", "NJ", "NY", "PA", "RI", "VT"],
  South: ["AL", "AR", "DC", "DE", "FL", "GA", "KY", "LA", "MD", "MS", "NC", "OK", "SC", "TN", "TX", "VA", "WV"],
  Midwest: ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"],
  West: ["AK", "AZ", "CA", "CO", "HI", "ID", "MT", "NV", "NM", "OR", "UT", "WA", "WY"],
};

function StateChip({ abbr, count, onSelect }) {
  return (
    <button
      onClick={() => onSelect(abbr)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.xs,
        padding: `${spacing.xs} ${spacing.md}`,
        border: `1px solid ${colors.primary[200]}`,
        borderRadius: spacing.radius.xl,
        backgroundColor: colors.primary[50],
        color: colors.primary[700],
        fontSize: typography.fontSize.sm,
        fontWeight: typography.fontWeight.medium,
        fontFamily: typography.fontFamily.body,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = colors.primary[100];
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = colors.primary[50];
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {abbr}
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        backgroundColor: colors.primary[200],
        color: colors.primary[800],
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.semibold,
        lineHeight: 1,
      }}>
        {count}
      </span>
    </button>
  );
}

function RegionChips({ states, onSelect }) {
  const stateMap = Object.fromEntries(states.map((s) => [s.abbr, s]));
  const regions = Object.entries(REGIONS)
    .map(([region, abbrs]) => ({
      region,
      states: abbrs.filter((a) => stateMap[a]).map((a) => stateMap[a]),
    }))
    .filter((r) => r.states.length > 0);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${regions.length}, 1fr)`,
      gap: spacing.lg,
    }}>
      {regions.map(({ region, states: regionStates }) => (
        <div key={region}>
          <p style={{
            margin: `0 0 ${spacing.sm}`,
            color: colors.text.tertiary,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            fontWeight: typography.fontWeight.medium,
            textAlign: "center",
          }}>
            {region}
          </p>
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: spacing.xs,
            justifyContent: "center",
          }}>
            {regionStates.map((s) => (
              <StateChip key={s.abbr} abbr={s.abbr} count={s.count} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Legend Item Component
function LegendItem({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
      <span style={{
        width: "12px",
        height: "12px",
        borderRadius: "3px",
        backgroundColor: color,
      }} />
      <span style={{
        color: colors.text.secondary,
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        fontWeight: typography.fontWeight.medium,
      }}>{label}</span>
    </div>
  );
}

// Quick Link Card Component
function QuickLinkCard({ href, title, description }) {
  return (
    <a
      href={href}
      target={href.startsWith("mailto") ? undefined : "_blank"}
      rel={href.startsWith("mailto") ? undefined : "noopener noreferrer"}
      onClick={() => track("external_link_clicked", { href, title })}
      className="card-hover"
      style={{
        display: "block",
        backgroundColor: colors.white,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        padding: spacing.lg,
        textDecoration: "none",
        boxShadow: "var(--shadow-elevation-low)",
      }}
    >
      <h4 style={{
        margin: `0 0 ${spacing.xs}`,
        color: colors.secondary[900],
        fontSize: typography.fontSize.base,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.primary,
        transition: "color 0.2s ease",
      }}>{title}</h4>
      <p style={{
        margin: 0,
        color: colors.text.secondary,
        fontSize: typography.fontSize.sm,
        fontFamily: typography.fontFamily.body,
      }}>{description}</p>
    </a>
  );
}

// Footer Link Component
function FooterLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: colors.gray[400],
        textDecoration: "none",
        fontSize: typography.fontSize.sm,
        fontFamily: typography.fontFamily.body,
        fontWeight: typography.fontWeight.medium,
        transition: "color 0.2s ease",
      }}
      onMouseEnter={(e) => e.currentTarget.style.color = colors.primary[300]}
      onMouseLeave={(e) => e.currentTarget.style.color = colors.gray[400]}
    >
      {children}
    </a>
  );
}

export default App;
