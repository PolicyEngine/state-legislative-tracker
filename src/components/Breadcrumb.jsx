import { colors, typography, spacing } from "../designTokens";
import { stateData } from "../data/states";

const ArrowLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0l7 7m-7-7l7-7" />
  </svg>
);

const ChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

export default function Breadcrumb({ stateAbbr, billLabel, onNavigateHome, onNavigateState }) {
  const onBack = billLabel ? onNavigateState : onNavigateHome;
  return (
    <nav className="breadcrumb-nav" style={{
      display: "flex",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.lg,
      fontSize: typography.fontSize.sm,
      fontFamily: typography.fontFamily.body,
    }}>
      <button
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "28px",
          height: "28px",
          border: `1px solid ${colors.border.light}`,
          borderRadius: spacing.radius.md,
          background: colors.white,
          color: colors.primary[600],
          cursor: "pointer",
          transition: "all 0.15s ease",
          marginRight: spacing.xs,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.primary[50];
          e.currentTarget.style.borderColor = colors.primary[200];
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = colors.white;
          e.currentTarget.style.borderColor = colors.border.light;
        }}
        title="Go back"
      >
        <ArrowLeft />
      </button>
      <button
        onClick={onNavigateHome}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          color: colors.primary[600],
          fontSize: "inherit",
          fontFamily: "inherit",
          fontWeight: typography.fontWeight.medium,
          cursor: "pointer",
          textDecoration: "none",
        }}
        onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
        onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
      >
        Home
      </button>
      {stateAbbr && (
        <>
          <ChevronRight />
          {billLabel ? (
            <button
              onClick={onNavigateState}
              style={{
                border: "none",
                background: "none",
                padding: 0,
                color: colors.primary[600],
                fontSize: "inherit",
                fontFamily: "inherit",
                fontWeight: typography.fontWeight.medium,
                cursor: "pointer",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
              onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
            >
              {stateData[stateAbbr]?.name || stateAbbr}
            </button>
          ) : (
            <span style={{ color: colors.text.primary, fontWeight: typography.fontWeight.medium }}>
              {stateData[stateAbbr]?.name || stateAbbr}
            </span>
          )}
        </>
      )}
      {billLabel && (
        <>
          <ChevronRight />
          <span style={{ color: colors.text.primary, fontWeight: typography.fontWeight.medium }}>
            {billLabel}
          </span>
        </>
      )}
    </nav>
  );
}
