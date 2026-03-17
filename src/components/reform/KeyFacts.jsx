import { useState } from "react";
import { colors, typography, spacing } from "../../designTokens";
import { getKeyFacts } from "../../data/analysisKeyFacts";

const formatCurrency = (value) => {
  if (value === null || value === undefined) return null;
  const absValue = Math.abs(value);
  if (absValue >= 1e9) return `$${(absValue / 1e9).toFixed(1)}B`;
  if (absValue >= 1e6) return `$${(absValue / 1e6).toFixed(0)}M`;
  if (absValue >= 1e3) return `$${(absValue / 1e3).toFixed(0)}K`;
  return `$${absValue.toFixed(0)}`;
};

/**
 * Auto-generate key facts from year-resolved impact data.
 * @param {object} data - The impact data for a specific year
 * @param {string} year - The year label (e.g., "2026")
 */
function generateKeyFacts(data, year) {
  const facts = [];
  const yearLabel = year ? ` in ${year}` : "";

  // 1. Budgetary impact
  const revenue = data.budgetaryImpact?.stateRevenueImpact ?? data.budgetaryImpact?.netCost;
  if (revenue != null && revenue !== 0) {
    const formatted = formatCurrency(revenue);
    const verb = revenue < 0 ? "Reduces" : "Increases";
    facts.push({
      icon: "revenue",
      parts: [
        { text: `${verb} state revenue by ` },
        { text: `${formatted}`, bold: true },
        { text: yearLabel },
      ],
    });
  }

  // 2. Winners percentage
  const wl = data.winnersLosers;
  if (wl) {
    const gainPct = ((wl.gainMore5Pct || 0) + (wl.gainLess5Pct || 0)) * 100;
    if (gainPct > 0) {
      facts.push({
        icon: "winners",
        parts: [
          { text: "Benefits " },
          { text: `${gainPct.toFixed(0)}%`, bold: true },
          { text: ` of households${yearLabel}` },
        ],
      });
    }

    // 3. Losers percentage (only if meaningful)
    const losePct = ((wl.loseMore5Pct || 0) + (wl.loseLess5Pct || 0)) * 100;
    if (losePct >= 0.5) {
      facts.push({
        icon: "losers",
        parts: [
          { text: "Reduces income for " },
          { text: `${losePct.toFixed(1)}%`, bold: true },
          { text: ` of households${yearLabel}` },
        ],
      });
    }
  }

  // 4. Poverty impact
  const pov = data.povertyImpact;
  if (pov?.percentChange != null && pov.percentChange !== 0) {
    const direction = pov.percentChange < 0 ? "Reduces" : "Increases";
    facts.push({
      icon: "poverty",
      parts: [
        { text: `${direction} poverty by ` },
        { text: `${Math.abs(pov.percentChange).toFixed(1)}%`, bold: true },
        { text: yearLabel },
      ],
    });
  }

  // 5. Child poverty (only if different direction or notably different magnitude)
  const cpov = data.childPovertyImpact;
  if (cpov?.percentChange != null && cpov.percentChange !== 0) {
    const isDifferentDirection = pov?.percentChange != null &&
      Math.sign(cpov.percentChange) !== Math.sign(pov.percentChange);
    const isMuchLarger = pov?.percentChange != null &&
      Math.abs(cpov.percentChange) > Math.abs(pov.percentChange) * 1.5;

    if (isDifferentDirection || isMuchLarger || !pov?.percentChange) {
      const direction = cpov.percentChange < 0 ? "Reduces" : "Increases";
      facts.push({
        icon: "childPoverty",
        parts: [
          { text: `${direction} child poverty by ` },
          { text: `${Math.abs(cpov.percentChange).toFixed(1)}%`, bold: true },
          { text: yearLabel },
        ],
      });
    }
  }

  return facts;
}

const ICON_PATHS = {
  revenue: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  ),
  winners: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
    />
  ),
  losers: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
    />
  ),
  poverty: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
    />
  ),
  childPoverty: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  ),
  custom: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  ),
};

const FactIcon = ({ type }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    {ICON_PATHS[type] || ICON_PATHS.custom}
  </svg>
);

export default function KeyFacts({ impact, reformId }) {
  const availableYears = impact?.impactsByYear
    ? Object.keys(impact.impactsByYear).sort()
    : [];
  const hasMultipleYears = availableYears.length > 1;
  const defaultYear = hasMultipleYears
    ? availableYears[0]
    : impact?.analysisYear?.toString();

  const [selectedYear, setSelectedYear] = useState(defaultYear);

  if (!impact?.computed) return null;

  // Resolve year-specific data
  const yearData = hasMultipleYears && impact.impactsByYear[selectedYear]
    ? impact.impactsByYear[selectedYear]
    : impact;

  // Priority: local file > model_notes > auto-generated
  const customFacts = getKeyFacts(reformId) || impact.modelNotes?.key_facts;
  const facts = customFacts
    ? customFacts.map((text) => ({ icon: "custom", parts: [{ text }] }))
    : generateKeyFacts(yearData, selectedYear);

  if (facts.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: colors.primary[50],
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.primary[200]}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: `${spacing.md} ${spacing.xl}`,
          borderBottom: `1px solid ${colors.primary[200]}`,
          backgroundColor: colors.primary[100],
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.body,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: colors.primary[800],
          }}
        >
          Key Facts
        </h3>

        {hasMultipleYears && (
          <div style={{ display: "flex", gap: spacing.xs }}>
            {availableYears.map((year) => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                style={{
                  padding: `${spacing.xs} ${spacing.md}`,
                  fontSize: typography.fontSize.xs,
                  fontWeight: selectedYear === year ? typography.fontWeight.semibold : typography.fontWeight.medium,
                  fontFamily: typography.fontFamily.body,
                  color: selectedYear === year ? colors.white : colors.primary[700],
                  backgroundColor: selectedYear === year ? colors.primary[600] : colors.primary[50],
                  border: "none",
                  borderRadius: spacing.radius.md,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {year}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: spacing.xl }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: spacing.md,
          }}
        >
          {facts.map((fact, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.md,
                padding: `${spacing.md} ${spacing.lg}`,
                backgroundColor: colors.white,
                borderRadius: spacing.radius.lg,
                border: `1px solid ${colors.primary[100]}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: spacing.radius.md,
                  backgroundColor: colors.primary[100],
                  color: colors.primary[700],
                  flexShrink: 0,
                }}
              >
                <FactIcon type={fact.icon} />
              </div>
              <span
                style={{
                  fontSize: typography.fontSize.sm,
                  fontFamily: typography.fontFamily.body,
                  color: colors.secondary[800],
                  lineHeight: 1.4,
                }}
              >
                {fact.parts.map((part, j) =>
                  part.bold ? (
                    <strong
                      key={j}
                      style={{
                        fontWeight: typography.fontWeight.bold,
                        color: colors.secondary[900],
                      }}
                    >
                      {part.text}
                    </strong>
                  ) : (
                    <span key={j}>{part.text}</span>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
