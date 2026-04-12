import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import USMap from "./components/USMap";
import Breadcrumb from "./components/Breadcrumb";
import StateSearchCombobox from "./components/StateSearchCombobox";
import { RecentActivitySidebar } from "./components/BillActivityFeed";

const FederalPanel = lazy(() => import("./components/FederalPanel"));
const StatePanel = lazy(() => import("./components/StatePanel"));
const ReformAnalyzer = lazy(() => import("./components/reform/ReformAnalyzer"));
import { useData } from "./context/DataContext";
import { stateData } from "./data/states";
import { colors, mapColors, typography, spacing } from "./designTokens";
import { track } from "./lib/analytics";
import { BASE_PATH } from "./lib/basePath";
import {
  FEDERAL_JURISDICTION,
  isFederalJurisdiction,
  isStateJurisdiction,
} from "./lib/jurisdictions";

function parsePath() {
  // Support old hash URLs for backward compat
  const hash = window.location.hash.replace(/^#/, "");
  // Strip BASE_PATH prefix before parsing
  const raw = hash || window.location.pathname;
  const path = (BASE_PATH ? raw.replace(BASE_PATH, "") : raw).replace(/^\//, "");
  if (!path) return { jurisdiction: null, billId: null };
  const parts = path.split("/");
  const segment = parts[0];
  const state = segment.toUpperCase();
  const billId = parts[1] || null;
  if (segment.toLowerCase() === FEDERAL_JURISDICTION) {
    return { jurisdiction: FEDERAL_JURISDICTION, billId };
  }
  return { jurisdiction: stateData[state] ? state : null, billId };
}

function notifyParent(path) {
  window.parent.postMessage({ type: "pathchange", path }, "*");
  window.parent.postMessage({ type: "hashchange", hash: path.replace(/^\//, "") }, "*");
}

function LoadingPlaceholder() {
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing["4xl"],
      color: colors.text.tertiary,
      fontSize: typography.fontSize.sm,
      fontFamily: typography.fontFamily.body,
    }}>
      Loading…
    </div>
  );
}

function App() {
  const { statesWithBills, getBillsForState, getFederalBills } = useData();
  const [selectedJurisdiction, setSelectedJurisdiction] = useState(() => parsePath().jurisdiction);
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

  const handleJurisdictionSelect = useCallback((jurisdiction) => {
    setSelectedJurisdiction(jurisdiction);
    setBillId(null);
    if (jurisdiction) {
      history.pushState(null, "", BASE_PATH + "/" + jurisdiction);
      notifyParent("/" + jurisdiction);
      if (isFederalJurisdiction(jurisdiction)) {
        track("federal_selected", { jurisdiction });
      } else {
        track("state_selected", { state_abbr: jurisdiction, state_name: stateData[jurisdiction]?.name });
      }
    } else {
      history.pushState(null, "", BASE_PATH + "/");
      notifyParent("/");
    }
  }, []);

  const handleBillSelect = useCallback((jurisdiction, id) => {
    setSelectedJurisdiction(jurisdiction);
    setBillId(id);
    history.pushState(null, "", `${BASE_PATH}/${jurisdiction}/${id}`);
    notifyParent(`/${jurisdiction}/${id}`);
  }, []);

  const handleNavigateHome = useCallback(() => {
    handleJurisdictionSelect(null);
  }, [handleJurisdictionSelect]);

  const handleNavigateJurisdiction = useCallback(() => {
    if (selectedJurisdiction) {
      handleJurisdictionSelect(selectedJurisdiction);
    }
  }, [selectedJurisdiction, handleJurisdictionSelect]);

  useEffect(() => {
    const onPopState = () => {
      const { jurisdiction, billId: bid } = parsePath();
      setSelectedJurisdiction(jurisdiction);
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
    if (!selectedJurisdiction || !billId) return null;
    const bills = isFederalJurisdiction(selectedJurisdiction)
      ? getFederalBills()
      : getBillsForState(selectedJurisdiction);
    return bills.find((b) => b.id === billId) || null;
  }, [selectedJurisdiction, billId, getBillsForState, getFederalBills]);

  // Determine view
  const isBillPage =
    isStateJurisdiction(selectedJurisdiction) &&
    selectedJurisdiction &&
    billId &&
    activeBill?.reformConfig;
  const isJurisdictionPage = selectedJurisdiction && !isBillPage;

  return (
    <div className="app-shell" style={{ minHeight: "100vh" }}>
      {/* Header */}
      <header
        style={{
          backgroundColor: colors.white,
          boxShadow: "var(--shadow-elevation-low)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div className="app-header-inner" style={{ maxWidth: "1400px", margin: "0 auto", padding: `${spacing.md} ${spacing["2xl"]} 0` }}>
          <div className="app-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="app-header-brand" style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
              <a href="https://policyengine.org" target="_blank" rel="noopener noreferrer">
                <img
                  src="/policyengine-favicon.svg"
                  alt="PolicyEngine"
                  style={{ height: "32px", width: "auto" }}
                />
              </a>
              <h1 style={{
                margin: 0,
                color: colors.secondary[900],
                fontSize: typography.fontSize.lg,
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
                letterSpacing: "-0.02em",
              }}>
                Bill Tracker
              </h1>
            </div>
            <StateSearchCombobox onSelect={handleJurisdictionSelect} statesWithBills={statesWithBills} />
          </div>
          <nav className="app-nav" style={{ display: "flex", gap: spacing.xs, marginTop: spacing.md }}>
            <NavTab
              active={!isFederalJurisdiction(selectedJurisdiction)}
              onClick={() => { if (selectedJurisdiction) handleJurisdictionSelect(null); }}
            >
              States
            </NavTab>
            <NavTab
              active={isFederalJurisdiction(selectedJurisdiction)}
              onClick={() => { if (!isFederalJurisdiction(selectedJurisdiction)) handleJurisdictionSelect(FEDERAL_JURISDICTION); }}
            >
              Federal
            </NavTab>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main" style={{ maxWidth: "1400px", margin: "0 auto", padding: `${spacing["2xl"]} ${spacing["2xl"]} ${spacing["4xl"]}` }}>

        {/* === Bill Page === */}
        {isBillPage && (
          <div className="animate-fade-in-up">
            <Breadcrumb
              jurisdiction={selectedJurisdiction}
              billLabel={activeBill.reformConfig.label || activeBill.bill}
              onNavigateHome={handleNavigateHome}
              onNavigateJurisdiction={handleNavigateJurisdiction}
            />
            <Suspense fallback={<LoadingPlaceholder />}>
              <ReformAnalyzer
                reformConfig={activeBill.reformConfig}
                stateAbbr={selectedJurisdiction}
                bill={activeBill}
              />
            </Suspense>
          </div>
        )}

        {/* === Jurisdiction Page === */}
        {isJurisdictionPage && (
          <div className="animate-fade-in-up">
            <Suspense fallback={<LoadingPlaceholder />}>
              {isFederalJurisdiction(selectedJurisdiction) ? (
                <FederalPanel />
              ) : (
                <StatePanel
                  stateAbbr={selectedJurisdiction}
                  onBillSelect={(id) => handleBillSelect(selectedJurisdiction, id)}
                />
              )}
            </Suspense>
          </div>
        )}

        {/* === Home Page === */}
        {!selectedJurisdiction && (
          <>
            <div className="animate-fade-in-up" style={{ marginBottom: spacing.xl }}>
              <h2 style={{
                margin: 0,
                color: colors.secondary[900],
                fontSize: typography.fontSize["2xl"],
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
                letterSpacing: "-0.02em",
              }}>
                Select a state to explore legislation
              </h2>
              <p style={{
                margin: `${spacing.xs} 0 0`,
                color: colors.text.secondary,
                fontSize: typography.fontSize.sm,
                fontFamily: typography.fontFamily.body,
              }}>
                Click a state on the map or use the search bar above.
              </p>
            </div>

            <div className="app-home-grid" style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 340px",
              gap: spacing.lg,
              alignItems: "start",
              marginBottom: spacing["2xl"],
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
                <div
                  className="app-map-card animate-fade-in-up"
                  style={{
                    backgroundColor: colors.white,
                    borderRadius: spacing.radius["2xl"],
                    boxShadow: "var(--shadow-elevation-low)",
                    border: `1px solid ${colors.border.light}`,
                    padding: spacing.lg,
                    transition: "box-shadow 0.3s ease",
                  }}
                >
                  <div className="app-map-layout" style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <USMap
                        selectedState={isStateJurisdiction(selectedJurisdiction) ? selectedJurisdiction : null}
                        onStateSelect={handleJurisdictionSelect}
                      />
                    </div>
                    <div className="app-map-legend" style={{
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

                  {activeStates.length > 0 && (
                    <div style={{
                      marginTop: spacing.lg,
                      paddingTop: spacing.md,
                      borderTop: `1px solid ${colors.border.light}`,
                    }}>
                      <h3 style={{
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
                      </h3>
                      <RegionChips states={activeStates} onSelect={handleJurisdictionSelect} />
                    </div>
                  )}
                </div>

                <div className="animate-fade-in-up app-recent-activity-mobile">
                  <RecentActivitySidebar onStateSelect={handleJurisdictionSelect} onBillSelect={handleBillSelect} />
                </div>

                <div className="app-quick-links" style={{
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

              <div className="animate-fade-in-up app-sidebar-sticky app-recent-activity-desktop" style={{ position: "sticky", top: "80px" }}>
                <RecentActivitySidebar onStateSelect={handleJurisdictionSelect} onBillSelect={handleBillSelect} />
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
        <div className="app-footer-inner" style={{
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
          <div className="app-footer-links" style={{ display: "flex", gap: spacing.lg }}>
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

function StateChip({ abbr, name, count, onSelect }) {
  return (
    <button
      onClick={() => onSelect(abbr)}
      aria-label={`${name || abbr} — ${count} ${count === 1 ? "bill" : "bills"}`}
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
    <div className="region-chips-grid" style={{
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
              <StateChip key={s.abbr} abbr={s.abbr} name={s.name} count={s.count} onSelect={onSelect} />
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
      <h3 style={{
        margin: `0 0 ${spacing.xs}`,
        color: colors.secondary[900],
        fontSize: typography.fontSize.base,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.primary,
        transition: "color 0.2s ease",
      }}>{title}</h3>
      <p style={{
        margin: 0,
        color: colors.text.secondary,
        fontSize: typography.fontSize.sm,
        fontFamily: typography.fontFamily.body,
      }}>{description}</p>
    </a>
  );
}

// Nav Tab Component
function NavTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`app-nav-tab${active ? " app-nav-tab--active" : ""}`}
    >
      {children}
    </button>
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
