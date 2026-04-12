import { memo, useMemo, useState } from "react";
import { useData } from "../context/DataContext";
import ResearchCard from "./ResearchCard";
import { colors, typography, spacing } from "../designTokens";
import SessionFilterBar from "./SessionFilterBar";
import {
  ALL_ACTIVITY_SCOPE,
  ALL_YEARS,
  CURRENT_FEDERAL_SESSION,
  CURRENT_SCOPE,
  buildSessionYearSet,
  collectYears,
  matchesSessionScope,
  matchesYearFilter,
} from "../lib/sessionFilters";

const CapitolIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 21V10l8-5 8 5v11" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 21v-6h8v6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5V3" />
  </svg>
);

const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="2" style={{ flexShrink: 0, marginTop: "2px" }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

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

const FederalBillCard = memo(({ bill }) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: `${colors.primary[400]}12`,
      border: `1px solid ${colors.primary[400]}30`,
      borderRadius: spacing.radius.lg,
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
      <CapitolIcon />
    </div>
    <div style={{ flex: 1 }}>
      <p style={{
        margin: 0,
        color: colors.secondary[900],
        fontSize: typography.fontSize.sm,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.body,
      }}>{bill.title}</p>
      {bill.description && (
        <p style={{
          margin: `${spacing.xs} 0 0`,
          color: colors.text.secondary,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          lineHeight: "1.5",
        }}>
          {bill.description}
        </p>
      )}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        flexWrap: "wrap",
        marginTop: spacing.sm,
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          padding: `2px ${spacing.sm}`,
          borderRadius: spacing.radius.sm,
          backgroundColor: colors.primary[50],
          color: colors.primary[700],
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.medium,
          fontFamily: typography.fontFamily.body,
        }}>
          {bill.reformConfig ? "Modeled" : "Tracked"}
        </span>
        {bill.url && (
          <a
            href={bill.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing.xs,
              color: colors.primary[600],
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.medium,
              fontFamily: typography.fontFamily.body,
              textDecoration: "none",
            }}
          >
            Open bill <LinkIcon />
          </a>
        )}
      </div>
    </div>
  </div>
));

FederalBillCard.displayName = "FederalBillCard";

const FederalPanel = memo(() => {
  const { getFederalBills, getFederalResearch } = useData();
  const [selectedScope, setSelectedScope] = useState(CURRENT_SCOPE);
  const [selectedYear, setSelectedYear] = useState(ALL_YEARS);

  const bills = getFederalBills();
  const research = getFederalResearch();
  const sessionYearSet = buildSessionYearSet(selectedScope, CURRENT_FEDERAL_SESSION.years);
  const availableYears = useMemo(
    () => collectYears(bills, research, CURRENT_FEDERAL_SESSION.years),
    [bills, research],
  );
  const filteredBills = bills.filter(
    (bill) => matchesSessionScope(bill, sessionYearSet) && matchesYearFilter(bill, selectedYear),
  );
  const filteredResearch = research.filter(
    (item) => matchesSessionScope(item, sessionYearSet) && matchesYearFilter(item, selectedYear),
  );

  const published = filteredResearch.filter((item) => item.status === "published");
  const inProgress = filteredResearch.filter((item) => item.status === "in_progress");
  const planned = filteredResearch.filter((item) => item.status === "planned");
  const tools = published
    .filter((item) => item.federalToolOrder !== undefined)
    .sort((a, b) => a.federalToolOrder - b.federalToolOrder);
  const publishedResearch = published
    .filter((item) => item.federalToolOrder === undefined)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const scopeOptions = [
    {
      id: CURRENT_SCOPE,
      label: CURRENT_FEDERAL_SESSION.label,
      description: CURRENT_FEDERAL_SESSION.description,
    },
    {
      id: ALL_ACTIVITY_SCOPE,
      label: "All tracked activity",
      description: "Shows federal bills and research across all available activity years.",
    },
  ];
  const filterSummary = selectedYear === ALL_YEARS
    ? `Viewing ${selectedScope === CURRENT_SCOPE ? CURRENT_FEDERAL_SESSION.label : "all tracked federal activity"}.`
    : `Viewing federal activity for ${selectedYear}.`;

  return (
    <div className="animate-fade-in">
      <div className="state-panel-header" style={{
        padding: `${spacing.lg} ${spacing["2xl"]}`,
        background: `linear-gradient(135deg, ${colors.secondary[800]} 0%, ${colors.secondary[900]} 100%)`,
        borderRadius: `${spacing.radius["2xl"]} ${spacing.radius["2xl"]} 0 0`,
      }}>
        <div>
          <h2 style={{
            margin: 0,
            color: colors.white,
            fontSize: typography.fontSize["2xl"],
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
            letterSpacing: "-0.02em",
          }}>Federal</h2>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing.xs,
              padding: `${spacing.xs} ${spacing.sm}`,
              borderRadius: spacing.radius.md,
              backgroundColor: "rgba(255,255,255,0.14)",
              color: colors.white,
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              fontWeight: typography.fontWeight.medium,
            }}>
              <CapitolIcon />
              Shared bill pipeline
            </span>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              padding: `${spacing.xs} ${spacing.sm}`,
              borderRadius: spacing.radius.md,
              backgroundColor: "rgba(255,255,255,0.14)",
              color: colors.white,
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              fontWeight: typography.fontWeight.medium,
            }}>
              Bills, tools, and analysis
            </span>
          </div>
        </div>
      </div>

      <div className="state-panel-content" style={{
        padding: spacing["2xl"],
        backgroundColor: colors.white,
        borderRadius: `0 0 ${spacing.radius["2xl"]} ${spacing.radius["2xl"]}`,
        border: `1px solid ${colors.border.light}`,
        borderTop: "none",
      }}>
        <SessionFilterBar
          scopeLabel="Legislative Scope"
          scopeOptions={scopeOptions}
          selectedScope={selectedScope}
          onScopeChange={setSelectedScope}
          yearOptions={availableYears}
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
          summary={filterSummary}
        />

        {filteredBills.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Tracked Federal Bills</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
              {filteredBills.map((bill) => (
                <FederalBillCard key={bill.id} bill={bill} />
              ))}
            </div>
          </div>
        )}

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

        {publishedResearch.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Published Research</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {publishedResearch.map((item) => (
                <ResearchCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {tools.length > 0 && (
          <div style={{ marginBottom: spacing["2xl"] }}>
            <SectionHeader>Federal Tools</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {tools.map((item) => (
                <ResearchCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

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

        {filteredBills.length === 0 && publishedResearch.length === 0 && inProgress.length === 0 && planned.length === 0 && tools.length === 0 && (
          <div style={{ textAlign: "center", padding: spacing["2xl"] }}>
            <p style={{
              margin: 0,
              color: colors.text.secondary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}>
              No federal activity matches the selected Congress and year filters yet.
            </p>
            <p style={{
              margin: `${spacing.sm} 0 0`,
              color: colors.text.tertiary,
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
            }}>
              This panel is wired into the same research pipeline and is ready for federal bill ingestion.
            </p>
          </div>
        )}

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
              Need federal bill analysis?
            </h4>
            <p style={{
              margin: `0 0 ${spacing.md}`,
              color: colors.text.secondary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
            }}>
              The same scoring and modeling workflow can support federal tax and transfer legislation as we add a federal source.
            </p>
            <a
              href="mailto:hello@policyengine.org?subject=Federal Legislative Analysis Request"
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
    </div>
  );
});

FederalPanel.displayName = "FederalPanel";

export default FederalPanel;
