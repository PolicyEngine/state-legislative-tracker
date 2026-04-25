import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import Breadcrumb from "./components/Breadcrumb";
import StateSearchCombobox from "./components/StateSearchCombobox";

const FederalPanel = lazy(() => import("./components/FederalPanel"));
const StatePanel = lazy(() => import("./components/StatePanel"));
const ReformAnalyzer = lazy(() => import("./components/reform/ReformAnalyzer"));
const RedesignHome = lazy(() => import("./components/RedesignHome"));
import { useData } from "./context/DataContext";
import { stateData } from "./data/states";
import { colors, typography, spacing } from "./designTokens";
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

  // Home renders the editorial-style RedesignHome with its own masthead;
  // state/bill pages still use the app shell below.
  if (!selectedJurisdiction) {
    return (
      <Suspense fallback={<LoadingPlaceholder />}>
        <RedesignHome />
      </Suspense>
    );
  }

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
