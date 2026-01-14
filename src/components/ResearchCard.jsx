import { memo } from "react";
import { colors, typography, spacing } from "../designTokens";

// Icon components
const DashboardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const BlogIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const ToolIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const getTypeIcon = (type) => {
  switch (type) {
    case "dashboard":
      return <DashboardIcon />;
    case "blog":
      return <BlogIcon />;
    case "tool":
      return <ToolIcon />;
    default:
      return <BlogIcon />;
  }
};

const getTypeLabel = (type) => {
  switch (type) {
    case "dashboard":
      return "Interactive Dashboard";
    case "blog":
      return "Blog Post";
    case "tool":
      return "Tool";
    default:
      return "Research";
  }
};

// Status badge component (using teal colors)
const StatusBadge = ({ status }) => {
  const styles = {
    published: {
      bg: `${colors.primary[600]}15`,
      text: colors.primary[700],
      label: "Published",
    },
    in_progress: {
      bg: `${colors.primary[400]}15`,
      text: colors.primary[600],
      label: "In Progress",
    },
    planned: {
      bg: colors.gray[100],
      text: colors.gray[500],
      label: "Coming Soon",
    },
  };

  const style = styles[status];
  if (!style) return null;

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: `2px ${spacing.sm}`,
      borderRadius: spacing.radius.sm,
      backgroundColor: style.bg,
      color: style.text,
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.medium,
      fontFamily: typography.fontFamily.body,
    }}>
      {style.label}
    </span>
  );
};

// Dashboard card (compact style, same as StandardCard)
const DashboardCard = memo(({ item }) => (
  <div
    style={{
      backgroundColor: colors.white,
      borderRadius: spacing.radius.lg,
      border: `1px solid ${colors.border.light}`,
      padding: spacing.md,
      transition: "box-shadow 0.2s ease, transform 0.2s ease",
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.boxShadow = "var(--shadow-elevation-low)";
      e.currentTarget.style.transform = "translateY(-2px)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.boxShadow = "none";
      e.currentTarget.style.transform = "translateY(0)";
    }}
  >
    <div style={{ display: "flex", alignItems: "flex-start", gap: spacing.md }}>
      <div style={{
        flexShrink: 0,
        width: "40px",
        height: "40px",
        borderRadius: spacing.radius.lg,
        backgroundColor: `${colors.primary[400]}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.primary[600],
      }}>
        <DashboardIcon />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs }}>
          <span style={{
            color: colors.primary[700],
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            {getTypeLabel(item.type)}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <h4 style={{
          margin: `0 0 ${spacing.xs}`,
          color: colors.secondary[900],
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
        }}>{item.title}</h4>
        <p style={{
          margin: `0 0 ${spacing.sm}`,
          color: colors.text.secondary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
          lineHeight: "1.5",
        }}>{item.description}</p>
        {item.keyFindings && item.keyFindings.length > 0 && (
          <ul style={{
            margin: `0 0 ${spacing.sm}`,
            padding: 0,
            listStyle: "none",
          }}>
            {item.keyFindings.slice(0, 2).map((finding, i) => (
              <li key={i} style={{
                display: "flex",
                alignItems: "flex-start",
                marginBottom: spacing.xs,
                color: colors.text.tertiary,
                fontSize: typography.fontSize.xs,
                fontFamily: typography.fontFamily.body,
              }}>
                <span style={{ color: colors.primary[400], marginRight: spacing.xs }}>•</span>
                {finding}
              </li>
            ))}
          </ul>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing.xs,
              color: colors.primary[600],
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              fontFamily: typography.fontFamily.body,
              textDecoration: "none",
              transition: "color 0.2s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = colors.primary[400]}
            onMouseLeave={(e) => e.currentTarget.style.color = colors.primary[600]}
          >
            Open Dashboard <ExternalLinkIcon />
          </a>
        )}
      </div>
    </div>
  </div>
));

// Blog/standard card
const StandardCard = memo(({ item }) => (
  <div
    style={{
      backgroundColor: colors.white,
      borderRadius: spacing.radius.lg,
      border: `1px solid ${colors.border.light}`,
      padding: spacing.md,
      transition: "box-shadow 0.2s ease, transform 0.2s ease",
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.boxShadow = "var(--shadow-elevation-low)";
      e.currentTarget.style.transform = "translateY(-2px)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.boxShadow = "none";
      e.currentTarget.style.transform = "translateY(0)";
    }}
  >
    <div style={{ display: "flex", alignItems: "flex-start", gap: spacing.md }}>
      <div style={{
        flexShrink: 0,
        width: "40px",
        height: "40px",
        borderRadius: spacing.radius.lg,
        backgroundColor: colors.gray[100],
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.gray[500],
      }}>
        {getTypeIcon(item.type)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs }}>
          <span style={{
            color: colors.text.tertiary,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            {getTypeLabel(item.type)}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <h4 style={{
          margin: `0 0 ${spacing.xs}`,
          color: colors.secondary[900],
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
        }}>{item.title}</h4>
        {item.date && (
          <p style={{
            margin: `0 0 ${spacing.sm}`,
            color: colors.text.tertiary,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
          }}>{item.date} • {item.author}</p>
        )}
        <p style={{
          margin: `0 0 ${spacing.sm}`,
          color: colors.text.secondary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
          lineHeight: "1.5",
        }}>{item.description}</p>
        {item.keyFindings && item.keyFindings.length > 0 && (
          <ul style={{
            margin: `0 0 ${spacing.sm}`,
            padding: 0,
            listStyle: "none",
          }}>
            {item.keyFindings.slice(0, 2).map((finding, i) => (
              <li key={i} style={{
                display: "flex",
                alignItems: "flex-start",
                marginBottom: spacing.xs,
                color: colors.text.tertiary,
                fontSize: typography.fontSize.xs,
                fontFamily: typography.fontFamily.body,
              }}>
                <span style={{ color: colors.primary[400], marginRight: spacing.xs }}>•</span>
                {finding}
              </li>
            ))}
          </ul>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing.xs,
              color: colors.primary[600],
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              fontFamily: typography.fontFamily.body,
              textDecoration: "none",
              transition: "color 0.2s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = colors.primary[400]}
            onMouseLeave={(e) => e.currentTarget.style.color = colors.primary[600]}
          >
            Read More <ExternalLinkIcon />
          </a>
        )}
      </div>
    </div>
  </div>
));

// In Progress card (using teal colors)
const InProgressCard = memo(({ item }) => (
  <div style={{
    backgroundColor: `${colors.primary[400]}10`,
    border: `1px solid ${colors.primary[400]}25`,
    borderRadius: spacing.radius.lg,
    padding: spacing.md,
  }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: spacing.md }}>
      <div style={{
        flexShrink: 0,
        width: "40px",
        height: "40px",
        borderRadius: spacing.radius.lg,
        backgroundColor: `${colors.primary[400]}20`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.primary[600],
      }}>
        <ClockIcon />
      </div>
      <div style={{ flex: 1 }}>
        <span style={{
          display: "inline-block",
          marginBottom: spacing.xs,
          color: colors.primary[700],
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          In Progress
        </span>
        <h4 style={{
          margin: `0 0 ${spacing.xs}`,
          color: colors.secondary[900],
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
        }}>{item.title}</h4>
        {item.expectedDate && (
          <p style={{
            margin: `0 0 ${spacing.sm}`,
            display: "flex",
            alignItems: "center",
            gap: spacing.xs,
            color: colors.primary[600],
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
          }}>
            <CalendarIcon /> Expected: {item.expectedDate}
          </p>
        )}
        <p style={{
          margin: 0,
          color: colors.text.secondary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
          lineHeight: "1.5",
        }}>{item.description}</p>
      </div>
    </div>
  </div>
));

// Planned card
const PlannedCard = memo(({ item }) => (
  <div style={{
    backgroundColor: colors.background.tertiary,
    border: `1px solid ${colors.border.light}`,
    borderRadius: spacing.radius.lg,
    padding: spacing.md,
  }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: spacing.md }}>
      <div style={{
        flexShrink: 0,
        width: "40px",
        height: "40px",
        borderRadius: spacing.radius.lg,
        backgroundColor: colors.gray[200],
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.gray[500],
      }}>
        <CalendarIcon />
      </div>
      <div style={{ flex: 1 }}>
        <span style={{
          display: "inline-block",
          marginBottom: spacing.xs,
          color: colors.text.tertiary,
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          Coming Soon
        </span>
        <h4 style={{
          margin: `0 0 ${spacing.xs}`,
          color: colors.secondary[900],
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
        }}>{item.title}</h4>
        <p style={{
          margin: `0 0 ${item.sourceUrl ? spacing.sm : 0}`,
          color: colors.text.secondary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
          lineHeight: "1.5",
        }}>{item.description}</p>
        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing.xs,
              color: colors.primary[600],
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              fontFamily: typography.fontFamily.body,
              textDecoration: "none",
              transition: "color 0.2s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = colors.primary[400]}
            onMouseLeave={(e) => e.currentTarget.style.color = colors.primary[600]}
          >
            View Source <ExternalLinkIcon />
          </a>
        )}
      </div>
    </div>
  </div>
));

// Main ResearchCard component that routes to the right card type
const ResearchCard = memo(({ item }) => {
  if (item.status === "in_progress") {
    return <InProgressCard item={item} />;
  }
  if (item.status === "planned") {
    return <PlannedCard item={item} />;
  }
  if (item.type === "dashboard") {
    return <DashboardCard item={item} />;
  }
  return <StandardCard item={item} />;
});

DashboardCard.displayName = "DashboardCard";
StandardCard.displayName = "StandardCard";
InProgressCard.displayName = "InProgressCard";
PlannedCard.displayName = "PlannedCard";
ResearchCard.displayName = "ResearchCard";

export default ResearchCard;
