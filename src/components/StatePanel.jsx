import { memo, useState, useEffect } from "react";
import { stateData } from "../data/states";
import { useData } from "../context/DataContext";
import ResearchCard from "./ResearchCard";
import ReformAnalyzer from "./reform/ReformAnalyzer";
import { colors, typography, spacing } from "../designTokens";
import { track } from "../lib/analytics";

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const BillIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="2" style={{ flexShrink: 0, marginTop: "2px" }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const CalculatorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line x1="8" y1="6" x2="16" y2="6" />
    <line x1="8" y1="10" x2="8" y2="10.01" />
    <line x1="12" y1="10" x2="12" y2="10.01" />
    <line x1="16" y1="10" x2="16" y2="10.01" />
  </svg>
);

// Section Header component
function SectionHeader({ children }) {
  return (
    <h3 style={{
      margin: `0 0 ${spacing.md}`,
      color: colors.text.tertiary,
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      fontFamily: typography.fontFamily.primary,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    }}>{children}</h3>
  );
}

const StatePanel = memo(({ stateAbbr, onClose, initialBillId }) => {
  const state = stateData[stateAbbr];
  const { getBillsForState, getResearchForState, loading } = useData();
  const [activeBill, setActiveBill] = useState(null);

  if (!state) return null;

  // Get bills and research from Supabase
  const bills = getBillsForState(stateAbbr);

  // Open bill from URL hash on mount
  useEffect(() => {
    if (initialBillId && bills.length > 0 && !activeBill) {
      const match = bills.find(b => b.id === initialBillId && b.reformConfig);
      if (match) setActiveBill(match);
    }
  }, [initialBillId, bills.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const research = getResearchForState(stateAbbr);

  // Separate research by status
  const published = research.filter((r) => r.status === "published");
  const inProgress = research.filter((r) => r.status === "in_progress");
  const planned = research.filter((r) => r.status === "planned");

  // Sort by date (newest first)
  const sortByDate = (items) => [...items].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // Separate state-specific from federal
  const stateSpecific = sortByDate(published.filter((r) => r.state === stateAbbr));
  const federal = sortByDate(published.filter((r) => r.state === "all" || (r.relevantStates && r.relevantStates.includes(stateAbbr))));

  return (
    <div
      className="animate-fade-in"
      style={{
        backgroundColor: colors.white,
        borderRadius: spacing.radius["2xl"],
        boxShadow: "var(--shadow-elevation-medium)",
        border: `1px solid ${colors.border.light}`,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        padding: `${spacing.lg} ${spacing["2xl"]}`,
        background: `linear-gradient(135deg, ${colors.primary[600]} 0%, ${colors.primary[700]} 100%)`,
        position: "relative",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{
              margin: 0,
              color: colors.white,
              fontSize: typography.fontSize["2xl"],
              fontWeight: typography.fontWeight.bold,
              fontFamily: typography.fontFamily.primary,
              letterSpacing: "-0.02em",
            }}>{state.name}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" }}>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: spacing.xs,
                padding: `${spacing.xs} ${spacing.sm}`,
                borderRadius: spacing.radius.md,
                backgroundColor: "rgba(255,255,255,0.2)",
                color: colors.white,
                fontSize: typography.fontSize.xs,
                fontFamily: typography.fontFamily.body,
                fontWeight: typography.fontWeight.medium,
              }}>
                <CalendarIcon />
                {state.session.dates}
              </span>
              {state.session.carryover !== undefined && (
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: `${spacing.xs} ${spacing.sm}`,
                  borderRadius: spacing.radius.md,
                  backgroundColor: state.session.carryover ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
                  color: colors.white,
                  fontSize: typography.fontSize.xs,
                  fontFamily: typography.fontFamily.body,
                  fontWeight: typography.fontWeight.medium,
                }}
                title={state.session.carryover ? "Bills from 2025 carry over to 2026" : "Bills do not carry over from 2025"}
                >
                  {state.session.carryover ? "Carryover" : "No carryover"}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: spacing.sm,
              border: "none",
              borderRadius: spacing.radius.lg,
              backgroundColor: "rgba(255,255,255,0.1)",
              color: colors.white,
              cursor: "pointer",
              transition: "background-color 0.2s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)"}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: spacing["2xl"], maxHeight: "70vh", overflowY: "auto" }}>

        {/* 2026 Legislative Activity */}
        {(bills.length > 0 || state.taxChanges?.length > 0) && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>2026 Legislative Activity</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
              {state.taxChanges?.map((change, i) => (
                <a
                  key={i}
                  href={change.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: spacing.md,
                    padding: spacing.md,
                    backgroundColor: `${colors.primary[600]}08`,
                    border: `1px solid ${colors.primary[600]}25`,
                    borderRadius: spacing.radius.lg,
                    textDecoration: "none",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${colors.primary[600]}15`}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${colors.primary[600]}08`}
                >
                  <div style={{
                    flexShrink: 0,
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: `${colors.primary[600]}15`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <span style={{ color: colors.primary[700], fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold }}>TAX</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{
                      margin: 0,
                      color: colors.secondary[900],
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.semibold,
                      fontFamily: typography.fontFamily.body,
                    }}>{change.change}</p>
                    <p style={{
                      margin: `${spacing.xs} 0 0`,
                      color: colors.text.secondary,
                      fontSize: typography.fontSize.xs,
                      fontFamily: typography.fontFamily.body,
                    }}>
                      Effective: {change.effective} • {change.impact}
                    </p>
                  </div>
                  <LinkIcon />
                </a>
              ))}
              {bills.map((bill, i) => (
                <div
                  key={i}
                  onClick={() => {
                    if (bill.reformConfig) {
                      track("bill_clicked", { state_abbr: stateAbbr, bill_id: bill.bill, has_reform: true });
                      setActiveBill(bill);
                      window.location.hash = `${stateAbbr}/${bill.id}`;
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: spacing.md,
                    padding: spacing.md,
                    backgroundColor: `${colors.primary[400]}15`,
                    border: `1px solid ${colors.primary[400]}30`,
                    borderRadius: spacing.radius.lg,
                    cursor: bill.reformConfig ? "pointer" : "default",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (bill.reformConfig) {
                      e.currentTarget.style.backgroundColor = `${colors.primary[400]}25`;
                      e.currentTarget.style.borderColor = colors.primary[400];
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (bill.reformConfig) {
                      e.currentTarget.style.backgroundColor = `${colors.primary[400]}15`;
                      e.currentTarget.style.borderColor = `${colors.primary[400]}30`;
                    }
                  }}
                >
                  <div style={{
                    flexShrink: 0,
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: `${colors.primary[400]}25`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: colors.primary[700],
                  }}>
                    <BillIcon />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{
                      margin: 0,
                      color: colors.secondary[900],
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.semibold,
                      fontFamily: typography.fontFamily.body,
                    }}>{bill.bill}</p>
                    <p style={{
                      margin: `${spacing.xs} 0 0`,
                      color: colors.text.secondary,
                      fontSize: typography.fontSize.xs,
                      fontFamily: typography.fontFamily.body,
                    }}>
                      <span style={{
                        display: "inline-block",
                        padding: `2px ${spacing.xs}`,
                        borderRadius: spacing.radius.sm,
                        marginRight: spacing.sm,
                        fontSize: typography.fontSize.xs,
                        fontWeight: typography.fontWeight.medium,
                        backgroundColor: bill.status === 'enacted' ? `${colors.primary[600]}20` :
                                         bill.status === 'Published' ? colors.green[100] : `${colors.warning}20`,
                        color: bill.status === 'enacted' ? colors.primary[700] :
                               bill.status === 'Published' ? colors.green[700] : "#B45309",
                      }}>
                        {bill.status}
                      </span>
                      {bill.description && bill.description.length > 120
                        ? bill.description.slice(0, bill.description.lastIndexOf(' ', 120)) + '...'
                        : bill.description}
                    </p>
                    {bill.analysisUrl && (
                      <div style={{ marginTop: spacing.sm }}>
                        <a
                          href={bill.analysisUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: spacing.xs,
                            padding: `2px ${spacing.sm}`,
                            borderRadius: spacing.radius.sm,
                            backgroundColor: colors.primary[600],
                            color: colors.white,
                            fontSize: typography.fontSize.xs,
                            fontWeight: typography.fontWeight.medium,
                            textDecoration: "none",
                          }}
                        >
                          View Analysis
                        </a>
                      </div>
                    )}
                  </div>
                  {bill.reformConfig && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing.xs,
                      padding: `${spacing.xs} ${spacing.sm}`,
                      borderRadius: spacing.radius.md,
                      backgroundColor: colors.primary[50],
                      color: colors.primary[600],
                      fontSize: typography.fontSize.xs,
                      fontWeight: typography.fontWeight.medium,
                      flexShrink: 0,
                    }}>
                      <CalculatorIcon />
                      <span>View Analysis</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}



        {/* In Progress Research */}
        {inProgress.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Analysis In Progress</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {inProgress.map((item) => (
                <ResearchCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* State-Specific Research */}
        {stateSpecific.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Published Research</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {stateSpecific.map((item) => (
                <ResearchCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Planned Research */}
        {planned.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Planned</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {planned.map((item) => (
                <ResearchCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Federal Tools */}
        {federal.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Federal Tools</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {federal
                .filter((item) => item.federalToolOrder !== undefined)
                .sort((a, b) => a.federalToolOrder - b.federalToolOrder)
                .map((item) => (
                  <ResearchCard key={item.id} item={item} />
                ))}
            </div>
          </div>
        )}

        {/* No activity message */}
        {stateSpecific.length === 0 && inProgress.length === 0 && !state.taxChanges?.length && bills.length === 0 && (
          <div style={{ textAlign: "center", padding: spacing["2xl"] }}>
            <p style={{
              margin: 0,
              color: colors.text.secondary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}>
              No major tax legislation currently tracked for {state.name}.
            </p>
            <p style={{
              margin: `${spacing.sm} 0 0`,
              color: colors.text.tertiary,
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
            }}>
              Session: {state.session.dates}
            </p>
          </div>
        )}

        {/* CTA */}
        <div style={{
          marginTop: spacing["2xl"],
          paddingTop: spacing["2xl"],
          borderTop: `1px solid ${colors.border.light}`,
        }}>
          <div style={{
            padding: spacing.lg,
            backgroundColor: colors.background.secondary,
            borderRadius: spacing.radius.xl,
          }}>
            <h4 style={{
              margin: `0 0 ${spacing.sm}`,
              color: colors.secondary[900],
              fontSize: typography.fontSize.base,
              fontWeight: typography.fontWeight.semibold,
              fontFamily: typography.fontFamily.primary,
            }}>
              Need analysis for {state.name}?
            </h4>
            <p style={{
              margin: `0 0 ${spacing.md}`,
              color: colors.text.secondary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}>
              We can model proposed tax changes and provide distributional analysis for your state's legislative session.
            </p>
            <a
              href={`mailto:hello@policyengine.org?subject=Analysis Request: ${state.name} Legislative Session`}
              className="btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: spacing.sm,
                padding: `${spacing.sm} ${spacing.lg}`,
                textDecoration: "none",
                borderRadius: spacing.radius.lg,
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.semibold,
                fontFamily: typography.fontFamily.primary,
              }}
            >
              Get in Contact
            </a>
          </div>
        </div>
      </div>

      {/* Reform Analyzer Modal */}
      {activeBill?.reformConfig && (
        <ReformAnalyzer
          reformConfig={activeBill.reformConfig}
          stateAbbr={stateAbbr}
          billUrl={activeBill.url}
          bill={activeBill}
          onClose={() => {
            setActiveBill(null);
            window.location.hash = stateAbbr;
          }}
        />
      )}
    </div>
  );
});

StatePanel.displayName = "StatePanel";

export default StatePanel;
