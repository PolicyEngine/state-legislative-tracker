import { colors, typography, spacing } from "../designTokens";
import { ALL_YEARS } from "../lib/sessionFilters";

function FilterButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${active ? colors.primary[300] : colors.border.light}`,
        backgroundColor: active ? colors.primary[50] : colors.white,
        color: active ? colors.primary[700] : colors.text.secondary,
        borderRadius: spacing.radius.md,
        padding: `${spacing.xs} ${spacing.sm}`,
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.medium,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export default function SessionFilterBar({
  scopeLabel,
  scopeOptions,
  selectedScope,
  onScopeChange,
  yearOptions,
  selectedYear,
  onYearChange,
  summary,
}) {
  return (
    <div style={{
      marginBottom: spacing.xl,
      padding: spacing.lg,
      backgroundColor: colors.background.secondary,
      borderRadius: spacing.radius.xl,
      border: `1px solid ${colors.border.light}`,
      display: "flex",
      flexDirection: "column",
      gap: spacing.md,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        <span style={{
          color: colors.text.tertiary,
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {scopeLabel}
        </span>
        <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
          {scopeOptions.map((option) => (
            <FilterButton
              key={option.id}
              active={selectedScope === option.id}
              onClick={() => onScopeChange(option.id)}
            >
              {option.label}
            </FilterButton>
          ))}
        </div>
        {scopeOptions.find((option) => option.id === selectedScope)?.description && (
          <p style={{
            margin: 0,
            color: colors.text.secondary,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
          }}>
            {scopeOptions.find((option) => option.id === selectedScope)?.description}
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        <span style={{
          color: colors.text.tertiary,
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          Activity Year
        </span>
        <div style={{ display: "flex", gap: spacing.xs, flexWrap: "wrap" }}>
          <FilterButton
            active={selectedYear === ALL_YEARS}
            onClick={() => onYearChange(ALL_YEARS)}
          >
            All years
          </FilterButton>
          {yearOptions.map((year) => (
            <FilterButton
              key={year}
              active={selectedYear === year}
              onClick={() => onYearChange(year)}
            >
              {year}
            </FilterButton>
          ))}
        </div>
      </div>

      {summary && (
        <p style={{
          margin: 0,
          color: colors.text.secondary,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
        }}>
          {summary}
        </p>
      )}
    </div>
  );
}
