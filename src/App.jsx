"use client";

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import Breadcrumb from "./components/Breadcrumb";
import StateSearchCombobox from "./components/StateSearchCombobox";

const StatePanel = lazy(() => import("./components/StatePanel"));
const ReformAnalyzer = lazy(() => import("./components/reform/ReformAnalyzer"));
const RedesignHome = lazy(() => import("./components/RedesignHome"));
import { useData } from "./context/DataContext";
import { stateData } from "./data/states";
import { colors, typography, spacing } from "./designTokens";
import { track } from "./lib/analytics";
import { BASE_PATH } from "./lib/basePath";

function parsePath() {
  // Support old hash URLs for backward compat
  const hash = window.location.hash.replace(/^#/, "");
  // Strip BASE_PATH prefix before parsing
  const raw = hash || window.location.pathname;
  const path = (BASE_PATH ? raw.replace(BASE_PATH, "") : raw).replace(/^\//, "");
  if (!path) return { jurisdiction: null, billId: null };
  const parts = path.split("/");
  const state = parts[0].toUpperCase();
  const billId = parts[1] || null;
  // "US" is the federal jurisdiction; other unknown segments (including
  // retired /federal URLs) fall back to home.
  const isKnown = Boolean(stateData[state]) || state === "US";
  return { jurisdiction: isKnown ? state : null, billId };
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
  const { statesWithBills, getBillsForState } = useData();
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
      track("state_selected", { state_abbr: jurisdiction, state_name: stateData[jurisdiction]?.name });
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
    return getBillsForState(selectedJurisdiction).find((b) => b.id === billId) || null;
  }, [selectedJurisdiction, billId, getBillsForState]);

  // Determine view
  const isBillPage = selectedJurisdiction && billId && activeBill?.reformConfig;
  const isJurisdictionPage = selectedJurisdiction && !isBillPage;

  // Home renders the editorial-style RedesignHome with its own masthead;
  // state/bill pages still use the app shell below. Federal has no
  // StatePanel equivalent — /us browsing is the home view with the
  // federal filter preselected.
  if (!selectedJurisdiction || (selectedJurisdiction === "US" && !isBillPage)) {
    return (
      <Suspense fallback={<LoadingPlaceholder />}>
        <RedesignHome
          initialJurisdictionFilter={selectedJurisdiction === "US" ? "federal" : undefined}
        />
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
        <div className="app-header-inner" style={{ maxWidth: "1400px", margin: "0 auto", padding: `${spacing.md} ${spacing["2xl"]}` }}>
          <div className="app-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="app-header-brand" style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
              <a href="https://policyengine.org" target="_blank" rel="noopener noreferrer" aria-label="Visit PolicyEngine.org">
                <img
                  src="/policyengine-favicon.svg"
                  alt="PolicyEngine logo"
                  width="32"
                  height="32"
                  style={{ height: "32px", width: "auto" }}
                />
              </a>
              <h1 style={{ margin: 0 }}>
                <button
                  onClick={handleNavigateHome}
                  aria-label="Bill Tracker home"
                  style={{
                    border: "none",
                    background: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: colors.secondary[900],
                    fontSize: typography.fontSize.lg,
                    fontWeight: typography.fontWeight.bold,
                    fontFamily: typography.fontFamily.primary,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Bill Tracker
                </button>
              </h1>
            </div>
            <StateSearchCombobox onSelect={handleJurisdictionSelect} statesWithBills={statesWithBills} />
          </div>
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

        {/* === State Page === */}
        {isJurisdictionPage && (
          <div className="animate-fade-in-up">
            <Breadcrumb
              jurisdiction={selectedJurisdiction}
              onNavigateHome={handleNavigateHome}
            />
            <Suspense fallback={<LoadingPlaceholder />}>
              <StatePanel
                key={selectedJurisdiction}
                stateAbbr={selectedJurisdiction}
                onBillSelect={(id) => handleBillSelect(selectedJurisdiction, id)}
              />
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
          <nav aria-label="Footer navigation" className="app-footer-links" style={{ display: "flex", gap: spacing.lg }}>
            <FooterLink href="https://github.com/policyengine">GitHub</FooterLink>
            <FooterLink href="https://policyengine.org">PolicyEngine.org</FooterLink>
          </nav>
        </div>
      </footer>
    </div>
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
