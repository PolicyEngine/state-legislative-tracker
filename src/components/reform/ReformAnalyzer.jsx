import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { colors, typography, spacing } from "../../designTokens";
import { usePolicyEngineAPI } from "../../hooks/usePolicyEngineAPI";
import { buildHousehold } from "../../utils/householdBuilder";
import { useData } from "../../context/DataContext";
import { track } from "../../lib/analytics";
import HouseholdForm from "./HouseholdForm";
import ResultsDisplay from "./ResultsDisplay";
import AggregateImpacts from "./AggregateImpacts";
import DistrictMap from "./DistrictMap";
import BillOverview from "./BillOverview";

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const MapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4M12 8h.01" />
  </svg>
);

const Spinner = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    style={{
      animation: "spin 1s linear infinite",
    }}
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke={colors.gray[200]}
      strokeWidth="3"
      fill="none"
    />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke={colors.primary[600]}
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
    <style>{`
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  </svg>
);

const TABS = [
  { id: "overview", label: "Overview", icon: InfoIcon },
  { id: "statewide", label: "Statewide", icon: ChartIcon },
  { id: "districts", label: "Districts", icon: MapIcon },
  { id: "household", label: "Your Household", icon: UserIcon },
];

export default function ReformAnalyzer({ reformConfig, stateAbbr, billUrl, bill, onClose }) {
  const { compareReform, loading, error } = usePolicyEngineAPI();
  const { getImpact } = useData();
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    track("reform_analyzer_opened", { state_abbr: stateAbbr, reform_id: reformConfig.id, bill_label: reformConfig.label });
  }, [stateAbbr, reformConfig.id, reformConfig.label]);

  // Get pre-computed aggregate impacts
  const aggregateImpacts = getImpact(reformConfig.id);

  // Pre-fetch district GeoJSON on modal open so it's ready when user clicks Districts tab
  const [cachedGeoData, setCachedGeoData] = useState(null);
  useEffect(() => {
    const url = `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_118th_Congressional_Districts/FeatureServer/0/query?where=${encodeURIComponent(`STATE_ABBR='${stateAbbr}'`)}&outFields=*&f=geojson`;
    let cancelled = false;
    fetch(url)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data?.features?.length > 0) setCachedGeoData(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [stateAbbr]);

  const [householdInputs, setHouseholdInputs] = useState({
    headAge: 35,
    isMarried: false,
    spouseAge: 35,
    income: 50000,
    spouseIncome: 0,
    childrenAges: [],
    year: "2026",
    incomeSources: {},
    expenses: {},
  });

  const [results, setResults] = useState(null);
  const [hasCalculated, setHasCalculated] = useState(false);

  const handleCalculate = async () => {
    track("household_calculated", {
      state_abbr: stateAbbr,
      reform_id: reformConfig.id,
      income: householdInputs.income,
      is_married: householdInputs.isMarried,
      num_children: householdInputs.childrenAges.length,
      year: householdInputs.year,
    });
    try {
      const household = buildHousehold({
        ...householdInputs,
        state: stateAbbr,
      });

      const { baseline, reform } = await compareReform(
        household,
        reformConfig.reform
      );

      setResults({ baseline, reform });
      setHasCalculated(true);
    } catch (err) {
      console.error("Calculation error:", err);
      setHasCalculated(true);
    }
  };

  return createPortal(
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: spacing.lg,
    }}>
      <div
        className="animate-fade-in"
        style={{
          backgroundColor: colors.white,
          borderRadius: spacing.radius["2xl"],
          boxShadow: "var(--shadow-elevation-high)",
          width: "100%",
          maxWidth: "1400px",
          height: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          padding: `${spacing.lg} ${spacing["2xl"]}`,
          borderBottom: `1px solid ${colors.border.light}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: typography.fontSize.lg,
              fontWeight: typography.fontWeight.bold,
              fontFamily: typography.fontFamily.primary,
              color: colors.secondary[900],
            }}>
              {reformConfig.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: spacing.sm,
              border: "none",
              borderRadius: spacing.radius.lg,
              backgroundColor: "transparent",
              color: colors.text.secondary,
              cursor: "pointer",
              transition: "background-color 0.15s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.background.tertiary}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex",
          gap: spacing.xs,
          padding: `0 ${spacing["2xl"]}`,
          borderBottom: `1px solid ${colors.border.light}`,
          backgroundColor: colors.background.secondary,
        }}>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  track("tab_switched", { tab_id: tab.id, reform_id: reformConfig.id, state_abbr: stateAbbr });
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: spacing.xs,
                  padding: `${spacing.md} ${spacing.lg}`,
                  border: "none",
                  borderBottom: isActive ? `2px solid ${colors.primary[600]}` : "2px solid transparent",
                  backgroundColor: "transparent",
                  color: isActive ? colors.primary[600] : colors.text.secondary,
                  fontSize: typography.fontSize.sm,
                  fontWeight: isActive ? typography.fontWeight.semibold : typography.fontWeight.medium,
                  fontFamily: typography.fontFamily.body,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  marginBottom: "-1px",
                }}
              >
                <Icon />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{
          padding: spacing["2xl"],
          overflowY: "auto",
          flex: 1,
        }}>
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <BillOverview bill={bill} impact={aggregateImpacts} />
          )}

          {/* Statewide Tab */}
          {activeTab === "statewide" && (
            <AggregateImpacts impacts={aggregateImpacts} />
          )}

          {/* Districts Tab */}
          {activeTab === "districts" && (
            <div style={{ height: "100%", minHeight: "500px" }}>
              <DistrictMap
                stateAbbr={stateAbbr}
                reformId={reformConfig.id}
                prefetchedGeoData={cachedGeoData}
              />
            </div>
          )}

          {/* Household Tab */}
          {activeTab === "household" && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: spacing["3xl"],
            }}>
              <div>
                <h3 style={{
                  margin: `0 0 ${spacing.md}`,
                  fontSize: typography.fontSize.xs,
                  fontWeight: typography.fontWeight.semibold,
                  fontFamily: typography.fontFamily.body,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: colors.text.tertiary,
                }}>
                  Your Details
                </h3>
                <HouseholdForm
                  values={householdInputs}
                  onChange={setHouseholdInputs}
                  onSubmit={handleCalculate}
                  loading={loading}
                  stateAbbr={stateAbbr}
                />
              </div>

              <div>
                <h3 style={{
                  margin: `0 0 ${spacing.md}`,
                  fontSize: typography.fontSize.xs,
                  fontWeight: typography.fontWeight.semibold,
                  fontFamily: typography.fontFamily.body,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: colors.text.tertiary,
                }}>
                  Your Impact
                </h3>
                {loading ? (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: spacing["2xl"],
                    backgroundColor: colors.background.secondary,
                    borderRadius: spacing.radius.xl,
                    border: `1px solid ${colors.border.light}`,
                    height: "100%",
                    minHeight: "200px",
                    gap: spacing.md,
                  }}>
                    <Spinner />
                    <p style={{
                      margin: 0,
                      color: colors.text.secondary,
                      fontSize: typography.fontSize.sm,
                      fontFamily: typography.fontFamily.body,
                    }}>
                      Calculating your impact...
                    </p>
                  </div>
                ) : hasCalculated ? (
                  <ResultsDisplay
                    baseline={results?.baseline}
                    reform={results?.reform}
                    error={error}
                  />
                ) : (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: spacing["2xl"],
                    backgroundColor: colors.background.secondary,
                    borderRadius: spacing.radius.xl,
                    border: `1px dashed ${colors.border.medium}`,
                    height: "100%",
                    minHeight: "200px",
                  }}>
                    <p style={{
                      margin: 0,
                      color: colors.text.tertiary,
                      fontSize: typography.fontSize.sm,
                      fontFamily: typography.fontFamily.body,
                      textAlign: "center",
                    }}>
                      Enter your details and click<br />
                      "Calculate Impact" to see results
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: `${spacing.sm} ${spacing["2xl"]}`,
          borderTop: `1px solid ${colors.border.light}`,
          backgroundColor: colors.background.secondary,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <p style={{
            margin: 0,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
          }}>
            Powered by <a href="https://app.policyengine.org/us/reports" target="_blank" rel="noopener noreferrer" style={{ color: colors.primary[600], textDecoration: "none" }}>PolicyEngine</a>
            {aggregateImpacts?.policyengineUsVersion && (
              <span style={{ marginLeft: spacing.sm }}>
                · <a href="https://github.com/PolicyEngine/policyengine-us" target="_blank" rel="noopener noreferrer" style={{ color: colors.primary[600], textDecoration: "none" }}>-us:v{aggregateImpacts.policyengineUsVersion}</a>
                {aggregateImpacts.datasetVersion && (
                  <>{" "}<a href="https://github.com/PolicyEngine/policyengine-us-data" target="_blank" rel="noopener noreferrer" style={{ color: colors.primary[600], textDecoration: "none" }}>-us-data:v{aggregateImpacts.datasetVersion}</a></>
                )}
              </span>
            )}
          </p>
          <a
            href="https://app.policyengine.org/us/reports"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.primary[600],
              textDecoration: "none",
            }}
          >
            Full calculator →
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}
