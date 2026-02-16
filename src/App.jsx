import { useState, useEffect, useCallback } from "react";
import USMap from "./components/USMap";
import StatePanel from "./components/StatePanel";
import { stateData } from "./data/states";
import { colors, mapColors, typography, spacing } from "./designTokens";
import { track } from "./lib/analytics";

function parsePath() {
  // Support old hash URLs for backward compat
  const hash = window.location.hash.replace(/^#/, "");
  const path = hash || window.location.pathname.replace(/^\//, "");
  if (!path) return { state: null, billId: null };
  const parts = path.split("/");
  const state = parts[0].toUpperCase();
  const billId = parts[1] || null;
  return { state: stateData[state] ? state : null, billId };
}

function App() {
  const [selectedState, setSelectedState] = useState(() => parsePath().state);
  const [initialBillId, setInitialBillId] = useState(() => parsePath().billId);

  // Redirect old hash URLs to path URLs
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      history.replaceState(null, "", "/" + hash);
    }
  }, []);

  const handleStateSelect = useCallback((abbr) => {
    setSelectedState(abbr);
    setInitialBillId(null);
    if (abbr) {
      history.pushState(null, "", "/" + abbr);
      track("state_selected", { state_abbr: abbr, state_name: stateData[abbr]?.name });
    } else {
      history.pushState(null, "", "/");
      window.parent.postMessage({ type: "pathchange", path: "/" }, "*");
      window.parent.postMessage({ type: "hashchange", hash: "" }, "*");
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const { state, billId } = parsePath();
      setSelectedState(state);
      setInitialBillId(billId);
      // Notify parent frame of path change for deep linking
      window.parent.postMessage(
        { type: "pathchange", path: window.location.pathname },
        "*",
      );
      window.parent.postMessage(
        { type: "hashchange", hash: window.location.pathname.replace(/^\//, "") },
        "*",
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: `${spacing["2xl"]} ${spacing["2xl"]} ${spacing["4xl"]}` }}>
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
            maxWidth: "680px",
            lineHeight: "1.6",
          }}>
            Explore state legislative sessions and PolicyEngine analysis. Click a state to see tax changes, active bills, and related research.
          </p>
        </div>

        {/* Map and Panel */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing["2xl"] }}>
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
            <USMap
              selectedState={selectedState}
              onStateSelect={handleStateSelect}
            />
            {/* Legend */}
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: spacing.lg,
              marginTop: spacing.lg,
              paddingTop: spacing.md,
              borderTop: `1px solid ${colors.border.light}`,
            }}>
              <LegendItem color={mapColors.inSession} label="In Session" />
              <LegendItem color={mapColors.upcoming} label="Upcoming" />
              <LegendItem color={mapColors.ended} label="Ended" />
              <LegendItem color={mapColors.noSession} label="No 2026 Session" />
            </div>
          </div>

          {/* State Panel or Placeholder */}
          <div className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            {selectedState ? (
              <StatePanel
                stateAbbr={selectedState}
                initialBillId={initialBillId}
                onClose={() => handleStateSelect(null)}
              />
            ) : (
              <div style={{
                backgroundColor: colors.white,
                borderRadius: spacing.radius["2xl"],
                boxShadow: "var(--shadow-elevation-low)",
                border: `1px solid ${colors.border.light}`,
                padding: spacing["3xl"],
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}>
                <div style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  backgroundColor: `${colors.primary[600]}15`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: spacing.lg,
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.primary[600]} strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <h3 style={{
                  margin: `0 0 ${spacing.sm}`,
                  color: colors.secondary[900],
                  fontSize: typography.fontSize.lg,
                  fontWeight: typography.fontWeight.semibold,
                  fontFamily: typography.fontFamily.primary,
                }}>
                  Select a State
                </h3>
                <p style={{
                  margin: `0 0 ${spacing["2xl"]}`,
                  color: colors.text.secondary,
                  fontSize: typography.fontSize.sm,
                  fontFamily: typography.fontFamily.body,
                  maxWidth: "280px",
                }}>
                  Click any state to see legislative activity, tax changes, and available research.
                </p>

                {/* Quick stats for high activity states */}
                <div style={{ width: "100%", maxWidth: "320px" }}>
                  <h4 style={{
                    margin: `0 0 ${spacing.md}`,
                    color: colors.text.tertiary,
                    fontSize: typography.fontSize.xs,
                    fontWeight: typography.fontWeight.semibold,
                    fontFamily: typography.fontFamily.primary,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}>
                    States with Major Tax Changes
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {Object.entries(stateData)
                      .filter(([, s]) => s.taxChanges?.length > 0)
                      .slice(0, 5)
                      .map(([abbr, state]) => (
                        <button
                          key={abbr}
                          onClick={() => handleStateSelect(abbr)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                            padding: `${spacing.sm} ${spacing.md}`,
                            border: "none",
                            borderRadius: spacing.radius.lg,
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            transition: "background-color 0.15s ease",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.background.secondary}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                        >
                          <span style={{
                            color: colors.secondary[900],
                            fontSize: typography.fontSize.sm,
                            fontWeight: typography.fontWeight.medium,
                            fontFamily: typography.fontFamily.body,
                          }}>{state.name}</span>
                          <span style={{
                            color: colors.text.tertiary,
                            fontSize: typography.fontSize.xs,
                            fontFamily: typography.fontFamily.body,
                          }}>{state.taxChanges[0].change}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: spacing.lg,
          marginTop: spacing["3xl"],
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
