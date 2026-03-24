import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useData } from "../context/DataContext";
import { colors, typography, spacing } from "../designTokens";

const REQUEST_API_PATH = "/api/bill-analysis-request";
const MAILCHIMP_SUBSCRIBE_URL =
  "https://policyengine.us5.list-manage.com/subscribe/post-json?u=e5ad35332666289a0f48013c5&id=71ed1f89d8&f_id=00f173e6f0";

function subscribeToMailchimp(email) {
  return new Promise((resolve, reject) => {
    const callbackName = `mailchimpCallback_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (data) => {
      cleanup();
      if (data?.result !== "error") {
        resolve({ isSuccessful: true, message: data?.msg || "Subscribed." });
        return;
      }
      resolve({ isSuccessful: false, message: data?.msg || "Subscription failed." });
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("There was an issue processing your subscription; please try again later."));
    };

    const encodedEmail = encodeURIComponent(email);
    script.src = `${MAILCHIMP_SUBSCRIBE_URL}&EMAIL=${encodedEmail}&c=${callbackName}`;
    document.body.appendChild(script);
  });
}

// ============== Shared UI ==============

const STAGE_COLORS = {
  "Introduced": { bg: colors.gray[100], text: colors.gray[700], dot: colors.gray[400] },
  "In Committee": { bg: colors.primary[50], text: colors.primary[700], dot: colors.primary[400] },
  "Passed Committee": { bg: colors.primary[50], text: colors.primary[700], dot: colors.primary[500] },
  "First Reading": { bg: colors.primary[50], text: colors.primary[700], dot: colors.primary[400] },
  "Second Reading": { bg: colors.primary[50], text: colors.primary[700], dot: colors.primary[500] },
  "Third Reading": { bg: colors.primary[100], text: colors.primary[700], dot: colors.primary[500] },
  "Passed One Chamber": { bg: colors.primary[100], text: colors.primary[800], dot: colors.primary[600] },
  "Passed Both Chambers": { bg: colors.primary[200], text: colors.primary[800], dot: colors.primary[600] },
  "Sent to Governor": { bg: colors.primary[100], text: colors.primary[800], dot: colors.primary[700] },
  "Signed into Law": { bg: colors.primary[200], text: colors.primary[900], dot: colors.primary[700] },
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
  const [tab, setTab] = useState("analyzed"); // "recent" | "analyzed"
  const [actionBill, setActionBill] = useState(null);
  const [requestBill, setRequestBill] = useState(null);

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
    <>
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
        }}>
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
              { id: "analyzed", label: "Analyzed" },
              { id: "recent", label: "All Bills" },
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
            const showBillActions = tab === "recent";

            return (
            <div
              key={`${bill.state}-${bill.bill_number}-${i}`}
              onClick={() => {
                if (showBillActions && !isClickable) {
                  setActionBill({ ...bill, isAnalyzed: isClickable, analysisMatch: match || null });
                  return;
                }
                if (isClickable) onBillSelect(match.state, match.researchId);
              }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: spacing.sm,
                padding: `${spacing.sm} ${spacing.md}`,
                borderBottom: `1px solid ${colors.border.light}`,
                transition: "background-color 0.1s",
                cursor: showBillActions || isClickable ? "pointer" : "default",
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
                {tab === "recent" && !isClickable ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionBill({ ...bill, isAnalyzed: isClickable, analysisMatch: match || null });
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      color: colors.secondary[900],
                      fontSize: "12px",
                      fontWeight: typography.fontWeight.semibold,
                      fontFamily: typography.fontFamily.body,
                      cursor: "pointer",
                    }}
                  >
                    {bill.bill_number}
                  </button>
                ) : isClickable ? (
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
      {actionBill && (
        <BillActionModal
          bill={actionBill}
          onClose={() => setActionBill(null)}
          onViewAnalysis={() => {
            if (actionBill.analysisMatch && onBillSelect) {
              onBillSelect(actionBill.analysisMatch.state, actionBill.analysisMatch.researchId);
            }
            setActionBill(null);
          }}
          onRequestAnalysis={() => {
            setRequestBill(actionBill);
            setActionBill(null);
          }}
        />
      )}
      {requestBill && (
        <AnalysisRequestModal
          bill={requestBill}
          onClose={() => setRequestBill(null)}
        />
      )}
    </>
  );
}

function BillActionModal({ bill, onClose, onViewAnalysis, onRequestAnalysis }) {
  return (
    <ModalFrame title={`${bill.state} ${bill.bill_number}`} onClose={onClose}>
      <p style={{
        margin: `0 0 ${spacing.md}`,
        color: colors.text.secondary,
        fontSize: typography.fontSize.sm,
        fontFamily: typography.fontFamily.body,
        lineHeight: 1.5,
      }}>
        {bill.title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        <a
          href={bill.legiscan_url}
          target="_blank"
          rel="noopener noreferrer"
          style={primaryActionStyle}
        >
          View Bill Text
        </a>
        {bill.isAnalyzed ? (
          <button type="button" onClick={onViewAnalysis} style={secondaryActionStyle}>
            View PolicyEngine Analysis
          </button>
        ) : (
          <button type="button" onClick={onRequestAnalysis} style={secondaryActionStyle}>
            Request Analysis
          </button>
        )}
      </div>
    </ModalFrame>
  );
}

function AnalysisRequestModal({ bill, onClose }) {
  const [email, setEmail] = useState("");
  const [subscribeNewsletter, setSubscribeNewsletter] = useState(true);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus({ type: "idle", message: "" });

    try {
      let newsletterMessage = "";
      if (subscribeNewsletter) {
        const newsletterResult = await subscribeToMailchimp(email);
        if (!newsletterResult.isSuccessful && !/is already subscribed/i.test(newsletterResult.message)) {
          throw new Error(newsletterResult.message);
        }
        newsletterMessage = newsletterResult.message;
      }

      const response = await fetch(REQUEST_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: bill.state,
          bill_number: bill.bill_number,
          title: bill.title,
          bill_url: bill.legiscan_url,
          requester_email: email,
          subscribe_newsletter: subscribeNewsletter,
          request_source: "recent_activity_all_bills",
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "Could not submit request.");
      }

      setStatus({
        type: "success",
        message: "Request received. We’ll notify you when analysis is available for this bill.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: error.message || "Could not submit request.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title={`Request analysis for ${bill.state} ${bill.bill_number}`} onClose={onClose}>
      <p style={{
        margin: `0 0 ${spacing.lg}`,
        color: colors.text.secondary,
        fontSize: typography.fontSize.sm,
        fontFamily: typography.fontFamily.body,
        lineHeight: 1.5,
      }}>
        Enter your email and we’ll log the request for scoring. If you opt in, we’ll also add you to the newsletter.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
        <label style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
          <span style={fieldLabelStyle}>Email address</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.org"
            style={fieldInputStyle}
          />
        </label>
        <label style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          color: colors.text.secondary,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          cursor: "pointer",
        }}>
          <input
            type="checkbox"
            checked={subscribeNewsletter}
            onChange={(e) => setSubscribeNewsletter(e.target.checked)}
            style={{ margin: 0, accentColor: colors.primary[600], flexShrink: 0 }}
          />
          <span>Get notified when analysis is added for this bill, and receive related PolicyEngine updates.</span>
        </label>
        {status.message && (
          <div style={{
            padding: spacing.sm,
            borderRadius: spacing.radius.md,
            backgroundColor: status.type === "success" ? colors.green[50] : colors.red[50],
            color: status.type === "success" ? colors.green[700] : colors.red[700],
            fontSize: typography.fontSize.xs,
            fontFamily: typography.fontFamily.body,
          }}>
            {status.message}
          </div>
        )}
        <div style={{ display: "flex", gap: spacing.sm, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={tertiaryActionStyle}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} style={secondaryActionStyle}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function ModalFrame({ title, children, onClose }) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(15, 23, 42, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
      zIndex: 100,
    }}>
      <div style={{
        width: "100%",
        maxWidth: "460px",
        backgroundColor: colors.white,
        borderRadius: spacing.radius["2xl"],
        boxShadow: "var(--shadow-elevation-medium)",
        border: `1px solid ${colors.border.light}`,
        padding: spacing.xl,
      }}>
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: spacing.md,
          marginBottom: spacing.md,
        }}>
          <h3 style={{
            margin: 0,
            color: colors.secondary[900],
            fontSize: typography.fontSize.base,
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
            lineHeight: 1.3,
          }}>
            {title}
          </h3>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const fieldLabelStyle = {
  color: colors.text.secondary,
  fontSize: typography.fontSize.xs,
  fontWeight: typography.fontWeight.medium,
  fontFamily: typography.fontFamily.body,
};

const fieldInputStyle = {
  width: "100%",
  padding: `${spacing.sm} ${spacing.md}`,
  borderRadius: spacing.radius.lg,
  border: `1px solid ${colors.border.light}`,
  backgroundColor: colors.white,
  fontSize: typography.fontSize.sm,
  fontFamily: typography.fontFamily.body,
  color: colors.secondary[900],
  outline: "none",
};

const primaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: `${spacing.sm} ${spacing.md}`,
  borderRadius: spacing.radius.lg,
  border: "none",
  backgroundColor: colors.primary[600],
  color: colors.white,
  textDecoration: "none",
  fontSize: typography.fontSize.sm,
  fontWeight: typography.fontWeight.semibold,
  fontFamily: typography.fontFamily.body,
  cursor: "pointer",
};

const secondaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: `${spacing.sm} ${spacing.md}`,
  borderRadius: spacing.radius.lg,
  border: `1px solid ${colors.border.light}`,
  backgroundColor: colors.white,
  color: colors.secondary[900],
  fontSize: typography.fontSize.sm,
  fontWeight: typography.fontWeight.semibold,
  fontFamily: typography.fontFamily.body,
  cursor: "pointer",
};

const tertiaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: `${spacing.sm} ${spacing.md}`,
  borderRadius: spacing.radius.lg,
  border: "none",
  backgroundColor: "transparent",
  color: colors.text.secondary,
  fontSize: typography.fontSize.sm,
  fontWeight: typography.fontWeight.medium,
  fontFamily: typography.fontFamily.body,
  cursor: "pointer",
};

const closeButtonStyle = {
  border: "none",
  background: "transparent",
  color: colors.text.tertiary,
  fontSize: "24px",
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

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
