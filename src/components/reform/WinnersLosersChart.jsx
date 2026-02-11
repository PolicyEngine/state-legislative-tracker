import { useState } from "react";
import { colors, typography, spacing } from "../../designTokens";

// Matches app-v2 WinnersLosersIncomeDecileSubPage exactly
const CATEGORIES = [
  { key: "gainMore5Pct", label: "Gain more than 5%", color: colors.primary[700] },
  { key: "gainLess5Pct", label: "Gain less than 5%", color: "#31979599" },
  { key: "noChange", label: "No change", color: colors.gray[200] },
  { key: "loseLess5Pct", label: "Loss less than 5%", color: colors.gray[400] },
  { key: "loseMore5Pct", label: "Loss more than 5%", color: colors.gray[600] },
];

const DECILE_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

function StackedRow({ label, data, height = 28 }) {
  const [tooltip, setTooltip] = useState(null);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      height,
    }}>
      <div style={{
        display: "flex",
        width: "100%",
        height: "100%",
        borderRadius: "2px",
        overflow: "hidden",
        position: "relative",
      }}>
        {CATEGORIES.map((cat) => {
          const value = data[cat.key] || 0;
          if (value <= 0) return null;
          const pctText = `${Math.round(value * 100)}%`;
          const showLabel = value >= 0.06;

          return (
            <div
              key={cat.key}
              style={{
                width: `${value * 100}%`,
                backgroundColor: cat.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                position: "relative",
                minWidth: value > 0 ? "2px" : 0,
              }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setTooltip({
                  cat,
                  value,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              {showLabel && (
                <span style={{
                  fontSize: "11px",
                  fontWeight: typography.fontWeight.medium,
                  fontFamily: typography.fontFamily.body,
                  color: cat.key === "noChange" ? colors.text.secondary : colors.white,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}>
                  {pctText}
                </span>
              )}
            </div>
          );
        })}
        {tooltip && (
          <div style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
            backgroundColor: colors.secondary[900],
            color: colors.white,
            padding: `${spacing.sm} ${spacing.md}`,
            borderRadius: spacing.radius.md,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            lineHeight: "1.4",
            maxWidth: "260px",
            pointerEvents: "none",
            zIndex: 1000,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontWeight: typography.fontWeight.semibold, marginBottom: "2px" }}>
              {label === "All" ? "All households" : `Decile ${label}`}
            </div>
            <div>
              {label === "All" ? "Of all households, " : `Of households in the ${DECILE_LABELS[parseInt(label) - 1]} decile, `}
              this reform would cause {(tooltip.value * 100).toFixed(1)}% of people to{" "}
              {tooltip.cat.key === "gainMore5Pct" && "gain more than 5% of"}
              {tooltip.cat.key === "gainLess5Pct" && "gain less than 5% of"}
              {tooltip.cat.key === "noChange" && "neither gain nor lose"}
              {tooltip.cat.key === "loseLess5Pct" && "lose less than 5% of"}
              {tooltip.cat.key === "loseMore5Pct" && "lose more than 5% of"}
              {tooltip.cat.key !== "noChange" ? " their net income." : " their net income."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getTitle(allData) {
  const totalAhead = (allData.gainMore5Pct || 0) + (allData.gainLess5Pct || 0);
  const totalBehind = (allData.loseLess5Pct || 0) + (allData.loseMore5Pct || 0);
  const fmt = (n) => `${Math.round(n * 100)}%`;

  if (totalAhead > 0 && totalBehind > 0) {
    return `This reform would increase the net income for ${fmt(totalAhead)} of the population and decrease it for ${fmt(totalBehind)}`;
  }
  if (totalAhead > 0) {
    return `This reform would increase the net income for ${fmt(totalAhead)} of the population`;
  }
  if (totalBehind > 0) {
    return `This reform would decrease the net income for ${fmt(totalBehind)} of the population`;
  }
  return "This reform would have no effect on net income for the population";
}

export default function WinnersLosersChart({ winnersLosers }) {
  if (!winnersLosers) return null;

  const intraDecile = winnersLosers.intraDecile;
  const hasDeciles = intraDecile && intraDecile.deciles;

  const allData = {
    gainMore5Pct: winnersLosers.gainMore5Pct || 0,
    gainLess5Pct: winnersLosers.gainLess5Pct || 0,
    noChange: winnersLosers.noChange || 0,
    loseLess5Pct: winnersLosers.loseLess5Pct || 0,
    loseMore5Pct: winnersLosers.loseMore5Pct || 0,
  };

  const title = getTitle(allData);

  return (
    <div>
      {/* Title */}
      <p style={{
        margin: `0 0 ${spacing.md}`,
        fontSize: typography.fontSize.base,
        fontFamily: typography.fontFamily.body,
        color: colors.text.secondary,
        lineHeight: "1.4",
      }}>
        {title}
      </p>

      {/* "All" row */}
      <StackedRow label="All" data={allData} height={32} />
      <div style={{
        textAlign: "center",
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        color: colors.text.tertiary,
        marginTop: "2px",
        marginBottom: spacing.md,
      }}>
        All households
      </div>

      {/* Per-decile rows */}
      {hasDeciles && (
        <div>
          <div style={{ display: "flex" }}>
            {/* Y-axis label */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              width: 20,
            }}>
              <span style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                fontSize: typography.fontSize.xs,
                fontFamily: typography.fontFamily.body,
                color: colors.text.tertiary,
                whiteSpace: "nowrap",
              }}>
                Income decile
              </span>
            </div>

            {/* Decile numbers + bars */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              flex: 1,
            }}>
              {Array.from({ length: 10 }, (_, i) => {
                const decile = String(10 - i);
                return (
                  <div key={decile} style={{ display: "flex", alignItems: "center" }}>
                    <span style={{
                      width: 24,
                      textAlign: "right",
                      marginRight: spacing.sm,
                      fontSize: typography.fontSize.xs,
                      fontFamily: typography.fontFamily.body,
                      color: colors.text.tertiary,
                      flexShrink: 0,
                    }}>
                      {decile}
                    </span>
                    <div style={{ flex: 1 }}>
                      <StackedRow
                        label={decile}
                        data={intraDecile.deciles[decile] || allData}
                        height={24}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* X-axis labels */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginLeft: 52,
            marginTop: spacing.xs,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
          }}>
            <span>0%</span>
            <span>Population share</span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: spacing.md,
        marginTop: spacing.sm,
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        color: colors.text.secondary,
      }}>
        {CATEGORIES.map((cat) => (
          <div
            key={cat.key}
            style={{ display: "flex", alignItems: "center", gap: spacing.xs }}
          >
            <div style={{
              width: 12,
              height: 12,
              borderRadius: "2px",
              backgroundColor: cat.color,
            }} />
            <span>{cat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
