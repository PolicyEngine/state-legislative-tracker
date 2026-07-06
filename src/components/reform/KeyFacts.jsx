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
function generateKeyFacts(data, year, isFederal = false) {
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
        { text: `${verb} ${isFederal ? "federal" : "state"} revenue by ` },
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
    : generateKeyFacts(yearData, selectedYear, reformId?.startsWith("us-"));

  if (facts.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: colors.white,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: `${spacing.md} ${spacing.xl}`,
          borderBottom: `1px solid ${colors.border.light}`,
          backgroundColor: colors.background.secondary,
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
            color: colors.text.tertiary,
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
                padding: `${spacing.md} ${spacing.lg}`,
                backgroundColor: colors.background.secondary,
                borderRadius: spacing.radius.lg,
                border: `1px solid ${colors.border.light}`,
              }}
            >
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
