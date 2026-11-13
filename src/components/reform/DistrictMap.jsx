import { useState, useEffect, useMemo, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Annotation,
  Marker,
} from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { colors, typography, spacing } from "../../designTokens";
import { useData } from "../../context/DataContext";
import { track } from "../../lib/analytics";
import {
  congressLabel,
  districtCongressOf,
  districtNumberOf,
  isAtLarge,
  loadStateDistrictsGeo,
} from "./districtGeo";

// Generic district visualization for other states (card-based grid)
const STATE_DISTRICTS = {
  AL: [
    { id: "1", name: "District 1", region: "Mobile & Southwest" },
    { id: "2", name: "District 2", region: "Dothan & Southeast" },
    { id: "3", name: "District 3", region: "East Alabama" },
    { id: "4", name: "District 4", region: "North Central" },
    { id: "5", name: "District 5", region: "Huntsville & North" },
    { id: "6", name: "District 6", region: "Birmingham Suburbs" },
    { id: "7", name: "District 7", region: "Birmingham & Black Belt" },
  ],
  AK: [{ id: "AL", name: "At-Large", region: "Statewide" }],
  AZ: [
    { id: "1", name: "District 1", region: "Northeast & Rural" },
    { id: "2", name: "District 2", region: "Southern Arizona" },
    { id: "3", name: "District 3", region: "West Phoenix" },
    { id: "4", name: "District 4", region: "North & West Phoenix" },
    { id: "5", name: "District 5", region: "East Valley" },
    { id: "6", name: "District 6", region: "Scottsdale & East" },
    { id: "7", name: "District 7", region: "South Phoenix" },
    { id: "8", name: "District 8", region: "Northwest Phoenix" },
    { id: "9", name: "District 9", region: "Central Phoenix" },
  ],
  UT: [
    { id: "1", name: "District 1", region: "Northern Utah" },
    { id: "2", name: "District 2", region: "Western & Rural Utah" },
    { id: "3", name: "District 3", region: "Central & Eastern Utah" },
    { id: "4", name: "District 4", region: "Salt Lake Suburbs" },
  ],
  SC: [
    { id: "1", name: "District 1", region: "Charleston & Coast" },
    { id: "2", name: "District 2", region: "Columbia & Midlands" },
    { id: "3", name: "District 3", region: "Upstate West" },
    { id: "4", name: "District 4", region: "Greenville-Spartanburg" },
    { id: "5", name: "District 5", region: "Rock Hill & North Central" },
    { id: "6", name: "District 6", region: "Pee Dee & Rural East" },
    { id: "7", name: "District 7", region: "Myrtle Beach & Northeast" },
  ],
  OK: [
    { id: "1", name: "District 1", region: "Tulsa Area" },
    { id: "2", name: "District 2", region: "Eastern Oklahoma" },
    { id: "3", name: "District 3", region: "Western Oklahoma" },
    { id: "4", name: "District 4", region: "South Central Oklahoma" },
    { id: "5", name: "District 5", region: "Oklahoma City Area" },
  ],
  // Add more states as needed...
};

const ArrowUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 17l9.2-9.2M17 17V7H7" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 7l-9.2 9.2M7 7v10h10" />
  </svg>
);

// Interpolate between two hex colors; t in [0, 1]
function lerpColor(a, b, t) {
  const parse = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const c = (x1, x2) => Math.round(x1 + (x2 - x1) * t);
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`;
}

function getImpactColor(avgBenefit, maxBenefit) {
  if (avgBenefit === 0) return colors.gray[200];
  const t = Math.min(Math.abs(avgBenefit) / maxBenefit, 1);
  const target = avgBenefit > 0 ? colors.primary[500] : colors.red[500];
  return lerpColor(colors.gray[200], target, t);
}

function getImpactHoverColor(avgBenefit, maxBenefit) {
  if (avgBenefit === 0) return colors.gray[300];
  const t = Math.min(Math.abs(avgBenefit) / maxBenefit, 1);
  const target = avgBenefit > 0 ? colors.primary[600] : colors.red[600];
  return lerpColor(colors.gray[300], target, t);
}

// Gradient legend scale bar
function ImpactLegend({ maxBenefit, allPositive, allNegative }) {
  const formatVal = (v) => {
    const abs = Math.abs(v);
    if (abs >= 1e9) return `$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(abs / 1e6).toFixed(0)}M`;
    if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
    return `$${abs.toFixed(0)}`;
  };

  const endColor = allNegative ? colors.red[500] : colors.primary[500];
  const endLabel = allNegative ? `-${formatVal(maxBenefit)}` : `+${formatVal(maxBenefit)}`;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTop: `1px solid ${colors.border.light}`,
    }}>
      <span style={{
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        color: colors.text.tertiary,
        marginBottom: "2px",
      }}>
        Avg. household benefit
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, width: "80%", maxWidth: "240px" }}>
        <span style={{ fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.body, color: colors.text.secondary, whiteSpace: "nowrap" }}>$0</span>
        <div style={{
          flex: 1,
          height: "12px",
          borderRadius: "2px",
          background: `linear-gradient(to right, ${colors.gray[200]}, ${endColor})`,
        }} />
        <span style={{ fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.body, color: colors.text.secondary, whiteSpace: "nowrap" }}>{endLabel}</span>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{
      padding: spacing.md,
      backgroundColor: colors.background.secondary,
      borderRadius: spacing.radius.lg,
      textAlign: "center",
    }}>
      <p style={{
        margin: 0,
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        color: colors.text.tertiary,
        textTransform: "uppercase",
        letterSpacing: "0.3px",
      }}>
        {label}
      </p>
      <p style={{
        margin: `${spacing.sm} 0 0`,
        fontSize: typography.fontSize.base,
        fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.primary,
        color: color || colors.secondary[800],
      }}>
        {value}
      </p>
    </div>
  );
}

// Fallback card-based view for states without SVG maps
function CardBasedDistrictView({ stateAbbr, reformId }) {
  const districts = STATE_DISTRICTS[stateAbbr];
  const { getImpact } = useData();
  const reformImpacts = getImpact(reformId);
  const hasDistrictData = reformImpacts?.districtImpacts;

  if (!districts) {
    return (
      <div style={{
        padding: spacing["2xl"],
        textAlign: "center",
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.xl,
        border: `1px dashed ${colors.border.medium}`,
      }}>
        <p style={{
          margin: 0,
          color: colors.text.tertiary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
        }}>
          District data not available for this state
        </p>
      </div>
    );
  }

  const maxBenefit = hasDistrictData
    ? Math.max(...districts.map(d => Math.abs(yearImpacts.districtImpacts[`${stateAbbr}-${d.id}`]?.avgBenefit || 0)))
    : 100;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: spacing.lg,
    }}>
      {districts.map((district) => {
        const impact = hasDistrictData
          ? yearImpacts.districtImpacts[`${stateAbbr}-${district.id}`]
          : null;
        const avgBenefit = impact?.avgBenefit || 0;
        const isPositive = avgBenefit > 0;
        const barWidth = maxBenefit > 0 ? (Math.abs(avgBenefit) / maxBenefit) * 100 : 0;

        return (
          <div
            key={district.id}
            style={{
              padding: spacing.lg,
              backgroundColor: colors.white,
              borderRadius: spacing.radius.xl,
              border: `1px solid ${colors.border.light}`,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              marginBottom: spacing.md,
            }}>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: spacing.radius.lg,
                backgroundColor: getImpactColor(avgBenefit, maxBenefit),
                color: colors.secondary[900],
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
              }}>
                {district.id}
              </span>
              <div>
                <span style={{
                  fontSize: typography.fontSize.base,
                  fontWeight: typography.fontWeight.semibold,
                  fontFamily: typography.fontFamily.primary,
                  color: colors.secondary[900],
                }}>
                  {district.name}
                </span>
                <p style={{
                  margin: 0,
                  fontSize: typography.fontSize.xs,
                  fontFamily: typography.fontFamily.body,
                  color: colors.text.tertiary,
                }}>
                  {district.region}
                </p>
              </div>
            </div>

            {impact ? (
              <>
                <div style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: spacing.xs,
                  marginBottom: spacing.sm,
                }}>
                  <span style={{
                    fontSize: typography.fontSize["2xl"],
                    fontWeight: typography.fontWeight.bold,
                    fontFamily: typography.fontFamily.primary,
                    color: avgBenefit === 0 ? colors.gray[600] : (isPositive ? colors.primary[700] : colors.red[700]),
                  }}>
                    {isPositive ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit)}`}
                  </span>
                  <span style={{
                    fontSize: typography.fontSize.sm,
                    fontFamily: typography.fontFamily.body,
                    color: colors.text.tertiary,
                  }}>
                    /household
                  </span>
                </div>

                <div style={{
                  height: "6px",
                  backgroundColor: colors.gray[100],
                  borderRadius: "3px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${barWidth}%`,
                    height: "100%",
                    backgroundColor: avgBenefit === 0 ? colors.gray[400] : (isPositive ? colors.primary[500] : colors.red[500]),
                    borderRadius: "3px",
                  }} />
                </div>
              </>
            ) : (
              <p style={{
                margin: 0,
                color: colors.text.tertiary,
                fontSize: typography.fontSize.sm,
                fontFamily: typography.fontFamily.body,
              }}>
                Data not yet computed
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// State center coordinates for map projection
const STATE_CENTERS = {
  "AL": [-86.9, 32.8], "AK": [-153.0, 64.0], "AZ": [-111.9, 34.2], "AR": [-92.4, 34.9],
  "CA": [-119.4, 37.2], "CO": [-105.5, 39.0], "CT": [-72.7, 41.6], "DE": [-75.5, 39.0],
  "FL": [-82.5, 28.5], "GA": [-83.5, 32.7], "HI": [-157.5, 20.5], "ID": [-114.7, 44.4],
  "IL": [-89.2, 40.0], "IN": [-86.3, 39.9], "IA": [-93.5, 42.0], "KS": [-98.4, 38.5],
  "KY": [-85.7, 37.8], "LA": [-91.9, 31.0], "ME": [-69.2, 45.3], "MD": [-76.8, 39.0],
  "MA": [-71.8, 42.3], "MI": [-85.6, 44.3], "MN": [-94.3, 46.3], "MS": [-89.7, 32.7],
  "MO": [-92.5, 38.4], "MT": [-109.6, 47.0], "NE": [-99.8, 41.5], "NV": [-116.6, 39.3],
  "NH": [-71.5, 43.7], "NJ": [-74.7, 40.1], "NM": [-106.0, 34.5], "NY": [-75.5, 43.0],
  "NC": [-79.4, 35.5], "ND": [-100.5, 47.4], "OH": [-82.8, 40.3], "OK": [-97.5, 35.5],
  "OR": [-120.5, 44.0], "PA": [-77.6, 40.9], "RI": [-71.5, 41.7], "SC": [-80.9, 33.9],
  "SD": [-100.2, 44.4], "TN": [-86.3, 35.8], "TX": [-99.3, 31.5], "UT": [-111.7, 39.3],
  "VT": [-72.7, 44.0], "VA": [-78.8, 37.5], "WA": [-120.5, 47.4], "WV": [-80.6, 38.9],
  "WI": [-89.8, 44.6], "WY": [-107.5, 43.0],
};

// State zoom levels
const STATE_ZOOMS = {
  "AK": 0.5, "TX": 2, "CA": 2, "MT": 2.5, "AZ": 3, "NM": 3, "NV": 3, "CO": 3,
  "OR": 3, "WY": 3, "KS": 3, "NE": 3, "SD": 3, "ND": 3, "OK": 3, "MN": 2.5,
  "IA": 3, "MO": 3, "AR": 3.5, "LA": 3.5, "WI": 3, "IL": 3, "MI": 2.5, "IN": 3.5,
  "OH": 3.5, "KY": 3.5, "TN": 3, "MS": 3.5, "AL": 3.5, "GA": 3, "FL": 2.5,
  "SC": 4, "NC": 3, "VA": 3, "WV": 4, "PA": 3.5, "NY": 2.5, "ME": 3, "VT": 5,
  "NH": 5, "MA": 5, "RI": 8, "CT": 6, "NJ": 5, "DE": 7, "MD": 5, "UT": 3.5,
  "ID": 3, "WA": 3, "HI": 3,
};

// District detail card for generic map - matches Utah style
function GenericDistrictDetailCard({ districtNum, impact, maxBenefit, stateName }) {
  const avgBenefit = impact?.avgBenefit || 0;
  const isPositive = avgBenefit > 0;
  const isNeutral = avgBenefit === 0;

  return (
    <div style={{
      padding: spacing.xl,
      backgroundColor: colors.white,
      borderRadius: spacing.radius.xl,
      border: `1px solid ${colors.border.light}`,
      boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        marginBottom: spacing.lg,
        paddingBottom: spacing.lg,
        borderBottom: `1px solid ${colors.border.light}`,
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "40px",
          height: "40px",
          borderRadius: spacing.radius.lg,
          backgroundColor: getImpactColor(avgBenefit, maxBenefit),
          color: colors.white,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
        }}>
          {districtNum}
        </span>
        <div>
          <h4 style={{
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            color: colors.secondary[900],
          }}>
            Congressional District {districtNum}
          </h4>
          <p style={{
            margin: `${spacing.xs} 0 0`,
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>
            {stateName}
          </p>
        </div>
      </div>

      {/* Impact Value */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}>
        <span style={{
          color: isNeutral ? colors.gray[500] : (isPositive ? colors.primary[600] : colors.red[600]),
        }}>
          {isNeutral ? null : (isPositive ? <ArrowUpIcon /> : <ArrowDownIcon />)}
        </span>
        <span style={{
          fontSize: typography.fontSize["3xl"],
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: isNeutral ? colors.gray[600] : (isPositive ? colors.primary[700] : colors.red[700]),
        }}>
          {isPositive ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit).toLocaleString()}`}
        </span>
        <span style={{
          fontSize: typography.fontSize.base,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>
          average household impact
        </span>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: spacing.sm,
      }}>
        {/* Winners / Losers unified */}
        <div style={{
          padding: spacing.md,
          backgroundColor: colors.background.secondary,
          borderRadius: spacing.radius.lg,
          textAlign: "center",
        }}>
          <p style={{
            margin: 0,
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}>
            Winners / Losers
          </p>
          <p style={{
            margin: `${spacing.sm} 0 0`,
            fontSize: typography.fontSize.base,
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
          }}>
            <span style={{ color: colors.primary[600] }}>{impact.winnersShare ? `${(impact.winnersShare * 100).toFixed(0)}%` : "0%"}</span>
            <span style={{ color: colors.text.tertiary }}>{" / "}</span>
            <span style={{ color: colors.red[600] }}>{impact.losersShare ? `${(impact.losersShare * 100).toFixed(0)}%` : "0%"}</span>
          </p>
        </div>
        <StatBox
          label="Poverty"
          value={impact.povertyPctChange == null || impact.povertyPctChange === 0
            ? "No change"
            : `${impact.povertyPctChange > 0 ? "+" : ""}${impact.povertyPctChange.toFixed(1)}%`}
          color={impact.povertyPctChange < 0 ? colors.primary[600] : (impact.povertyPctChange > 0 ? colors.red[600] : colors.gray[500])}
        />
        <StatBox
          label="Child Poverty"
          value={impact.childPovertyPctChange == null || impact.childPovertyPctChange === 0
            ? "No change"
            : `${impact.childPovertyPctChange > 0 ? "+" : ""}${impact.childPovertyPctChange.toFixed(1)}%`}
          color={impact.childPovertyPctChange < 0 ? colors.primary[600] : (impact.childPovertyPctChange > 0 ? colors.red[600] : colors.gray[500])}
        />
      </div>
    </div>
  );
}

// Generic state district map using react-simple-maps with ui-kit's district
// boundaries for the Congress the analysis was computed on
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 20;
const SLIDER_WIDTH = 140;

function ZoomSlider({ zoomLevel, onChange }) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef(null);

  const zoomToPercent = (z) => (z - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const percentToZoom = (p) => ZOOM_MIN + p * (ZOOM_MAX - ZOOM_MIN);

  const updateFromX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(percentToZoom(pct));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => updateFromX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const pct = zoomToPercent(zoomLevel);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: `${spacing.xs} ${spacing.sm}`,
      backgroundColor: colors.white,
      borderRadius: spacing.radius.lg,
      border: `1px solid ${colors.border.light}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
    }}>
      <span style={{
        fontSize: "13px",
        fontWeight: typography.fontWeight.bold,
        color: colors.secondary[800],
        lineHeight: 1,
        cursor: "pointer",
        userSelect: "none",
      }}
        onClick={() => onChange(Math.max(zoomLevel / 1.5, ZOOM_MIN))}
      >-</span>

      <div
        ref={trackRef}
        style={{
          height: 6,
          width: SLIDER_WIDTH,
          backgroundColor: colors.gray[200],
          borderRadius: 3,
          position: "relative",
          cursor: "pointer",
        }}
        onMouseDown={(e) => {
          setDragging(true);
          updateFromX(e.clientX);
        }}
      >
        {/* Fill */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: `${pct * 100}%`,
          backgroundColor: colors.primary[400],
          borderRadius: 3,
          pointerEvents: "none",
        }} />
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            left: `${pct * 100}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            backgroundColor: colors.white,
            border: `2px solid ${colors.primary[500]}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            cursor: "grab",
            pointerEvents: "none",
          }}
        />
      </div>

      <span style={{
        fontSize: "13px",
        fontWeight: typography.fontWeight.bold,
        color: colors.secondary[800],
        lineHeight: 1,
        cursor: "pointer",
        userSelect: "none",
      }}
        onClick={() => onChange(Math.min(zoomLevel * 1.5, ZOOM_MAX))}
      >+</span>
    </div>
  );
}

function DistrictDropdown({ geoData, getDistrictInfo, hasDistrictData, reformImpacts, maxBenefit, activeDistrict, onSelect }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const items = (geoData?.features || []).map((feature) => {
    const info = getDistrictInfo(feature);
    if (!info) return null;
    const impact = hasDistrictData ? reformImpacts.districtImpacts[info.districtId] : null;
    const avgBenefit = impact?.avgBenefit || 0;
    return { ...info, avgBenefit };
  }).filter(Boolean);

  const selected = items.find((d) => d.districtId === activeDistrict);

  const formatValue = (val) => {
    const sign = val > 0 ? "+" : "";
    return val === 0 ? "$0" : `${sign}$${Math.abs(val).toLocaleString()}`;
  };

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          padding: `${spacing.sm} ${spacing.md}`,
          borderRadius: spacing.radius.lg,
          border: `1px solid ${open ? colors.primary[300] : colors.border.light}`,
          backgroundColor: colors.white,
          cursor: "pointer",
          transition: "border-color 0.15s ease",
          boxShadow: open ? `0 0 0 3px ${colors.primary[100]}` : "none",
        }}
      >
        {selected ? (
          <>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: spacing.radius.md,
              backgroundColor: getImpactColor(selected.avgBenefit, maxBenefit),
              color: colors.white,
              fontSize: "11px",
              fontWeight: typography.fontWeight.bold,
              fontFamily: typography.fontFamily.primary,
              flexShrink: 0,
            }}>
              {selected.districtNum}
            </span>
            <span style={{
              flex: 1,
              textAlign: "left",
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
              color: colors.secondary[900],
              fontWeight: typography.fontWeight.medium,
            }}>
              District {selected.districtNum}
            </span>
            <span style={{
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.bold,
              fontFamily: typography.fontFamily.primary,
              color: selected.avgBenefit > 0 ? colors.primary[600] : (selected.avgBenefit < 0 ? colors.red[600] : colors.gray[500]),
            }}>
              {formatValue(selected.avgBenefit)}
            </span>
          </>
        ) : (
          <span style={{
            flex: 1,
            textAlign: "left",
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
          }}>
            Select a district...
          </span>
        )}
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={colors.text.tertiary} strokeWidth="2"
          style={{
            flexShrink: 0,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown list */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          maxHeight: "240px",
          overflowY: "auto",
          backgroundColor: colors.white,
          borderRadius: spacing.radius.lg,
          border: `1px solid ${colors.border.light}`,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          zIndex: 20,
          padding: spacing.xs,
        }}>
          {items.map((item) => {
            const isActive = item.districtId === activeDistrict;
            return (
              <button
                key={item.districtId}
                onClick={() => {
                  onSelect(item.districtId);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: `${spacing.sm} ${spacing.md}`,
                  borderRadius: spacing.radius.md,
                  border: "none",
                  backgroundColor: isActive ? colors.primary[50] : "transparent",
                  cursor: "pointer",
                  transition: "background-color 0.1s ease",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = colors.gray[50]; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: spacing.radius.md,
                  backgroundColor: getImpactColor(item.avgBenefit, maxBenefit),
                  color: colors.white,
                  fontSize: "11px",
                  fontWeight: typography.fontWeight.bold,
                  fontFamily: typography.fontFamily.primary,
                  flexShrink: 0,
                }}>
                  {item.districtNum}
                </span>
                <span style={{
                  flex: 1,
                  textAlign: "left",
                  fontSize: typography.fontSize.sm,
                  fontFamily: typography.fontFamily.body,
                  color: colors.secondary[900],
                  fontWeight: isActive ? typography.fontWeight.semibold : typography.fontWeight.normal,
                }}>
                  District {item.districtNum}
                </span>
                <span style={{
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.bold,
                  fontFamily: typography.fontFamily.primary,
                  color: item.avgBenefit > 0 ? colors.primary[600] : (item.avgBenefit < 0 ? colors.red[600] : colors.gray[500]),
                }}>
                  {formatValue(item.avgBenefit)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GenericStateDistrictMap({ stateAbbr, reformId, selectedYear, congress }) {
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [geoState, setGeoState] = useState({ key: null, data: null, error: null });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panCenter, setPanCenter] = useState(null);
  const { getImpact } = useData();
  const reformImpacts = getImpact(reformId);

  // Get district impacts - from impactsByYear if multi-year, otherwise from root
  const yearImpacts = selectedYear && reformImpacts?.impactsByYear?.[selectedYear]
    ? reformImpacts.impactsByYear[selectedYear]
    : reformImpacts;
  const hasDistrictData = yearImpacts?.districtImpacts;

  // Boundaries for the Congress the district results were computed on.
  // geoState.key records which state and Congress the loaded data belongs to,
  // so switching either shows the loading state instead of stale boundaries.
  const geoKey = `${stateAbbr}:${congress}`;
  useEffect(() => {
    let cancelled = false;
    loadStateDistrictsGeo(stateAbbr, congress)
      .then((data) => {
        if (cancelled) return;
        setGeoState(
          data.features.length > 0
            ? { key: geoKey, data, error: null }
            : { key: geoKey, data: null, error: "No districts found" }
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load congressional districts:", err);
        setGeoState({ key: geoKey, data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [stateAbbr, congress, geoKey]);
  const loading = geoState.key !== geoKey;
  const geoData = loading ? null : geoState.data;
  const error = loading ? null : geoState.error;

  // Calculate centroids for district labels
  const districtCentroids = useMemo(() => {
    if (!geoData) return {};
    const centroids = {};
    geoData.features.forEach(feature => {
      const props = feature.properties;
      const districtNum = districtNumberOf(props);
      const districtId = `${stateAbbr}-${districtNum || 1}`;
      const centroid = geoCentroid(feature);
      centroids[districtId] = {
        coords: centroid,
        num: isAtLarge(props) || districtNum === 0 ? "AL" : districtNum,
      };
    });
    return centroids;
  }, [geoData, stateAbbr]);

  // Calculate max benefit for color scaling
  const maxBenefit = useMemo(() => {
    if (!hasDistrictData) return 100;
    return Math.max(...Object.values(yearImpacts.districtImpacts).map(d => Math.abs(d?.avgBenefit || 0)), 1);
  }, [hasDistrictData, yearImpacts]);

  const allDistrictValues = useMemo(() => {
    if (!hasDistrictData) return [];
    return Object.values(yearImpacts.districtImpacts).map(d => d?.avgBenefit || 0);
  }, [hasDistrictData, yearImpacts]);

  if (loading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "300px",
        color: colors.text.secondary,
      }}>
        Loading map...
      </div>
    );
  }

  if (error || !geoData) {
    return <CardBasedDistrictView stateAbbr={stateAbbr} reformId={reformId} />;
  }

  // District number from ui-kit's DISTRICT_ID ("TX-05")
  const getDistrictInfo = (geo) => {
    const props = geo.properties;
    if (!props) return null;
    const districtNum = districtNumberOf(props);
    return {
      districtId: `${stateAbbr}-${districtNum || 1}`,
      districtNum: isAtLarge(props) || districtNum === 0 ? "AL" : districtNum,
      name: props.NAMELSAD || props.NAME || `District ${districtNum}`,
    };
  };

  const getAvgBenefit = (districtId) => {
    if (!hasDistrictData) return 0;
    return yearImpacts.districtImpacts[districtId]?.avgBenefit || 0;
  };

  const allPositive = allDistrictValues.every(v => v >= 0);
  const allNegative = allDistrictValues.every(v => v <= 0);

  const activeDistrict = selectedDistrict;
  const activeImpact = activeDistrict && hasDistrictData
    ? yearImpacts.districtImpacts[activeDistrict]
    : null;

  const center = STATE_CENTERS[stateAbbr] || [-97, 38];
  const zoom = STATE_ZOOMS[stateAbbr] || 3;

  const stateName = {
    "OK": "Oklahoma", "UT": "Utah", "CA": "California", "NY": "New York",
    "TX": "Texas", "FL": "Florida", "GA": "Georgia", "NC": "North Carolina",
    "PA": "Pennsylvania", "OH": "Ohio", "MI": "Michigan", "IL": "Illinois",
  }[stateAbbr] || stateAbbr;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: spacing["2xl"],
      flex: 1,
      minHeight: 0,
    }}>
      {/* Map Container */}
      <div style={{
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        padding: spacing.xl,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}>
        <h4 style={{
          margin: `0 0 ${spacing.md}`,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.body,
          color: colors.text.secondary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          flexShrink: 0,
        }}>
          {stateName} Congressional Districts
        </h4>

        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          borderRadius: spacing.radius.lg,
        }}>
          {/* Zoom slider */}
          <div style={{
            position: "absolute",
            bottom: spacing.sm,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5,
          }}>
            <ZoomSlider zoomLevel={zoomLevel} onChange={setZoomLevel} />
          </div>

          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ scale: 800 }}
            width={800}
            height={800}
            style={{ width: "100%", height: "100%", maxHeight: "100%" }}
          >
            <ZoomableGroup
              center={panCenter || center}
              zoom={zoom * zoomLevel}
              onMoveEnd={({ coordinates }) => setPanCenter(coordinates)}
            >
              <Geographies geography={geoData}>
                {({ geographies }) =>
                  geographies.map(geo => {
                    const info = getDistrictInfo(geo);
                    if (!info) return null;

                    const avgBenefit = getAvgBenefit(info.districtId);
                    const isSelected = selectedDistrict === info.districtId;
                    const fillColor = isSelected
                      ? getImpactHoverColor(avgBenefit, maxBenefit)
                      : getImpactColor(avgBenefit, maxBenefit);

                    return (
                      <Geography
                        key={geo.rsmKey || info.districtId}
                        geography={geo}
                        onClick={() => {
                          const next = selectedDistrict === info.districtId ? null : info.districtId;
                          setSelectedDistrict(next);
                          if (next) track("district_selected", { state_abbr: stateAbbr, district_id: info.districtId });
                        }}
                        style={{
                          default: {
                            fill: fillColor,
                            stroke: isSelected ? colors.primary[700] : colors.white,
                            strokeWidth: 0.05,
                            outline: "none",
                            cursor: "pointer",
                            transition: "fill 0.2s ease",
                          },
                          hover: {
                            fill: getImpactHoverColor(avgBenefit, maxBenefit),
                            stroke: colors.primary[600],
                            strokeWidth: 0.05,
                            outline: "none",
                            cursor: "pointer",
                          },
                          pressed: {
                            fill: getImpactHoverColor(avgBenefit, maxBenefit),
                            stroke: colors.primary[700],
                            strokeWidth: 0.05,
                            outline: "none",
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
              {/* District Labels */}
              {Object.entries(districtCentroids).map(([districtId, data]) => {
                const labelSize = 12 / (zoom * zoomLevel);
                return (
                  <Marker key={districtId} coordinates={data.coords}>
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{
                        fill: colors.white,
                        fontSize: `${labelSize}px`,
                        fontWeight: "700",
                        fontFamily: typography.fontFamily.primary,
                        pointerEvents: "none",
                        textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                      }}
                    >
                      {data.num}
                    </text>
                  </Marker>
                );
              })}
            </ZoomableGroup>
          </ComposableMap>
        </div>

        <ImpactLegend maxBenefit={maxBenefit} allPositive={allPositive} allNegative={allNegative} />
      </div>

      {/* Detail Panel */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.lg,
        minHeight: 0,
        overflow: "auto",
      }}>
        {/* District dropdown selector */}
        <DistrictDropdown
          geoData={geoData}
          getDistrictInfo={getDistrictInfo}
          hasDistrictData={hasDistrictData}
          reformImpacts={yearImpacts}
          maxBenefit={maxBenefit}
          activeDistrict={activeDistrict}
          onSelect={setSelectedDistrict}
        />

        {activeDistrict && activeImpact ? (
          <GenericDistrictDetailCard
            districtNum={activeDistrict.split("-")[1]}
            impact={activeImpact}
            maxBenefit={maxBenefit}
            stateName={stateName}
          />
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: spacing["2xl"],
            backgroundColor: colors.background.secondary,
            borderRadius: spacing.radius.xl,
            border: `1px dashed ${colors.border.medium}`,
          }}>
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: spacing.radius.full,
              backgroundColor: colors.primary[50],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: spacing.md,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary[400]} strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
            <p style={{
              margin: 0,
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
              textAlign: "center",
            }}>
              Select a district from the dropdown<br />or click on the map
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// States with only one congressional district (at-large)
const SINGLE_DISTRICT_STATES = ["AK", "DE", "ND", "SD", "VT", "WY", "DC"];

export default function DistrictMap({ stateAbbr, reformId }) {
  const { getImpact } = useData();
  const impacts = getImpact(reformId);

  // Check for multi-year impacts
  const availableYears = impacts?.impactsByYear ? Object.keys(impacts.impactsByYear).sort() : [];
  const hasMultipleYears = availableYears.length > 1;
  const defaultYear = hasMultipleYears ? availableYears[0] : null;
  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const congress = districtCongressOf(impacts, selectedYear);

  // Check if this is a single-district state
  const isSingleDistrict = SINGLE_DISTRICT_STATES.includes(stateAbbr);

  if (isSingleDistrict) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ marginBottom: spacing.md, flexShrink: 0 }}>
          <h3 style={{
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            color: colors.secondary[900],
          }}>
            Impact by Congressional District
          </h3>
        </div>
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background.secondary,
          borderRadius: spacing.radius.lg,
          border: `1px solid ${colors.border.light}`,
          padding: spacing.xl,
        }}>
          <p style={{
            margin: 0,
            fontSize: typography.fontSize.base,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
            textAlign: "center",
          }}>
            {stateAbbr === "DC" ? "Washington, D.C." : "This state"} has only one at-large congressional district.
            <br />
            <span style={{ fontSize: typography.fontSize.sm, color: colors.text.tertiary }}>
              Statewide impacts are shown in the previous tab.
            </span>
          </p>
        </div>
      </div>
    );
  }

  // Use generic map for all states
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ marginBottom: spacing.md, flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            color: colors.secondary[900],
          }}>
            Impact by Congressional District
          </h3>
          <p style={{
            margin: `${spacing.xs} 0 0`,
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>
            {congressLabel(congress)}. Click on a district to see detailed impact analysis
          </p>
        </div>

        {/* Year Tabs for multi-year reforms */}
        {hasMultipleYears && (
          <div style={{
            display: "flex",
            gap: spacing.xs,
          }}>
            {availableYears.map((year) => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                style={{
                  padding: `${spacing.xs} ${spacing.md}`,
                  fontSize: typography.fontSize.xs,
                  fontWeight: selectedYear === year ? typography.fontWeight.semibold : typography.fontWeight.medium,
                  fontFamily: typography.fontFamily.body,
                  color: selectedYear === year ? colors.white : colors.primary[600],
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
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <GenericStateDistrictMap
          stateAbbr={stateAbbr}
          reformId={reformId}
          selectedYear={selectedYear}
          congress={congress}
        />
      </div>
    </div>
  );
}
