import { colors, typography, spacing } from "../../designTokens";

const formatBudgetImpact = (value) => {
  if (value === null || value === undefined) return "N/A";
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "+";
  if (absValue >= 1e9) {
    return `${sign}$${(absValue / 1e9).toFixed(1)}B`;
  } else if (absValue >= 1e6) {
    return `${sign}$${(absValue / 1e6).toFixed(0)}M`;
  } else if (absValue >= 1e3) {
    return `${sign}$${(absValue / 1e3).toFixed(0)}K`;
  }
  return `${sign}$${absValue.toFixed(0)}`;
};

const formatNumber = (value) => {
  if (value === null || value === undefined) return "N/A";
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(1)}M`;
  } else if (value >= 1e3) {
    return `${(value / 1e3).toFixed(0)}K`;
  }
  return value.toLocaleString("en-US");
};

const formatCurrency = (value) => {
  if (value === null || value === undefined) return "N/A";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const InfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
  </svg>
);

export default function AggregateStats({ stats }) {
  if (!stats) {
    return (
      <div style={{
        padding: spacing.lg,
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.lg,
        border: `1px solid ${colors.border.light}`,
        textAlign: "center",
      }}>
        <p style={{
          margin: 0,
          color: colors.text.tertiary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
        }}>
          Population-level statistics not available for this reform.
        </p>
      </div>
    );
  }

  const { budgetImpact, householdsAffected, averageBenefit, lastUpdated } = stats;
  const isCost = budgetImpact < 0;

  return (
    <div style={{
      padding: spacing.lg,
      backgroundColor: colors.background.secondary,
      borderRadius: spacing.radius.xl,
      border: `1px solid ${colors.border.light}`,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: spacing.lg,
      }}>
        <h4 style={{
          margin: 0,
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.body,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: colors.text.tertiary,
        }}>
          Population Impact
        </h4>
        {lastUpdated && (
          <span style={{
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
          }}>
            Updated {lastUpdated}
          </span>
        )}
      </div>

      <div className="aggregate-stats-grid" style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: spacing.md,
      }}>
        {/* Budget Impact */}
        <StatCard
          label="Budget Impact"
          value={formatBudgetImpact(budgetImpact)}
          sublabel={isCost ? "Cost to state" : "Revenue gain"}
          highlight={isCost ? "cost" : "gain"}
        />

        {/* Households Affected */}
        <StatCard
          label="Households Affected"
          value={formatNumber(householdsAffected)}
          sublabel="In this state"
        />

        {/* Average Benefit */}
        <StatCard
          label="Average Benefit"
          value={formatCurrency(averageBenefit)}
          sublabel="Per affected household"
          highlight="benefit"
        />
      </div>

      {/* Disclaimer */}
      <div style={{
        marginTop: spacing.lg,
        paddingTop: spacing.md,
        borderTop: `1px solid ${colors.border.light}`,
        display: "flex",
        alignItems: "flex-start",
        gap: spacing.sm,
      }}>
        <span style={{ color: colors.text.tertiary, flexShrink: 0, marginTop: "2px" }}>
          <InfoIcon />
        </span>
        <p style={{
          margin: 0,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
          lineHeight: "1.5",
        }}>
          Aggregate estimates are computed using PolicyEngine's microsimulation model with representative survey data. Individual results may vary.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, sublabel, highlight }) {
  const highlightColor = {
    cost: colors.red[600],
    gain: colors.green[600],
    benefit: colors.green[600],
  }[highlight] || colors.secondary[900];

  return (
    <div style={{
      padding: spacing.md,
      backgroundColor: colors.white,
      borderRadius: spacing.radius.lg,
      border: `1px solid ${colors.border.light}`,
    }}>
      <p style={{
        margin: `0 0 ${spacing.xs}`,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.medium,
        fontFamily: typography.fontFamily.body,
        color: colors.text.tertiary,
      }}>{label}</p>
      <p style={{
        margin: 0,
        fontSize: typography.fontSize.xl,
        fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.primary,
        color: highlight ? highlightColor : colors.secondary[900],
      }}>{value}</p>
      {sublabel && (
        <p style={{
          margin: `${spacing.xs} 0 0`,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>{sublabel}</p>
      )}
    </div>
  );
}
