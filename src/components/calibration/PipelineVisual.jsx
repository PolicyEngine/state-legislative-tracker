import { useState, useEffect, useRef } from "react";
import { colors, typography, spacing } from "../../designTokens";

function useInView(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true); },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return visible;
}

function Connector({ dashed }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
      <div style={{
        width: 2, height: 28,
        background: dashed ? "transparent" : colors.gray[300],
        borderLeft: dashed ? `2px dashed ${colors.gray[300]}` : "none",
      }} />
    </div>
  );
}

function Arrow() {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: -4 }}>
      <div style={{
        width: 0, height: 0,
        borderLeft: "6px solid transparent",
        borderRight: "6px solid transparent",
        borderTop: `8px solid ${colors.gray[300]}`,
      }} />
    </div>
  );
}

function StageCard({ number, numberBg, title, badge, badgeBg, badgeColor, accent, children, delay = 0 }) {
  const ref = useRef(null);
  const visible = useInView(ref);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.5s ${delay}ms, transform 0.5s ${delay}ms`,
      }}
    >
      <div style={{
        background: colors.white,
        borderRadius: 16,
        border: `1px solid ${accent || colors.border.light}`,
        borderLeft: accent ? `4px solid ${accent}` : `1px solid ${colors.border.light}`,
        padding: "24px 28px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: numberBg || colors.primary[600],
            color: colors.white,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14,
            fontFamily: typography.fontFamily.mono,
            flexShrink: 0,
          }}>{number}</div>
          <span style={{
            fontSize: 17, fontWeight: 700,
            fontFamily: typography.fontFamily.primary,
            color: colors.text.primary,
          }}>{title}</span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              padding: "3px 10px", borderRadius: 20,
              background: badgeBg || colors.gray[100],
              color: badgeColor || colors.gray[600],
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}>{badge}</span>
          )}
        </div>
        <div style={{
          fontSize: 14, color: colors.text.secondary,
          lineHeight: 1.7,
          fontFamily: typography.fontFamily.body,
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FlowGrid({ children, cols = 2 }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 10,
      marginTop: 14,
    }}>
      {children}
    </div>
  );
}

function FlowBox({ label, labelColor, children }) {
  return (
    <div style={{
      background: colors.gray[50],
      border: `1px solid ${colors.border.light}`,
      borderRadius: 10,
      padding: "10px 14px",
      fontSize: 13,
      color: colors.text.secondary,
      lineHeight: 1.5,
    }}>
      {label && (
        <div style={{
          fontSize: 11, fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: labelColor || colors.primary[600],
          marginBottom: 3,
        }}>{label}</div>
      )}
      {children}
    </div>
  );
}

function DataPipeline() {
  const stages = [
    { label: "Raw CPS", detail: "Census survey", color: "#f59e0b" },
    { label: "Imputation", detail: "QRF + PUF", color: "#f59e0b" },
    { label: "Uprating", detail: "Growth factors", color: "#f59e0b" },
    { label: "Reweighting", detail: "~500 targets", color: "#f59e0b" },
  ];
  return (
    <div style={{
      display: "flex", gap: 0, marginTop: 14,
      borderRadius: 10, overflow: "hidden",
      border: `1px solid #fbbf24`,
    }}>
      {stages.map((s, i) => (
        <div key={i} style={{
          flex: 1, padding: "10px 8px", textAlign: "center",
          background: "#fffbeb",
          borderRight: i < stages.length - 1 ? "1px solid #fbbf24" : "none",
          position: "relative",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            {s.label}
          </div>
          <div style={{ fontSize: 11, color: "#a16207", marginTop: 2 }}>{s.detail}</div>
          {i < stages.length - 1 && (
            <div style={{
              position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
              width: 0, height: 0,
              borderTop: "6px solid transparent",
              borderBottom: "6px solid transparent",
              borderLeft: "8px solid #fbbf24",
              zIndex: 1,
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function Warning({ children }) {
  return (
    <div style={{
      background: "#fffbeb",
      borderLeft: `3px solid #f59e0b`,
      padding: "8px 14px",
      fontSize: 12, color: "#92400e",
      borderRadius: "0 8px 8px 0",
      marginTop: 10,
      lineHeight: 1.5,
    }}>{children}</div>
  );
}

function Critical({ children }) {
  return (
    <div style={{
      background: "#fef2f2",
      borderLeft: `3px solid ${colors.red[500]}`,
      padding: "8px 14px",
      fontSize: 12, color: "#991b1b",
      borderRadius: "0 8px 8px 0",
      marginTop: 10,
      fontWeight: 500,
      lineHeight: 1.5,
    }}>{children}</div>
  );
}

function Diamond({ children }) {
  const ref = useRef(null);
  const visible = useInView(ref);
  return (
    <div ref={ref} style={{
      display: "flex", justifyContent: "center", padding: "6px 0",
      opacity: visible ? 1 : 0,
      transition: "opacity 0.4s",
    }}>
      <div style={{
        background: colors.white,
        border: `2px solid ${colors.primary[600]}`,
        borderRadius: 12,
        padding: "14px 32px",
        fontSize: 15, fontWeight: 700,
        color: colors.primary[700],
        textAlign: "center",
        boxShadow: "0 2px 8px rgba(44,122,123,0.12)",
      }}>{children}</div>
    </div>
  );
}

function BranchGrid({ children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
      marginTop: 8,
    }}>
      {children}
    </div>
  );
}

function BranchLabel({ color, children }) {
  return (
    <div style={{
      textAlign: "center",
      fontSize: 12, fontWeight: 700,
      color,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      marginBottom: 10,
    }}>{children}</div>
  );
}

function CodeBlock({ children }) {
  return (
    <div style={{
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      background: colors.gray[50],
      border: `1px solid ${colors.border.light}`,
      padding: "10px 14px",
      borderRadius: 8,
      color: colors.secondary[700],
      lineHeight: 1.6,
      marginTop: 10,
      overflowX: "auto",
    }}>{children}</div>
  );
}

export default function PipelineVisual() {
  return (
    <div style={{
      maxWidth: 880,
      margin: "0 auto",
      padding: `${spacing["3xl"]} ${spacing["2xl"]} 80px`,
      fontFamily: typography.fontFamily.body,
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{
          fontSize: 32, fontWeight: 800,
          fontFamily: typography.fontFamily.primary,
          color: colors.text.primary,
          lineHeight: 1.2,
          margin: 0,
        }}>
          Bill to Impact
        </h1>
        <p style={{
          fontSize: 16, color: colors.text.secondary,
          marginTop: 10, maxWidth: 520, marginLeft: "auto", marginRight: "auto",
          lineHeight: 1.6,
        }}>
          How PolicyEngine goes from a state tax bill to a published
          microsimulation estimate &mdash; with every gap explained.
        </p>
      </div>

      {/* Stage 1 */}
      <StageCard number="1" title="Bill Discovery & Triage" badge="Automated" badgeBg="#dcfce7" badgeColor="#15803d" delay={0}>
        OpenStates API surfaces bills matching tax/benefit keywords.
        Each scored 0&ndash;100 for PE modelability.
        <FlowGrid>
          <FlowBox label="Parametric (80-100)">Changes existing parameter values only</FlowBox>
          <FlowBox label="Structural (50-79)">New brackets, new credits, restructured programs</FlowBox>
        </FlowGrid>
      </StageCard>

      <Connector /><Arrow />

      {/* Stage 2 */}
      <StageCard number="2" title="Bill Research" badge="Parallel Agents" badgeBg={colors.primary[50]} badgeColor={colors.primary[700]} delay={50}>
        Two agents run simultaneously:
        <FlowGrid>
          <FlowBox label="Bill Researcher" labelColor={colors.primary[600]}>
            Fetch bill text, extract provisions with exact values and bill section references
          </FlowBox>
          <FlowBox label="Fiscal Finder" labelColor={colors.primary[600]}>
            Find fiscal notes, think tank analyses, back-of-envelope calculations
          </FlowBox>
        </FlowGrid>
      </StageCard>

      <Connector /><Arrow />

      {/* Stage 3 */}
      <StageCard number="3" title="Parameter Mapping" delay={100}>
        Map bill provisions to PolicyEngine parameter paths.
        <CodeBlock>
          {`"gov.states.ga...brackets[0].rate": {"2026-01-01.2100-12-31": 0.0499}`}
        </CodeBlock>
      </StageCard>

      <Connector /><Arrow />

      {/* Layer 1 */}
      <StageCard
        number="L1" numberBg={colors.primary[700]}
        title="Encoding Validation"
        badge="Iterative" badgeBg={colors.primary[50]} badgeColor={colors.primary[700]}
        accent={colors.primary[600]}
        delay={150}
      >
        Autonomous agent verifies <code style={{ fontFamily: typography.fontFamily.mono, fontSize: 12, background: colors.gray[100], padding: "1px 5px", borderRadius: 3 }}>reform_params</code> correctly encodes the bill. Fixes structural errors only.
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["Parameter paths exist?", "Period ranges correct?", "All filing statuses?", "All provisions encoded?", "Values match bill text?"].map(c => (
              <span key={c} style={{
                fontSize: 12, padding: "4px 10px",
                background: colors.primary[50],
                border: `1px solid ${colors.primary[200]}`,
                borderRadius: 20, color: colors.primary[700],
                fontWeight: 500,
              }}>{c}</span>
            ))}
          </div>
        </div>
        <Critical>
          Bill values are IMMUTABLE. Never change 4.99% to match a fiscal note.
          Fix paths, periods, and structure only.
        </Critical>
      </StageCard>

      <Connector /><Arrow />

      {/* Stage 4 */}
      <StageCard number="4" title="Microsimulation" badge="~40 seconds" badgeBg={colors.gray[100]} badgeColor={colors.gray[600]} delay={200}>
        Run baseline + reform simulations on state-specific PE-US dataset.
        <DataPipeline />
        <Warning>
          State income is NOT directly calibrated. Only state population counts are targeted.
        </Warning>
      </StageCard>

      <Connector /><Arrow />

      {/* Stage 5 */}
      <StageCard
        number="5" numberBg={colors.primary[700]}
        title="Validation Harness"
        badge="Multi-Strategy" badgeBg={colors.primary[50]} badgeColor={colors.primary[700]}
        accent={colors.primary[600]}
        delay={250}
      >
        Build a target estimate from independent sources. Apply learned correction factors.
        <FlowGrid cols={3}>
          <FlowBox label="Fiscal Note">Official state estimate. HIGH confidence.</FlowBox>
          <FlowBox label="Revenue-Base">Revenue x rate change. MEDIUM confidence.</FlowBox>
          <FlowBox label="Back-of-Envelope">Manual arithmetic. MED-LOW confidence.</FlowBox>
        </FlowGrid>
        <div style={{
          textAlign: "center", marginTop: 16,
          fontSize: 15, fontWeight: 700,
          color: colors.primary[700],
        }}>
          Triangulate &rarr; Target: -$778M &plusmn;15%
        </div>
      </StageCard>

      <Connector /><Arrow />

      {/* Decision */}
      <Diamond>PE estimate within tolerance?</Diamond>

      {/* Branch */}
      <BranchGrid>
        <div>
          <BranchLabel color={colors.green[600]}>&#10003; Within tolerance</BranchLabel>
          <StageCard number="&#10003;" numberBg={colors.green[600]} title="Publish" delay={300}>
            Create PR with provisions, comparison table, data quality context.
            Merge triggers status &rarr; published.
          </StageCard>
        </div>
        <div>
          <BranchLabel color={colors.blue[600]}>&#10007; Gap exceeds tolerance</BranchLabel>
          <StageCard
            number="L2" numberBg={colors.blue[600]}
            title="Data Diagnostic"
            badge="Reform-Specific" badgeBg={colors.blue[50]} badgeColor={colors.blue[700]}
            accent={colors.blue[500]}
            delay={350}
          >
            Checks driven by reform type:
            <FlowGrid>
              <FlowBox label="Rate Cut" labelColor={colors.blue[600]}>AGI, effective rate, top decile</FlowBox>
              <FlowBox label="EITC" labelColor={colors.blue[600]}>Earned income, children, bottom decile</FlowBox>
              <FlowBox label="CTC" labelColor={colors.blue[600]}>Child population, income phase-out</FlowBox>
              <FlowBox label="Deduction" labelColor={colors.blue[600]}>Itemizer ratio, median income</FlowBox>
            </FlowGrid>
            <div style={{ fontSize: 12, marginTop: 10, color: colors.text.tertiary }}>
              Findings cached durably &mdash; reused by future reforms in the same state.
            </div>
          </StageCard>
        </div>
      </BranchGrid>

      <Connector /><Arrow />

      {/* Diagnosis */}
      <StageCard number="6" title="Diagnosis & Documentation" delay={400}>
        Every gap is explained, not eliminated. Written to DB and included in PR body.
        <CodeBlock>
          encoding_correct: true<br />
          gap: 35.7% (PE: -$500M vs fiscal note: -$778M)<br />
          root_cause: &quot;PE 2026 baseline is 5.09% (HB1015 pre-scheduled)&quot;<br />
          data_quality_score: +0.19 (PE runs 19% higher for GA)
        </CodeBlock>
        <div style={{
          textAlign: "center", marginTop: 14,
          fontSize: 14, fontWeight: 700, color: colors.green[600],
        }}>
          &rarr; Publish with documented explanation
        </div>
      </StageCard>

      <Connector /><Arrow />

      {/* Outer loop */}
      <StageCard
        number="&#x21bb;" numberBg={colors.primary[700]}
        title="Cross-Bill Learning"
        badge="Outer Loop" badgeBg={colors.primary[50]} badgeColor={colors.primary[700]}
        accent={colors.primary[600]}
        delay={450}
      >
        After N bills: detect state biases, calibrate strategy accuracy, build state data profiles.
        Each bill makes the next faster and more accurate.
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginTop: 14, padding: "10px 16px",
          background: colors.primary[50],
          border: `1px dashed ${colors.primary[300]}`,
          borderRadius: 10,
          fontSize: 13, color: colors.primary[700], fontWeight: 500,
        }}>
          <span style={{ fontSize: 20 }}>&#x21bb;</span>
          Correction factors + past diagnoses fed back to harness for next bill
        </div>
      </StageCard>

      <Connector dashed /><Arrow />

      {/* Future */}
      <StageCard
        number="F" numberBg={colors.gray[400]}
        title="US-Data Improvement Cycle"
        badge="Future" badgeBg={colors.gray[100]} badgeColor={colors.gray[500]}
        delay={500}
      >
        When findings reveal persistent data gaps, propose changes to policyengine-us-data.
        <div style={{
          display: "flex", gap: 0, marginTop: 14,
          borderRadius: 10, overflow: "hidden",
          border: `1px solid ${colors.gray[300]}`,
        }}>
          {[
            { label: "Uprating", detail: "State-specific", risk: "LOW", riskColor: colors.green[600] },
            { label: "Reweighting", detail: "State targets", risk: "MEDIUM", riskColor: "#f59e0b" },
            { label: "Imputation", detail: "Regional QRF", risk: "HIGH", riskColor: colors.red[500] },
          ].map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: "10px 12px", textAlign: "center",
              background: colors.gray[50],
              borderRight: i < 2 ? `1px solid ${colors.gray[300]}` : "none",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text.primary, textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontSize: 11, color: colors.text.secondary, marginTop: 2 }}>{s.detail}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: s.riskColor, marginTop: 4 }}>{s.risk} RISK</div>
            </div>
          ))}
        </div>
        <Warning>
          Every change must pass: target state improved AND no other state or national target degraded &gt;5%.
          Requires regression harness testing all ~500 calibration targets.
        </Warning>
      </StageCard>

      {/* Legend */}
      <div style={{
        display: "flex", gap: 24, justifyContent: "center",
        marginTop: 48, paddingTop: 24,
        borderTop: `1px solid ${colors.border.light}`,
        flexWrap: "wrap",
      }}>
        {[
          { color: colors.primary[600], label: "Validation layer" },
          { color: colors.blue[500], label: "Data diagnostic" },
          { color: colors.gray[400], label: "Future (not yet built)", dashed: true },
          { color: "#fbbf24", label: "PE-US data pipeline" },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.text.tertiary }}>
            <div style={{
              width: 14, height: 14, borderRadius: 4,
              background: l.dashed ? "transparent" : `${l.color}20`,
              border: l.dashed ? `2px dashed ${l.color}` : `2px solid ${l.color}`,
            }} />
            {l.label}
          </div>
        ))}
      </div>

      <div style={{
        textAlign: "center", marginTop: 24,
        fontSize: 12, color: colors.text.tertiary,
      }}>
        PolicyEngine State Legislative Tracker &middot; Inspired by{" "}
        <a href="https://github.com/karpathy/autoresearch" style={{ color: colors.primary[600] }}>autoresearch</a>
      </div>
    </div>
  );
}
