import { useState, useEffect, useRef } from "react";
import { colors, typography, spacing } from "../../designTokens";

// Icons as inline SVG
const Icons = {
  search: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  file: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  code: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  cpu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  ),
  target: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  alert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  database: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  refresh: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  ),
  lock: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
};

function useInView(ref) {
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) setV(true); }, { threshold: 0.1 });
    o.observe(el);
    return () => o.disconnect();
  }, [ref]);
  return v;
}

// A single node in the diagram
function Node({ icon, label, sublabel, color = colors.primary[600], bg, detail, delay = 0, small, badge }) {
  const ref = useRef(null);
  const vis = useInView(ref);
  const [open, setOpen] = useState(false);

  return (
    <div
      ref={ref}
      onClick={() => detail && setOpen(!open)}
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? "translateY(0)" : "translateY(16px)",
        transition: `all 0.45s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
        cursor: detail ? "pointer" : "default",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        background: bg || colors.white,
        border: `1.5px solid ${color}22`,
        borderRadius: 14,
        padding: small ? "12px 18px" : "16px 22px",
        boxShadow: `0 1px 3px ${color}08, 0 1px 2px rgba(0,0,0,0.03)`,
        transition: "box-shadow 0.2s, border-color 0.2s",
        ...(detail && { ":hover": { borderColor: color } }),
      }}>
        <div style={{
          width: small ? 36 : 42, height: small ? 36 : 42,
          borderRadius: 12, background: `${color}12`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color, flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: small ? 13 : 15, fontWeight: 650,
            color: colors.text.primary,
            fontFamily: typography.fontFamily.primary,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {label}
            {badge && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                padding: "2px 8px", borderRadius: 20,
                background: `${color}12`, color,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>{badge}</span>
            )}
          </div>
          {sublabel && (
            <div style={{
              fontSize: 12, color: colors.text.tertiary,
              marginTop: 2, lineHeight: 1.4,
            }}>{sublabel}</div>
          )}
        </div>
        {detail && (
          <div style={{
            color: colors.gray[400], fontSize: 12,
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.2s",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        )}
      </div>
      {open && detail && (
        <div style={{
          margin: "6px 0 0 56px",
          padding: "12px 16px",
          background: colors.gray[50],
          borderRadius: 10,
          fontSize: 13, color: colors.text.secondary,
          lineHeight: 1.7,
          borderLeft: `2px solid ${color}30`,
        }}>
          {detail}
        </div>
      )}
    </div>
  );
}

// Vertical connector line
function Line({ height = 32, dashed, color: c }) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{
        width: 0, height,
        borderLeft: `1.5px ${dashed ? "dashed" : "solid"} ${c || colors.gray[300]}`,
      }} />
    </div>
  );
}

// Parallel split
function Parallel({ children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${children.length}, 1fr)`,
      gap: 12,
    }}>
      {children}
    </div>
  );
}

// Section label
function SectionLabel({ children, color }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      color: color || colors.text.tertiary,
      textAlign: "center",
      padding: "4px 0",
    }}>{children}</div>
  );
}

// Decision diamond
function Decision({ children, delay = 0 }) {
  const ref = useRef(null);
  const vis = useInView(ref);
  return (
    <div ref={ref} style={{
      display: "flex", justifyContent: "center", padding: "4px 0",
      opacity: vis ? 1 : 0,
      transition: `opacity 0.4s ${delay}ms`,
    }}>
      <div style={{
        background: colors.white,
        border: `2px solid ${colors.primary[500]}`,
        borderRadius: 12, padding: "10px 28px",
        fontSize: 14, fontWeight: 700,
        color: colors.primary[700],
        boxShadow: `0 2px 12px ${colors.primary[500]}15`,
      }}>{children}</div>
    </div>
  );
}

// Branch outcome
function BranchOutcome({ color, label, icon, children }) {
  return (
    <div>
      <div style={{
        textAlign: "center", fontSize: 11, fontWeight: 700,
        color, textTransform: "uppercase",
        letterSpacing: "0.06em", marginBottom: 8,
      }}>{label}</div>
      {children}
    </div>
  );
}

// Data pipeline mini-diagram
function DataPipeline() {
  const steps = ["Raw CPS", "Imputation", "Uprating", "Reweighting"];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      background: "#fffbeb", borderRadius: 8,
      border: "1px solid #fcd34d",
      overflow: "hidden", margin: "8px 0",
    }}>
      {steps.map((s, i) => (
        <div key={s} style={{
          flex: 1, textAlign: "center", padding: "6px 4px",
          fontSize: 10, fontWeight: 600, color: "#92400e",
          borderRight: i < steps.length - 1 ? "1px solid #fcd34d" : "none",
          textTransform: "uppercase", letterSpacing: "0.03em",
        }}>
          {s}
          {i < steps.length - 1 && (
            <span style={{ position: "absolute" }}></span>
          )}
        </div>
      ))}
    </div>
  );
}

// Callout
function Callout({ type, children }) {
  const styles = {
    warning: { bg: "#fffbeb", border: "#f59e0b", color: "#92400e" },
    critical: { bg: "#fef2f2", border: "#ef4444", color: "#991b1b" },
    info: { bg: colors.primary[50], border: colors.primary[400], color: colors.primary[800] },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{
      background: s.bg, borderLeft: `3px solid ${s.border}`,
      padding: "6px 12px", borderRadius: "0 6px 6px 0",
      fontSize: 11, color: s.color, lineHeight: 1.5, marginTop: 6,
    }}>{children}</div>
  );
}

export default function PipelineVisual() {
  return (
    <div style={{
      maxWidth: 640,
      margin: "0 auto",
      padding: "48px 24px 80px",
      fontFamily: typography.fontFamily.body,
    }}>
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <a href="https://policyengine.org" target="_blank" rel="noopener noreferrer">
            <img src="/policyengine-favicon.svg" alt="PolicyEngine" style={{ height: 36 }} />
          </a>
        </div>
        <h1 style={{
          fontSize: 26, fontWeight: 800,
          fontFamily: typography.fontFamily.primary,
          color: colors.text.primary,
          margin: 0, letterSpacing: "-0.02em",
        }}>
          Reform Scoring Pipeline
        </h1>
        <p style={{
          fontSize: 14, color: colors.text.tertiary,
          marginTop: 6, lineHeight: 1.5,
        }}>
          From state tax bill to published impact estimate.
          <br />Click any step to see details.
        </p>
      </div>

      {/* 1. Discovery */}
      <Node
        icon={Icons.search}
        label="Bill Discovery & Triage"
        sublabel="OpenStates API + modelability scoring (0-100)"
        badge="Auto"
        delay={0}
        detail={
          <div>
            <strong>Parametric (80-100):</strong> Changes existing parameter values only (rate cut, threshold adjust).
            <br /><strong>Structural (50-79):</strong> New brackets, new credits, restructured programs.
            <br /><strong>Not modelable (&lt;20):</strong> Occupation-specific, administrative, out of scope.
          </div>
        }
      />

      <Line />

      {/* 2. Research */}
      <SectionLabel>Parallel agents</SectionLabel>
      <Parallel>
        <Node
          icon={Icons.file}
          label="Bill Researcher"
          sublabel="Provisions, sections, effective dates"
          small
          delay={80}
          detail={<div>Fetches bill text (HTML or PDF). Extracts specific numeric changes with bill section references. Records multi-year schedules and sunset provisions.</div>}
        />
        <Node
          icon={Icons.target}
          label="Fiscal Finder"
          sublabel="Fiscal notes, think tanks, envelope math"
          color={colors.blue[600]}
          small
          delay={120}
          detail={<div>5 strategies: official fiscal note, revenue-base reasoning, tax expenditure reports, similar/companion bills, back-of-envelope calculation. Always documents what was searched.</div>}
        />
      </Parallel>

      <Line />

      {/* 3. Param mapping */}
      <Node
        icon={Icons.code}
        label="Parameter Mapping"
        sublabel="Bill provisions mapped to PE parameter paths"
        delay={160}
        detail={
          <div>
            <code style={{ fontFamily: typography.fontFamily.mono, fontSize: 11, background: colors.gray[100], padding: "2px 6px", borderRadius: 4 }}>
              gov.states.ga...brackets[0].rate: 0.0499
            </code>
            <div style={{ marginTop: 6 }}>
              Validates paths exist in PE-US. Checks bracket indices, filing status coverage, period ranges.
            </div>
          </div>
        }
      />

      <Line color={colors.primary[400]} />
      <SectionLabel color={colors.primary[600]}>Validation layer</SectionLabel>

      {/* L1 */}
      <Node
        icon={Icons.shield}
        label="Encoding Validation"
        sublabel="Verify reform_params correctly encodes the bill"
        color={colors.primary[700]}
        bg={`${colors.primary[600]}06`}
        badge="Iterative"
        delay={200}
        detail={
          <div>
            Autonomous agent checks structure — NOT values:
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {["Paths exist?", "Periods correct?", "Filing statuses?", "All provisions?", "Values match bill?"].map(c => (
                <span key={c} style={{
                  fontSize: 11, padding: "2px 8px",
                  background: `${colors.primary[600]}10`,
                  borderRadius: 12, color: colors.primary[700],
                  fontWeight: 500,
                }}>{c}</span>
              ))}
            </div>
            <Callout type="critical">Bill values are immutable. Never change 4.99% to match a fiscal note.</Callout>
          </div>
        }
      />

      <Line />

      {/* 4. Compute */}
      <Node
        icon={Icons.cpu}
        label="Microsimulation"
        sublabel="Baseline + reform on state PE-US dataset"
        badge="~40s"
        delay={250}
        detail={
          <div>
            <DataPipeline />
            <Callout type="warning">State income is NOT directly calibrated — only population counts are targeted.</Callout>
            <div style={{ marginTop: 6 }}>
              Outputs: revenue impact, poverty change, winners/losers, decile distribution, district-level impacts.
            </div>
          </div>
        }
      />

      <Line color={colors.primary[400]} />

      {/* 5. Harness */}
      <Node
        icon={Icons.target}
        label="Validation Harness"
        sublabel="Build target from multiple independent estimates"
        color={colors.primary[700]}
        bg={`${colors.primary[600]}06`}
        badge="Multi-strategy"
        delay={300}
        detail={
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, margin: "6px 0" }}>
              {[
                { l: "Fiscal Note", c: "HIGH" },
                { l: "Revenue-Base", c: "MEDIUM" },
                { l: "Envelope", c: "MED-LOW" },
              ].map(s => (
                <div key={s.l} style={{
                  textAlign: "center", padding: "6px 4px",
                  background: colors.gray[50], borderRadius: 6,
                  fontSize: 11, border: `1px solid ${colors.border.light}`,
                }}>
                  <div style={{ fontWeight: 600 }}>{s.l}</div>
                  <div style={{ color: colors.text.tertiary, fontSize: 10 }}>{s.c}</div>
                </div>
              ))}
            </div>
            Triangulates into target with confidence-based tolerance. Applies learned correction factors from past bills.
          </div>
        }
      />

      <Line />

      {/* Decision */}
      <Decision delay={350}>PE estimate within tolerance?</Decision>

      <Line height={16} />

      {/* Branch */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <BranchOutcome color={colors.green[600]} label="Within tolerance">
          <Node
            icon={Icons.check}
            label="Publish"
            sublabel="PR with provisions & comparison"
            color={colors.green[600]}
            small
            delay={400}
          />
        </BranchOutcome>
        <BranchOutcome color={colors.blue[600]} label="Gap exceeds tolerance">
          <Node
            icon={Icons.database}
            label="Data Diagnostic"
            sublabel="Reform-specific variable checks"
            color={colors.blue[600]}
            bg={`${colors.blue[500]}06`}
            badge="Cached"
            small
            delay={440}
            detail={
              <div>
                Checks driven by reform type:
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
                  {[
                    { t: "Rate cut", d: "AGI, top decile" },
                    { t: "EITC", d: "Earned income, children" },
                    { t: "CTC", d: "Child pop, phase-out" },
                    { t: "Deduction", d: "Itemizers, median" },
                  ].map(r => (
                    <div key={r.t} style={{
                      fontSize: 10, padding: "3px 6px",
                      background: `${colors.blue[500]}08`,
                      borderRadius: 4,
                    }}>
                      <span style={{ fontWeight: 600 }}>{r.t}:</span> {r.d}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: colors.text.tertiary }}>
                  Findings stored in <code style={{ fontFamily: typography.fontFamily.mono, fontSize: 10 }}>data_findings</code> — reused across reforms.
                </div>
              </div>
            }
          />
        </BranchOutcome>
      </div>

      <Line />

      {/* Diagnosis */}
      <Node
        icon={Icons.alert}
        label="Diagnosis & Documentation"
        sublabel="Gap explained, not eliminated — written to DB"
        delay={480}
        detail={
          <div>
            <code style={{
              fontFamily: typography.fontFamily.mono, fontSize: 11,
              display: "block", background: colors.gray[50],
              padding: "8px 10px", borderRadius: 6, lineHeight: 1.6,
              border: `1px solid ${colors.border.light}`,
            }}>
              encoding_correct: true<br/>
              gap: 35.7% (PE: -$500M vs note: -$778M)<br/>
              root_cause: "PE baseline 5.09% vs fiscal note 5.19%"<br/>
              data_quality: +19% (PE higher for GA)
            </code>
            <div style={{ marginTop: 6, textAlign: "center", fontWeight: 600, fontSize: 12, color: colors.green[600] }}>
              Publish with documented explanation
            </div>
          </div>
        }
      />

      <Line color={colors.primary[400]} />
      <SectionLabel color={colors.primary[600]}>Feedback loop</SectionLabel>

      {/* Outer loop */}
      <Node
        icon={Icons.refresh}
        label="Cross-Bill Learning"
        sublabel="State biases, strategy accuracy, correction factors"
        color={colors.primary[700]}
        bg={`${colors.primary[600]}06`}
        badge="Outer loop"
        delay={520}
        detail={
          <div>
            After N bills: detect state-level biases (MD always -15%), calibrate harness strategies (revenue-base overestimates by 9%), build state data profiles. Version tracking across PE-US updates.
            <Callout type="info">Each bill makes the next one faster (cached findings) and more accurate (correction factors).</Callout>
          </div>
        }
      />

      <Line dashed />

      {/* Future */}
      <Node
        icon={Icons.lock}
        label="US-Data Improvement Cycle"
        sublabel="Uprating (low risk) → Reweighting (medium) → Imputation (high)"
        color={colors.gray[400]}
        badge="Future"
        delay={560}
        detail={
          <div>
            When findings reveal persistent data gaps, propose changes to policyengine-us-data. Each change tested against all ~500 calibration targets.
            <Callout type="warning">Requires regression harness. Every change must pass: target state improved AND no other state degraded &gt;5%.</Callout>
          </div>
        }
      />

      {/* Footer */}
      <div style={{
        textAlign: "center", marginTop: 48, paddingTop: 20,
        borderTop: `1px solid ${colors.border.light}`,
        fontSize: 11, color: colors.text.tertiary,
        lineHeight: 1.6,
      }}>
        PolicyEngine Reform Scoring Pipeline
        <br />
        Inspired by <a href="https://github.com/karpathy/autoresearch" style={{ color: colors.primary[600], textDecoration: "none" }}>autoresearch</a>
      </div>
    </div>
  );
}
