import { colors, typography, spacing } from "../../designTokens";

const formatCurrency = (value) => {
  if (value === null || value === undefined) return "N/A";
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  return `${sign}$${absValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const formatChange = (value) => {
  if (value === null || value === undefined) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCurrency(value)}`;
};

const ArrowUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
  </svg>
);

export default function ResultsDisplay({ baseline, reform, error }) {
  if (error) {
    return (
      <div style={{
        padding: spacing.lg,
        backgroundColor: colors.red[50],
        borderRadius: spacing.radius.lg,
        border: `1px solid ${colors.red[100]}`,
      }}>
        <p style={{
          margin: 0,
          color: colors.red[700],
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
        }}>
          Error calculating impact: {error}
        </p>
      </div>
    );
  }

  if (!baseline || !reform) {
    return null;
  }

  // Extract key values from results
  const getHouseholdValue = (result, variable) => {
    try {
      const households = result.result?.households?.household;
      if (households && households[variable]) {
        const values = Object.values(households[variable]);
        return values[0] ?? null;
      }
      return null;
    } catch {
      return null;
    }
  };

  const getTaxUnitValue = (result, variable) => {
    try {
      const taxUnit = result.result?.tax_units?.tax_unit;
      if (taxUnit && taxUnit[variable]) {
        const values = Object.values(taxUnit[variable]);
        return values[0] ?? null;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Find state tax variable dynamically (e.g., ut_income_tax, ny_income_tax)
  const findStateTaxVariable = (result) => {
    try {
      const taxUnit = result.result?.tax_units?.tax_unit;
      if (!taxUnit) return null;
      const stateTaxKey = Object.keys(taxUnit).find(k => k.match(/^[a-z]{2}_income_tax$/));
      return stateTaxKey || null;
    } catch {
      return null;
    }
  };

  const baselineNetIncome = getHouseholdValue(baseline, "household_net_income");
  const reformNetIncome = getHouseholdValue(reform, "household_net_income");
  const netIncomeChange = reformNetIncome !== null && baselineNetIncome !== null
    ? reformNetIncome - baselineNetIncome
    : null;

  const baselineFederalTax = getTaxUnitValue(baseline, "income_tax");
  const reformFederalTax = getTaxUnitValue(reform, "income_tax");
  const federalTaxChange = reformFederalTax !== null && baselineFederalTax !== null
    ? reformFederalTax - baselineFederalTax
    : null;

  // Get state-specific tax
  const stateTaxVar = findStateTaxVariable(baseline) || findStateTaxVariable(reform);
  const baselineStateTax = stateTaxVar ? getTaxUnitValue(baseline, stateTaxVar) : null;
  const reformStateTax = stateTaxVar ? getTaxUnitValue(reform, stateTaxVar) : null;
  const stateTaxChange = reformStateTax !== null && baselineStateTax !== null
    ? reformStateTax - baselineStateTax
    : null;

  // Determine if this is a benefit (positive change in net income)
  const isBenefit = netIncomeChange !== null && netIncomeChange > 0;
  const isNeutral = netIncomeChange === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
      {/* Main Impact Card */}
      <div style={{
        padding: spacing.lg,
        backgroundColor: isNeutral ? colors.gray[50] : (isBenefit ? colors.green[50] : colors.red[50]),
        borderRadius: spacing.radius.xl,
        border: `1px solid ${isNeutral ? colors.gray[200] : (isBenefit ? colors.green[100] : colors.red[100])}`,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          marginBottom: spacing.sm,
        }}>
          <span style={{
            color: isNeutral ? colors.gray[600] : (isBenefit ? colors.green[600] : colors.red[600]),
          }}>
            {isBenefit ? <ArrowUpIcon /> : (isNeutral ? null : <ArrowDownIcon />)}
          </span>
          <span style={{
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.body,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: isNeutral ? colors.gray[600] : (isBenefit ? colors.green[700] : colors.red[700]),
          }}>
            Change in Household Net Income
          </span>
        </div>
        <p style={{
          margin: 0,
          fontSize: typography.fontSize["2xl"],
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: isNeutral ? colors.gray[700] : (isBenefit ? colors.green[700] : colors.red[700]),
        }}>
          {formatChange(netIncomeChange)}
          <span style={{
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.normal,
            color: isNeutral ? colors.gray[500] : (isBenefit ? colors.green[600] : colors.red[600]),
            marginLeft: spacing.xs,
          }}>/year</span>
        </p>
      </div>

      {/* Breakdown */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: spacing.md,
      }}>
        <ComparisonCard
          label="Federal Tax"
          baseline={baselineFederalTax}
          reform={reformFederalTax}
          change={federalTaxChange}
          invertColors
        />
        <ComparisonCard
          label="State Tax"
          baseline={baselineStateTax}
          reform={reformStateTax}
          change={stateTaxChange}
          invertColors
        />
        <ComparisonCard
          label="Net Income"
          baseline={baselineNetIncome}
          reform={reformNetIncome}
          change={netIncomeChange}
        />
      </div>
    </div>
  );
}

function ComparisonCard({ label, baseline, reform, change, invertColors = false }) {
  // For taxes, a decrease is good (invert colors)
  const isPositiveChange = invertColors ? change < 0 : change > 0;
  const isNeutral = change === 0 || change === null;

  return (
    <div style={{
      padding: spacing.md,
      backgroundColor: colors.background.secondary,
      borderRadius: spacing.radius.lg,
      border: `1px solid ${colors.border.light}`,
    }}>
      <p style={{
        margin: `0 0 ${spacing.sm}`,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.medium,
        fontFamily: typography.fontFamily.body,
        color: colors.text.tertiary,
        textTransform: "uppercase",
        letterSpacing: "0.3px",
      }}>{label}</p>
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xs,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>Baseline</span>
          <span style={{
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.medium,
            fontFamily: typography.fontFamily.body,
            color: colors.secondary[900],
          }}>{formatCurrency(baseline)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>Reform</span>
          <span style={{
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.medium,
            fontFamily: typography.fontFamily.body,
            color: colors.secondary[900],
          }}>{formatCurrency(reform)}</span>
        </div>
        <div style={{
          borderTop: `1px solid ${colors.border.light}`,
          paddingTop: spacing.xs,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>Change</span>
          <span style={{
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.body,
            color: isNeutral ? colors.gray[600] : (isPositiveChange ? colors.green[600] : colors.red[600]),
          }}>{formatChange(change)}</span>
        </div>
      </div>
    </div>
  );
}
