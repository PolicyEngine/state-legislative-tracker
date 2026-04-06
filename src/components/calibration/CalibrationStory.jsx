import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { colors, typography, spacing } from "../../designTokens";

// Scroll-triggered section using Intersection Observer
function ScrollSection({ children, id, onVisible }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onVisible?.(id); },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, onVisible]);

  return (
    <section
      ref={ref}
      id={id}
      style={{
        minHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `${spacing["4xl"]} 0`,
      }}
    >
      {children}
    </section>
  );
}

function SectionTitle({ step, title, subtitle }) {
  return (
    <div style={{ marginBottom: spacing["3xl"] }}>
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.md,
      }}>
        <span style={{
          background: colors.primary[500],
          color: colors.white,
          width: 28, height: 28,
          borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.mono,
        }}>{step}</span>
        <span style={{
          fontSize: typography.fontSize.xs,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: colors.primary[600],
          fontWeight: typography.fontWeight.semibold,
        }}>Step {step}</span>
      </div>
      <h2 style={{
        fontSize: typography.fontSize["4xl"],
        fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.primary,
        color: colors.text.primary,
        margin: 0,
        lineHeight: 1.2,
      }}>{title}</h2>
      {subtitle && (
        <p style={{
          fontSize: typography.fontSize.lg,
          color: colors.text.secondary,
          marginTop: spacing.md,
          lineHeight: 1.6,
          maxWidth: 640,
        }}>{subtitle}</p>
      )}
    </div>
  );
}

function MetricCallout({ value, label, color }) {
  return (
    <div style={{
      background: color ? `${color}10` : colors.gray[50],
      borderLeft: `4px solid ${color || colors.primary[500]}`,
      padding: `${spacing.lg} ${spacing["2xl"]}`,
      borderRadius: `0 ${spacing.radius.lg} ${spacing.radius.lg} 0`,
    }}>
      <div style={{
        fontSize: typography.fontSize["3xl"],
        fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.mono,
        color: color || colors.text.primary,
      }}>{value}</div>
      <div style={{
        fontSize: typography.fontSize.sm,
        color: colors.text.secondary,
        marginTop: spacing.xs,
      }}>{label}</div>
    </div>
  );
}

function CaseStudyStep({ attempt, pe, target, diff, status, description }) {
  const statusColors = {
    keep: colors.primary[400],
    accept: colors.green[500],
    discard: colors.red[400],
    crash: colors.gray[400],
  };
  const statusBg = {
    keep: colors.primary[50],
    accept: colors.green[50],
    discard: colors.red[50],
    crash: colors.gray[100],
  };

  return (
    <div style={{
      display: "flex",
      gap: spacing.lg,
      padding: spacing.lg,
      background: statusBg[status] || colors.gray[50],
      borderRadius: spacing.radius.lg,
      border: `1px solid ${statusColors[status] || colors.border.light}`,
      alignItems: "center",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: statusColors[status],
        display: "flex", alignItems: "center", justifyContent: "center",
        color: colors.white, fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm,
        flexShrink: 0,
      }}>
        {attempt}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium }}>
          {description}
        </div>
        <div style={{ fontSize: typography.fontSize.xs, color: colors.text.secondary, marginTop: 2 }}>
          PE: ${(pe / 1e6).toFixed(0)}M vs Target: ${(target / 1e6).toFixed(0)}M — {(diff * 100).toFixed(1)}% off
        </div>
      </div>
      <div style={{
        padding: "2px 10px",
        borderRadius: 12,
        background: statusColors[status],
        color: colors.white,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.semibold,
        textTransform: "uppercase",
        flexShrink: 0,
      }}>
        {status}
      </div>
    </div>
  );
}

function LoopDiagram() {
  const steps = [
    { label: "Read bill + past attempts", icon: "1" },
    { label: "Hypothesize why gap exists", icon: "2" },
    { label: "Modify reform_params", icon: "3" },
    { label: "Run microsimulation (~40s)", icon: "4" },
    { label: "Compare PE vs target", icon: "5" },
    { label: "Keep or discard", icon: "6" },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: spacing.lg,
      maxWidth: 540,
    }}>
      {steps.map((s, i) => (
        <div key={i} style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: spacing.sm,
          textAlign: "center",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: colors.primary[500], color: colors.white,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.mono,
          }}>{s.icon}</div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.text.secondary, lineHeight: 1.4 }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function LearningCard({ pattern, count, description, color }) {
  return (
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.border.light}`,
      borderRadius: spacing.radius.xl,
      padding: spacing["2xl"],
      borderTop: `3px solid ${color || colors.primary[500]}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
        <span style={{
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          color: colors.text.primary,
        }}>{pattern}</span>
        {count > 0 && (
          <span style={{
            fontSize: typography.fontSize.xs,
            color: colors.text.tertiary,
            fontFamily: typography.fontFamily.mono,
          }}>{count} bills</span>
        )}
      </div>
      <p style={{
        fontSize: typography.fontSize.sm,
        color: colors.text.secondary,
        lineHeight: 1.6,
        margin: 0,
      }}>{description}</p>
    </div>
  );
}

export default function CalibrationStory() {
  const [activeSection, setActiveSection] = useState("challenge");
  const [data, setData] = useState(null);

  useEffect(() => {
    async function load() {
      const [vmResult, riResult] = await Promise.all([
        supabase.table("validation_metadata").select("*"),
        supabase.table("reform_impacts").select("id, model_notes"),
      ]);

      const items = [];
      const vmMap = {};
      for (const row of vmResult.data || []) vmMap[row.id] = row;

      for (const ri of riResult.data || []) {
        const mn = typeof ri.model_notes === "string" ? JSON.parse(ri.model_notes) : (ri.model_notes || {});
        if (!mn.calibration) continue;
        items.push({ ...mn.calibration, reform_id: ri.id, vm: vmMap[ri.id] || {} });
      }

      setData(items);
    }
    load();
  }, []);

  const onVisible = useCallback((id) => setActiveSection(id), []);

  // Navigation dots
  const sections = [
    { id: "challenge", label: "The Challenge" },
    { id: "method", label: "The Method" },
    { id: "case-study", label: "Case Study" },
    { id: "learnings", label: "Learnings" },
    { id: "feedback", label: "Feedback Loop" },
  ];

  const stats = data ? {
    total: data.length,
    converged: data.filter(d => d.converged).length,
    avgImprovement: data.length > 0
      ? data.reduce((sum, d) => sum + ((d.initial_diff_pct || 0) - (d.final_diff_pct || 0)), 0) / data.length
      : 0,
  } : null;

  // Find ga-hb1001 case study data
  const caseStudy = data?.find(d => d.reform_id === "ga-hb1001");
  const caseStudyLog = caseStudy?.vm?.iteration_log || [];

  return (
    <div style={{ position: "relative" }}>
      {/* Fixed nav dots */}
      <nav style={{
        position: "fixed",
        right: spacing["2xl"],
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
        zIndex: 10,
      }}>
        {sections.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            title={s.label}
            style={{
              width: 10, height: 10,
              borderRadius: "50%",
              background: activeSection === s.id ? colors.primary[500] : colors.gray[300],
              display: "block",
              transition: "background 0.2s",
            }}
          />
        ))}
      </nav>

      <div style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: `0 ${spacing["2xl"]}`,
        fontFamily: typography.fontFamily.body,
      }}>
        {/* Hero */}
        <div style={{
          minHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}>
          <h1 style={{
            fontSize: "clamp(32px, 5vw, 48px)",
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
            color: colors.text.primary,
            lineHeight: 1.15,
            margin: 0,
          }}>
            How We Calibrate
            <br />
            <span style={{ color: colors.primary[600] }}>Policy Estimates</span>
          </h1>
          <p style={{
            fontSize: typography.fontSize.lg,
            color: colors.text.secondary,
            marginTop: spacing["2xl"],
            lineHeight: 1.7,
            maxWidth: 560,
          }}>
            PolicyEngine microsimulations don't always match official fiscal notes.
            Here's how we built an autonomous system — inspired by ML research methods —
            to iteratively improve our estimates and document every adjustment.
          </p>
          <div style={{
            marginTop: spacing["3xl"],
            fontSize: typography.fontSize.sm,
            color: colors.text.tertiary,
          }}>
            Scroll to explore ↓
          </div>
        </div>

        {/* Section 1: The Challenge */}
        <ScrollSection id="challenge" onVisible={onVisible}>
          <SectionTitle
            step={1}
            title="The Challenge"
            subtitle="PolicyEngine uses survey-based microdata (enhanced CPS). State fiscal offices use actual tax return data. The two don't always agree."
          />
          <div style={{ display: "flex", gap: spacing["2xl"], flexWrap: "wrap" }}>
            <MetricCallout
              value="14-50%"
              label="Typical initial gap between PE and fiscal notes"
              color={colors.red[500]}
            />
            <MetricCallout
              value="Different data"
              label="CPS survey vs actual tax returns"
              color={colors.blue[600]}
            />
          </div>
          <p style={{ fontSize: typography.fontSize.base, color: colors.text.secondary, lineHeight: 1.7, marginTop: spacing["2xl"], maxWidth: 580 }}>
            The gap isn't a bug — it's a data source difference. But we can close much of
            it by improving how we <em>interpret</em> bills: which parameters to change,
            what baseline to use, and how to handle year-over-year interactions.
          </p>
        </ScrollSection>

        {/* Section 2: The Method */}
        <ScrollSection id="method" onVisible={onVisible}>
          <SectionTitle
            step={2}
            title="The Method"
            subtitle="Inspired by Karpathy's autoresearch: an autonomous agent runs experiments in a loop, keeping what works and discarding what doesn't."
          />
          <LoopDiagram />
          <div style={{
            marginTop: spacing["3xl"],
            padding: spacing["2xl"],
            background: colors.gray[50],
            borderRadius: spacing.radius.xl,
            border: `1px solid ${colors.border.light}`,
          }}>
            <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, marginBottom: spacing.sm }}>
              Key principles
            </div>
            <ul style={{
              fontSize: typography.fontSize.sm,
              color: colors.text.secondary,
              lineHeight: 2,
              paddingLeft: spacing["2xl"],
              margin: 0,
            }}>
              <li><strong>Fixed evaluation</strong> — the simulation is immutable. Only the parameter interpretation changes.</li>
              <li><strong>Automatic keep/discard</strong> — if the estimate moves closer to the fiscal note, keep it.</li>
              <li><strong>Multi-strategy targets</strong> — when no fiscal note exists, triangulate from revenue data, similar bills, and back-of-envelope math.</li>
              <li><strong>Each run costs ~$0.15</strong> — ~40 seconds of local compute + modest LLM token usage per iteration.</li>
            </ul>
          </div>
        </ScrollSection>

        {/* Section 3: Case Study */}
        <ScrollSection id="case-study" onVisible={onVisible}>
          <SectionTitle
            step={3}
            title="Case Study: GA HB1001"
            subtitle="Georgia's income tax rate cut from 5.19% to 4.99%. Fiscal note says -$778M. PE initially said -$500M."
          />

          {caseStudyLog.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              {caseStudyLog.map((entry, i) => (
                <CaseStudyStep
                  key={i}
                  attempt={entry.attempt}
                  pe={entry.pe_estimate}
                  target={-778000000}
                  diff={entry.pct_diff / 100}
                  status={entry.status}
                  description={entry.description?.replace(/^(ACCEPT|DISCARD): ?/, "") || `Attempt ${entry.attempt}`}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
              <CaseStudyStep attempt={0} pe={-500290402} target={-778000000} diff={0.357} status="keep" description="Baseline: all 30 bracket params set to 4.99%" />
              <CaseStudyStep attempt={1} pe={-935228635} target={-778000000} diff={0.202} status="keep" description="Year=2025 where PE baseline is 5.19% (full 0.20pp cut)" />
              <CaseStudyStep attempt={2} pe={-800583615} target={-778000000} diff={0.029} status="accept" description="Year=2026, rate=4.93% (calibrated 0.16pp effective delta)" />
            </div>
          )}

          <div style={{
            marginTop: spacing["2xl"],
            padding: spacing["2xl"],
            background: colors.green[50],
            borderRadius: spacing.radius.xl,
            border: `1px solid ${colors.green[500]}`,
          }}>
            <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.green[700], marginBottom: spacing.sm }}>
              Root cause discovered
            </div>
            <p style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary, lineHeight: 1.6, margin: 0 }}>
              PE's baseline for 2026 is already 5.09% (not 5.19%), because prior legislation
              (HB1015) pre-scheduled annual rate cuts. The fiscal note measures from 2025 current law
              (0.20pp cut), but PE natively sees only 0.10pp. Adjusting the reform rate to 4.93%
              produces the correct aggregate impact: -$801M vs -$778M target (2.9% diff).
            </p>
          </div>
        </ScrollSection>

        {/* Section 4: What We Learned */}
        <ScrollSection id="learnings" onVisible={onVisible}>
          <SectionTitle
            step={4}
            title="What We've Learned"
            subtitle="Patterns extracted from calibrating bills across multiple states."
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.lg }}>
            <LearningCard
              pattern="Baseline Mismatches"
              count={1}
              description="When prior legislation pre-schedules rate changes, PE's baseline year differs from the fiscal note's reference year. Always check PE's parameter YAML for future-dated values."
              color={colors.primary[500]}
            />
            <LearningCard
              pattern="State Data Gaps"
              count={0}
              description="PE uses enhanced CPS microdata; states use actual tax returns. MD runs 13-17% below DLS; KS at roughly half of DOR. These are structural, not parameter errors."
              color={colors.blue[500]}
            />
            <LearningCard
              pattern="Revenue-Base Overestimate"
              count={1}
              description="Simple revenue×rate math often misses deductions, credits, and exemptions that shrink the effective tax base. Expect 20-30% overestimate from this strategy alone."
              color={colors.red[400]}
            />
            <LearningCard
              pattern="Per-Person vs Per-Return"
              count={0}
              description="Deduction and credit provisions can be interpreted per-person or per-return. Getting this wrong doubles or halves the estimate. Check the bill text carefully."
              color={colors.green[600]}
            />
          </div>

          {stats && stats.total > 0 && (
            <div style={{ display: "flex", gap: spacing["2xl"], marginTop: spacing["3xl"], flexWrap: "wrap" }}>
              <MetricCallout
                value={`${stats.total}`}
                label="Bills calibrated so far"
                color={colors.primary[600]}
              />
              <MetricCallout
                value={`${stats.converged}/${stats.total}`}
                label="Converged within tolerance"
                color={colors.green[600]}
              />
              <MetricCallout
                value={`${stats.avgImprovement.toFixed(1)}pp`}
                label="Average improvement"
                color={colors.primary[600]}
              />
            </div>
          )}
        </ScrollSection>

        {/* Section 5: Feedback Loop */}
        <ScrollSection id="feedback" onVisible={onVisible}>
          <SectionTitle
            step={5}
            title="The Feedback Loop"
            subtitle="Each calibrated bill makes the next one faster and more accurate."
          />

          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.lg,
          }}>
            {[
              {
                title: "Bill N calibrated",
                desc: "Agent discovers root cause, writes diagnosis to database",
                color: colors.primary[400],
              },
              {
                title: "Learnings extracted",
                desc: "State biases, strategy accuracy, and common patterns are logged",
                color: colors.primary[500],
              },
              {
                title: "Corrections computed",
                desc: "analyze_residuals.py quantifies biases across all bills (e.g., revenue-base overestimates by 9%)",
                color: colors.primary[600],
              },
              {
                title: "Bill N+1 starts smarter",
                desc: "Harness applies correction factors to targets. Agent reads past diagnoses from same state before starting.",
                color: colors.primary[700],
              },
            ].map((step, i) => (
              <div key={i} style={{
                display: "flex",
                gap: spacing.lg,
                alignItems: "flex-start",
              }}>
                <div style={{
                  width: 3, minHeight: i < 3 ? 60 : 0,
                  background: step.color,
                  flexShrink: 0,
                  marginLeft: 14,
                  position: "relative",
                }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: "50%",
                    background: step.color,
                    position: "absolute", top: 4, left: -4.5,
                  }} />
                </div>
                <div style={{ paddingBottom: spacing.lg }}>
                  <div style={{ fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold }}>{step.title}</div>
                  <div style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary, marginTop: 2 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: spacing["3xl"],
            padding: spacing["2xl"],
            background: colors.primary[50],
            borderRadius: spacing.radius.xl,
            border: `1px solid ${colors.primary[200]}`,
            textAlign: "center",
          }}>
            <p style={{ fontSize: typography.fontSize.base, color: colors.primary[800], margin: 0, lineHeight: 1.6 }}>
              Every parameter adjustment is logged. Every discrepancy is explained.
              <br />
              This is how we build trust in policy microsimulation.
            </p>
          </div>
        </ScrollSection>

        {/* Footer */}
        <div style={{
          padding: `${spacing["4xl"]} 0`,
          textAlign: "center",
          borderTop: `1px solid ${colors.border.light}`,
          marginTop: spacing["3xl"],
        }}>
          <p style={{ fontSize: typography.fontSize.sm, color: colors.text.tertiary }}>
            Built with PolicyEngine microsimulation. Methodology inspired by{" "}
            <a href="https://github.com/karpathy/autoresearch" style={{ color: colors.primary[600] }}>
              karpathy/autoresearch
            </a>.
          </p>
        </div>
      </div>
    </div>
  );
}
