import { colors, typography, spacing } from "../../designTokens";
import DecileChart from "./DecileChart";
import WinnersLosersChart from "./WinnersLosersChart";

const formatCurrency = (value) => {
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

const formatPercent = (value, decimals = 1) => {
  if (value === null || value === undefined) return "N/A";
  return `${(value * 100).toFixed(decimals)}%`;
};

const formatPctChange = (value, decimals = 1) => {
  if (value === null || value === undefined) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
};

export default function AggregateImpacts({ impacts }) {
  if (!impacts || !impacts.computed) {
    return (
      <div style={{
        padding: spacing.lg,
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.lg,
        border: `1px dashed ${colors.border.medium}`,
        textAlign: "center",
      }}>
        <p style={{
          margin: 0,
          color: colors.text.tertiary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
        }}>
          Aggregate impacts not yet computed
        </p>
      </div>
    );
  }

  const { budgetaryImpact, povertyImpact, childPovertyImpact, winnersLosers, decileImpact } = impacts;

  // Use state income tax revenue impact for display
  // Note: For tax cuts, this is negative (state loses revenue, but households gain)
  const stateIncomeTaxImpact = budgetaryImpact?.stateRevenueImpact ?? budgetaryImpact?.netCost;
  const isRevenueLoss = stateIncomeTaxImpact < 0;
  const householdsGain = isRevenueLoss; // Tax cut = households benefit

  return (
    <div style={{
      backgroundColor: colors.white,
      borderRadius: spacing.radius.xl,
      border: `1px solid ${colors.border.light}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: `${spacing.md} ${spacing.xl}`,
        borderBottom: `1px solid ${colors.border.light}`,
        backgroundColor: colors.background.secondary,
      }}>
        <h3 style={{
          margin: 0,
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.body,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: colors.text.tertiary,
        }}>
          Reform Impact Summary
        </h3>
      </div>

      {/* Budgetary Impact */}
      <div style={{
        padding: spacing.xl,
        borderBottom: `1px solid ${colors.border.light}`,
      }}>
        <div style={{
          display: "flex",
          alignItems: "baseline",
          gap: spacing.sm,
        }}>
          <span style={{
            fontSize: typography.fontSize["3xl"],
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
            color: householdsGain ? colors.primary[600] : colors.red[600],
          }}>
            {formatCurrency(stateIncomeTaxImpact)}
          </span>
          <span style={{
            fontSize: typography.fontSize.base,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>
            /year
          </span>
          <span style={{
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
            marginLeft: spacing.sm,
          }}>
            state & local income tax revenue
          </span>
        </div>
      </div>

      {/* Poverty Metrics - Side by Side */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        borderBottom: `1px solid ${colors.border.light}`,
      }}>
        <div style={{
          padding: spacing.lg,
          borderRight: `1px solid ${colors.border.light}`,
        }}>
          <p style={{
            margin: `0 0 ${spacing.xs}`,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}>
            Poverty Rate
          </p>
          <span style={{
            fontSize: typography.fontSize.xl,
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
            color: povertyImpact?.percentChange < 0 ? colors.primary[600] : (povertyImpact?.percentChange > 0 ? colors.red[600] : colors.secondary[900]),
          }}>
            {povertyImpact?.percentChange !== 0 ? formatPctChange(povertyImpact?.percentChange) : "no change"}
          </span>
        </div>
        <div style={{
          padding: spacing.lg,
        }}>
          <p style={{
            margin: `0 0 ${spacing.xs}`,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}>
            Child Poverty Rate
          </p>
          <span style={{
            fontSize: typography.fontSize.xl,
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
            color: childPovertyImpact?.percentChange < 0 ? colors.primary[600] : (childPovertyImpact?.percentChange > 0 ? colors.red[600] : colors.secondary[900]),
          }}>
            {childPovertyImpact?.percentChange !== 0 ? formatPctChange(childPovertyImpact?.percentChange) : "no change"}
          </span>
        </div>
      </div>

      {/* Winners/Losers Chart */}
      {winnersLosers && (
        <>
          <div style={{
            padding: `${spacing.md} ${spacing.xl}`,
            borderBottom: `1px solid ${colors.border.light}`,
            backgroundColor: colors.background.secondary,
          }}>
            <h3 style={{
              margin: 0,
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.semibold,
              fontFamily: typography.fontFamily.body,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: colors.text.tertiary,
            }}>
              Winners and Losers
            </h3>
          </div>
          <div style={{
            padding: spacing.xl,
            borderBottom: decileImpact ? `1px solid ${colors.border.light}` : "none",
          }}>
            <WinnersLosersChart winnersLosers={winnersLosers} />
          </div>
        </>
      )}

      {/* Decile Impact Chart */}
      {decileImpact && (
        <>
          <div style={{
            padding: `${spacing.md} ${spacing.xl}`,
            borderBottom: `1px solid ${colors.border.light}`,
            backgroundColor: colors.background.secondary,
          }}>
            <h3 style={{
              margin: 0,
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.semibold,
              fontFamily: typography.fontFamily.body,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: colors.text.tertiary,
            }}>
              Average Benefit by Income Decile
            </h3>
          </div>
          <div style={{ padding: spacing.xl }}>
            <DecileChart decileData={decileImpact} />
          </div>
        </>
      )}
    </div>
  );
}
