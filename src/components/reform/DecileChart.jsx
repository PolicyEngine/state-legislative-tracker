import { useState } from "react";
import { colors, typography, spacing } from "../../designTokens";

const DECILE_LABELS = [
  "1st", "2nd", "3rd", "4th", "5th",
  "6th", "7th", "8th", "9th", "10th"
];

export default function DecileChart({ decileData }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  if (!decileData) return null;

  // Use relative (which contains absolute $ values from API) or absolute if available
  const data = decileData.relative || decileData.absolute;
  if (!data) return null;

  // Get values as array
  const values = DECILE_LABELS.map((_, i) => data[String(i + 1)] || 0);
  const maxValue = Math.max(...values.map(Math.abs));

  const formatValue = (val) => {
    const sign = val >= 0 ? "+" : "-";
    return `${sign}$${Math.round(Math.abs(val)).toLocaleString()}`;
  };

  return (
    <div>
      {/* Chart */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "2px",
        height: "120px",
        padding: `0 ${spacing.xs}`,
        position: "relative",
      }}>
        {values.map((value, index) => {
          const height = maxValue > 0 ? (Math.abs(value) / maxValue) * 100 : 0;
          const isPositive = value >= 0;
          const isHovered = hoveredIndex === index;

          return (
            <div
              key={index}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                height: "100%",
                position: "relative",
              }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Tooltip */}
              {isHovered && (
                <div style={{
                  position: "absolute",
                  bottom: `calc(${Math.max(height, 2)}% + 8px)`,
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: colors.secondary[900],
                  color: colors.white,
                  padding: `${spacing.xs} ${spacing.sm}`,
                  borderRadius: spacing.radius.md,
                  fontSize: typography.fontSize.xs,
                  fontWeight: typography.fontWeight.semibold,
                  fontFamily: typography.fontFamily.primary,
                  whiteSpace: "nowrap",
                  zIndex: 10,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: colors.gray[400], marginBottom: "2px" }}>
                      {DECILE_LABELS[index]} decile
                    </div>
                    <div style={{ color: isPositive ? colors.primary[300] : colors.red[300] }}>
                      {formatValue(value)}
                    </div>
                  </div>
                  {/* Tooltip arrow */}
                  <div style={{
                    position: "absolute",
                    bottom: "-4px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 0,
                    height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: `5px solid ${colors.secondary[900]}`,
                  }} />
                </div>
              )}
              {/* Bar */}
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(height, 2)}%`,
                  backgroundColor: isHovered
                    ? (isPositive ? colors.primary[600] : colors.red[600])
                    : (isPositive ? colors.primary[500] : colors.red[500]),
                  borderRadius: "2px 2px 0 0",
                  transition: "height 0.3s ease, background-color 0.15s ease",
                  minHeight: "2px",
                  cursor: "pointer",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div style={{
        display: "flex",
        gap: "2px",
        padding: `${spacing.xs} ${spacing.xs} 0`,
        borderTop: `1px solid ${colors.border.light}`,
      }}>
        {DECILE_LABELS.map((label, index) => (
          <div
            key={index}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.tertiary,
            }}
          >
            {index + 1}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: spacing.sm,
        paddingTop: spacing.sm,
      }}>
        <span style={{
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>
          ← Lower income
        </span>
        <span style={{
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>
          Higher income →
        </span>
      </div>
    </div>
  );
}
