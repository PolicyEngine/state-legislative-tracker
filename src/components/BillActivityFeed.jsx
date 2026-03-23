import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useData } from "../context/DataContext";
import { colors, typography, spacing } from "../designTokens";

// ============== Shared UI ==============

const STAGE_COLORS = {
  "Introduced": { bg: colors.gray[100], text: colors.gray[700], dot: colors.gray[400] },
  "In Committee": { bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  "Passed Committee": { bg: "#DBEAFE", text: "#1E40AF", dot: "#3B82F6" },
  "First Reading": { bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  "Second Reading": { bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  "Third Reading": { bg: "#DBEAFE", text: "#1E40AF", dot: "#3B82F6" },
  "Passed One Chamber": { bg: "#D1FAE5", text: "#065F46", dot: "#10B981" },
  "Passed Both Chambers": { bg: "#A7F3D0", text: "#065F46", dot: "#059669" },
  "Sent to Governor": { bg: "#C7D2FE", text: "#3730A3", dot: "#6366F1" },
  "Signed into Law": { bg: "#D1FAE5", text: "#065F46", dot: "#059669" },
  "Vetoed": { bg: "#FEE2E2", text: "#991B1B", dot: "#EF4444" },
  "Dead/Withdrawn": { bg: colors.gray[100], text: colors.gray[500], dot: colors.gray[400] },
};

const DEFAULT_STAGE_COLOR = { bg: colors.gray[100], text: colors.gray[600], dot: colors.gray[400] };

export function StageBadge({ stage }) {
  const style = STAGE_COLORS[stage] || DEFAULT_STAGE_COLOR;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 8px",
      borderRadius: "12px",
      backgroundColor: style.bg,
      color: style.text,
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.medium,
      fontFamily: typography.fontFamily.body,
      whiteSpace: "nowrap",
    }}>
      <span style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: style.dot,
      }} />
      {stage}
    </span>
  );
}

function TimeAgo({ dateStr }) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  let label;
  if (diffDays === 0) label = "Today";
  else if (diffDays === 1) label = "Yesterday";
  else if (diffDays < 7) label = `${diffDays}d ago`;
  else if (diffDays < 30) label = `${Math.floor(diffDays / 7)}w ago`;
  else label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <span style={{
      color: colors.text.tertiary,
      fontSize: "11px",
      fontFamily: typography.fontFamily.body,
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

// ============== Shared hook to fetch processed_bills ==============

export function useProcessedBills(stateFilter) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    async function fetchBills() {
      let query = supabase
        .from("processed_bills")
        .select("state, bill_number, title, status, last_action, last_action_date, confidence_score, reform_type, legiscan_url")
        .gt("confidence_score", 19)
        .is("skipped_reason", null)
        .order("last_action_date", { ascending: false });

      if (stateFilter) {
        query = query.eq("state", stateFilter);
      }

      const { data, error } = await query;
      if (!error && data) setBills(data);
      setLoading(false);
    }
    fetchBills();
  }, [stateFilter]);

  return { bills, loading };
}

// ============== RecentActivitySidebar (Home page right side) ==============

export function RecentActivitySidebar({ onStateSelect, onBillSelect }) {
  const { bills, loading } = useProcessedBills(null);
  const { statesWithBills, research } = useData();
  const encodedStates = useMemo(() => new Set(Object.keys(statesWithBills)), [statesWithBills]);
  const [tab, setTab] = useState("recent"); // "recent" | "analyzed"

  const recentBills = useMemo(() => bills.slice(0, 25), [bills]);

  // Bills that have PE analysis (exist in research table as published bills)
  // Also build reverse lookup: "STATE:BILLNUM" -> research id for navigation
  const { analyzedBillIds, billToResearchId } = useMemo(() => {
    const ids = new Set();
    const lookup = {};
    for (const r of research) {
      if (r.type === "bill" && r.status !== "in_review") {
        const parts = r.id.split("-");
        if (parts.length >= 2) {
          const state = parts[0].toUpperCase();
          const num = parts.slice(1).join("").toUpperCase();
          const key = `${state}:${num}`;
          ids.add(key);
          lookup[key] = { researchId: r.id, state };
        }
      }
    }
    return { analyzedBillIds: ids, billToResearchId: lookup };
  }, [research]);

  const analyzedBills = useMemo(
    () => bills
      .filter((b) => {
        const norm = `${b.state}:${b.bill_number.replace(/\s+/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2").toUpperCase()}`;
        return analyzedBillIds.has(norm);
      })
      .slice(0, 25),
    [bills, analyzedBillIds],
  );

  const displayBills = tab === "analyzed" ? analyzedBills : recentBills;

  if (loading) {
    return (
      <div style={{
        backgroundColor: colors.white,
        borderRadius: spacing.radius["2xl"],
        border: `1px solid ${colors.border.light}`,
        padding: spacing.lg,
        textAlign: "center",
        color: colors.text.tertiary,
        fontSize: typography.fontSize.sm,
        fontFamily: typography.fontFamily.body,
      }}>
        Loading activity...
      </div>
    );
  }

  if (!recentBills.length) return null;

  return (
    <div style={{
      backgroundColor: colors.white,
      borderRadius: spacing.radius["2xl"],
      boxShadow: "var(--shadow-elevation-low)",
      border: `1px solid ${colors.border.light}`,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: `${spacing.md} ${spacing.lg}`,
        borderBottom: `1px solid ${colors.border.light}`,
        backgroundColor: colors.background.secondary,
      }}>
        <h3 style={{
          margin: 0,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: colors.secondary[900],
          display: "flex",
          alignItems: "center",
          gap: spacing.xs,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Recent Legislative Activity
        </h3>
        {/* Tab toggle */}
        <div style={{
          display: "flex",
          gap: "2px",
          marginTop: spacing.sm,
          backgroundColor: colors.gray[100],
          borderRadius: spacing.radius.md,
          padding: "2px",
        }}>
          {[
            { id: "recent", label: "All Bills" },
            { id: "analyzed", label: "Analyzed" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: `3px ${spacing.sm}`,
                border: "none",
                borderRadius: spacing.radius.sm,
                backgroundColor: tab === t.id ? colors.white : "transparent",
                boxShadow: tab === t.id ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                color: tab === t.id ? colors.secondary[900] : colors.text.tertiary,
                fontSize: "11px",
                fontWeight: typography.fontWeight.medium,
                fontFamily: typography.fontFamily.body,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ maxHeight: "600px", overflowY: "auto" }}>
        {displayBills.map((bill, i) => {
          const normKey = `${bill.state}:${bill.bill_number.replace(/\s+/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2").toUpperCase()}`;
          const match = billToResearchId[normKey];
          const isClickable = !!match && !!onBillSelect;

          return (
          <div
            key={`${bill.state}-${bill.bill_number}-${i}`}
            onClick={isClickable ? () => onBillSelect(match.state, match.researchId) : undefined}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: spacing.sm,
              padding: `${spacing.sm} ${spacing.md}`,
              borderBottom: `1px solid ${colors.border.light}`,
              transition: "background-color 0.1s",
              cursor: isClickable ? "pointer" : "default",
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.gray[50]}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          >
            {/* State chip */}
            <button
              onClick={(e) => { e.stopPropagation(); onStateSelect?.(bill.state); }}
              style={{
                flexShrink: 0,
                padding: "2px 5px",
                borderRadius: "5px",
                border: `1px solid ${encodedStates.has(bill.state) ? colors.primary[200] : colors.gray[200]}`,
                backgroundColor: encodedStates.has(bill.state) ? colors.primary[50] : colors.gray[50],
                color: encodedStates.has(bill.state) ? colors.primary[700] : colors.gray[600],
                fontSize: "10px",
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.body,
                cursor: "pointer",
                minWidth: "28px",
                textAlign: "center",
              }}
            >
              {bill.state}
            </button>

            {/* Bill info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                {isClickable ? (
                  <span
                    style={{
                      color: colors.primary[600],
                      fontSize: "12px",
                      fontWeight: typography.fontWeight.semibold,
                      fontFamily: typography.fontFamily.body,
                      textDecoration: "none",
                    }}
                  >
                    {bill.bill_number}
                  </span>
                ) : (
                  <a
                    href={bill.legiscan_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      color: colors.secondary[900],
                      fontSize: "12px",
                      fontWeight: typography.fontWeight.semibold,
                      fontFamily: typography.fontFamily.body,
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = colors.primary[600]}
                    onMouseLeave={(e) => e.currentTarget.style.color = colors.secondary[900]}
                  >
                    {bill.bill_number}
                  </a>
                )}
                <StageBadge stage={bill.status || "Introduced"} />
                {isClickable && (
                  <span style={{
                    fontSize: "9px",
                    color: colors.primary[500],
                    fontFamily: typography.fontFamily.body,
                    fontWeight: typography.fontWeight.medium,
                  }}>
                    PE Analysis
                  </span>
                )}
              </div>
              <p style={{
                margin: "1px 0 0",
                color: colors.text.secondary,
                fontSize: "11px",
                fontFamily: typography.fontFamily.body,
                lineHeight: 1.3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {bill.title}
              </p>
            </div>

            <TimeAgo dateStr={bill.last_action_date} />
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ============== StateBillActivity (State page section) ==============

const STAGE_ORDER_LIST = [
  "Signed into Law",
  "Sent to Governor",
  "Passed Both Chambers",
  "Passed One Chamber",
  "Passed Committee",
  "Third Reading",
  "Second Reading",
  "First Reading",
  "In Committee",
  "Introduced",
];

function StageSummaryBar({ bills }) {
  const counts = {};
  for (const bill of bills) {
    const stage = bill.status || "Introduced";
    counts[stage] = (counts[stage] || 0) + 1;
  }

  const stages = STAGE_ORDER_LIST
    .filter((s) => counts[s])
    .map((s) => ({ stage: s, count: counts[s] }));

  // Catch any stages not in our ordered list
  for (const [stage, count] of Object.entries(counts)) {
    if (!STAGE_ORDER_LIST.includes(stage)) {
      stages.push({ stage, count });
    }
  }

  if (!stages.length) return null;

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      marginBottom: spacing.md,
    }}>
      {stages.map(({ stage, count }) => {
        const style = STAGE_COLORS[stage] || DEFAULT_STAGE_COLOR;
        return (
          <span key={stage} style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "10px",
            backgroundColor: style.bg,
            color: style.text,
            fontSize: "11px",
            fontWeight: typography.fontWeight.medium,
            fontFamily: typography.fontFamily.body,
          }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              backgroundColor: style.dot,
            }} />
            {count} {stage}
          </span>
        );
      })}
    </div>
  );
}

const DEFAULT_VISIBLE = 5;

export function StateBillActivity({ stateAbbr }) {
  const { bills, loading } = useProcessedBills(stateAbbr);
  const [expanded, setExpanded] = useState(false);

  if (loading || !bills.length) return null;

  const visibleBills = expanded ? bills : bills.slice(0, DEFAULT_VISIBLE);
  const hasMore = bills.length > DEFAULT_VISIBLE;

  return (
    <div>
      <h3 style={{
        margin: `0 0 ${spacing.md}`,
        color: colors.text.tertiary,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.primary,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}>
        Bills Being Tracked ({bills.length})
      </h3>

      {/* Stage summary */}
      <StageSummaryBar bills={bills} />

      {/* Bill list */}
      <div style={{
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        overflow: "hidden",
      }}>
        {visibleBills.map((bill, i) => (
          <div
            key={`${bill.bill_number}-${i}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: spacing.sm,
              padding: `${spacing.sm} ${spacing.md}`,
              borderBottom: i < visibleBills.length - 1 || hasMore ? `1px solid ${colors.border.light}` : "none",
              backgroundColor: colors.white,
              transition: "background-color 0.1s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.gray[50]}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = colors.white}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
                <a
                  href={bill.legiscan_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: colors.secondary[900],
                    fontSize: typography.fontSize.sm,
                    fontWeight: typography.fontWeight.semibold,
                    fontFamily: typography.fontFamily.body,
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = colors.primary[600]}
                  onMouseLeave={(e) => e.currentTarget.style.color = colors.secondary[900]}
                >
                  {bill.bill_number}
                </a>
                <StageBadge stage={bill.status || "Introduced"} />
              </div>
              <p style={{
                margin: "2px 0 0",
                color: colors.text.secondary,
                fontSize: typography.fontSize.xs,
                fontFamily: typography.fontFamily.body,
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {bill.title}
              </p>
            </div>
            <TimeAgo dateStr={bill.last_action_date} />
          </div>
        ))}

        {/* Show more / less toggle */}
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              width: "100%",
              padding: `${spacing.sm} ${spacing.md}`,
              border: "none",
              backgroundColor: colors.background.secondary,
              color: colors.primary[600],
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.medium,
              fontFamily: typography.fontFamily.body,
              cursor: "pointer",
              textAlign: "center",
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.gray[100]}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = colors.background.secondary}
          >
            {expanded ? "Show less" : `Show all ${bills.length} bills`}
          </button>
        )}
      </div>
    </div>
  );
}
