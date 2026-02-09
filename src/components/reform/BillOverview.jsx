import { colors, typography, spacing } from "../../designTokens";

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const ArrowIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary[400]} strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);

const StatusBadge = ({ status }) => {
  const statusStyles = {
    'in_progress': { bg: colors.primary[100], color: colors.primary[700], label: 'In Progress' },
    'In Progress': { bg: colors.primary[100], color: colors.primary[700], label: 'In Progress' },
    'published': { bg: colors.green[100], color: colors.green[700], label: 'Published' },
    'Published': { bg: colors.green[100], color: colors.green[700], label: 'Published' },
    'pending': { bg: `${colors.warning}20`, color: '#B45309', label: 'Pending' },
    'enacted': { bg: colors.green[100], color: colors.green[700], label: 'Enacted' },
  };

  const style = statusStyles[status] || { bg: colors.gray[100], color: colors.gray[700], label: status };

  return (
    <span style={{
      display: "inline-block",
      padding: `${spacing.xs} ${spacing.sm}`,
      borderRadius: spacing.radius.md,
      backgroundColor: style.bg,
      color: style.color,
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.medium,
      fontFamily: typography.fontFamily.body,
    }}>
      {style.label}
    </span>
  );
};

const ChangeRow = ({ label, baseline, reform, compact }) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    gap: compact ? spacing.sm : spacing.lg,
    padding: compact ? `${spacing.sm} ${spacing.md}` : spacing.lg,
    backgroundColor: colors.background.secondary,
    borderRadius: spacing.radius.lg,
  }}>
    <div style={{ textAlign: compact ? "left" : "center", flex: 1 }}>
      {!compact && (
        <p style={{
          margin: `0 0 ${spacing.xs}`,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          Current
        </p>
      )}
      {compact && label && (
        <p style={{
          margin: `0 0 2px`,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>
          {label}
        </p>
      )}
      <p style={{
        margin: 0,
        fontSize: compact ? typography.fontSize.sm : typography.fontSize.lg,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.primary,
        color: colors.text.secondary,
      }}>
        {baseline}
      </p>
    </div>

    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: compact ? 28 : 40,
      height: compact ? 28 : 40,
      borderRadius: "50%",
      backgroundColor: colors.primary[50],
      flexShrink: 0,
    }}>
      <ArrowIcon />
    </div>

    <div style={{ textAlign: compact ? "left" : "center", flex: 1 }}>
      {!compact && (
        <p style={{
          margin: `0 0 ${spacing.xs}`,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          Proposed
        </p>
      )}
      {compact && <div style={{ height: label ? "calc(1em + 2px)" : 0 }} />}
      <p style={{
        margin: 0,
        fontSize: compact ? typography.fontSize.sm : typography.fontSize.lg,
        fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.primary,
        color: colors.primary[600],
      }}>
        {reform}
      </p>
    </div>
  </div>
);

const ProvisionCard = ({ provision }) => {
  const changes = provision.changes || [];
  const hasMultipleChanges = changes.length > 0;

  return (
    <div style={{
      backgroundColor: colors.white,
      borderRadius: spacing.radius.lg,
      border: `1px solid ${colors.border.light}`,
      padding: spacing.lg,
      transition: "box-shadow 0.15s ease",
    }}>
      {/* Label */}
      <h4 style={{
        margin: `0 0 ${spacing.md}`,
        fontSize: typography.fontSize.sm,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.primary,
        color: colors.secondary[900],
      }}>
        {provision.label}
      </h4>

      {/* Single change (backward compatible) or multiple changes */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xs,
        marginBottom: provision.explanation ? spacing.md : 0,
      }}>
        {hasMultipleChanges ? (
          changes.map((change, i) => (
            <ChangeRow
              key={i}
              label={change.label}
              baseline={change.baseline}
              reform={change.reform}
              compact={true}
            />
          ))
        ) : (
          <ChangeRow
            baseline={provision.baseline}
            reform={provision.reform}
            compact={false}
          />
        )}
      </div>

      {/* Explanation */}
      {provision.explanation && (
        <p style={{
          margin: 0,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
          color: colors.text.secondary,
          lineHeight: 1.6,
        }}>
          {provision.explanation}
        </p>
      )}
    </div>
  );
};

export default function BillOverview({ bill, impact }) {
  const provisions = impact?.provisions || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.xl }}>
      {/* Bill Details Section */}
      <div style={{
        backgroundColor: colors.white,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        overflow: "hidden",
      }}>
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
            Bill Details
          </h3>
        </div>

        <div style={{ padding: spacing.xl }}>
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: spacing.lg,
            marginBottom: spacing.lg,
          }}>
            <div>
              <h4 style={{
                margin: 0,
                fontSize: typography.fontSize.xl,
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
                color: colors.secondary[900],
              }}>
                {bill?.bill || bill?.id?.toUpperCase()}
              </h4>
              {bill?.status && (
                <div style={{ marginTop: spacing.sm }}>
                  <StatusBadge status={bill.status} />
                </div>
              )}
            </div>

            {bill?.url && (
              <a
                href={bill.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: spacing.xs,
                  padding: `${spacing.sm} ${spacing.md}`,
                  borderRadius: spacing.radius.lg,
                  backgroundColor: colors.primary[50],
                  color: colors.primary[600],
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.medium,
                  fontFamily: typography.fontFamily.body,
                  textDecoration: "none",
                  transition: "background-color 0.15s ease",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.primary[100]}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = colors.primary[50]}
              >
                View Bill Text
                <ExternalLinkIcon />
              </a>
            )}
          </div>

          <p style={{
            margin: 0,
            fontSize: typography.fontSize.base,
            fontFamily: typography.fontFamily.body,
            color: colors.text.primary,
            lineHeight: 1.6,
          }}>
            {bill?.description || bill?.title}
          </p>
        </div>
      </div>

      {/* What We Model Section */}
      <div style={{
        backgroundColor: colors.white,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        overflow: "hidden",
      }}>
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
            What We Model
          </h3>
        </div>

        <div style={{ padding: spacing.xl }}>
          {provisions.length > 0 ? (
            <div style={{
              display: "grid",
              gridTemplateColumns: provisions.length === 1 ? "1fr" : "repeat(auto-fit, minmax(300px, 1fr))",
              gap: spacing.lg,
            }}>
              {provisions.map((provision, index) => (
                <ProvisionCard key={index} provision={provision} />
              ))}
            </div>
          ) : (
            <p style={{
              margin: 0,
              fontSize: typography.fontSize.base,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
              fontStyle: "italic",
            }}>
              Model description not yet available.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
