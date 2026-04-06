import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { colors, typography, spacing } from "../../designTokens";

function StatCard({ label, value, subtitle, color }) {
  return (
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.border.light}`,
      borderRadius: spacing.radius.xl,
      padding: spacing["2xl"],
      flex: "1 1 200px",
      minWidth: 180,
    }}>
      <div style={{
        fontSize: typography.fontSize.xs,
        color: colors.text.tertiary,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: typography.fontWeight.medium,
        marginBottom: spacing.xs,
      }}>{label}</div>
      <div style={{
        fontSize: typography.fontSize["3xl"],
        fontWeight: typography.fontWeight.bold,
        color: color || colors.text.primary,
        fontFamily: typography.fontFamily.mono,
      }}>{value}</div>
      {subtitle && (
        <div style={{
          fontSize: typography.fontSize.xs,
          color: colors.text.secondary,
          marginTop: spacing.xs,
        }}>{subtitle}</div>
      )}
    </div>
  );
}

function DiffBar({ initial, final, tolerance }) {
  const maxPct = Math.max(initial, 0.5);
  const initialWidth = Math.min((initial / maxPct) * 100, 100);
  const finalWidth = Math.min((final / maxPct) * 100, 100);
  const tolLine = Math.min((tolerance / maxPct) * 100, 100);

  return (
    <div style={{ position: "relative", height: 20, width: "100%", minWidth: 120 }}>
      {/* Initial bar (faded) */}
      <div style={{
        position: "absolute", top: 2, left: 0, height: 6,
        width: `${initialWidth}%`, background: colors.red[200],
        borderRadius: 3,
      }} />
      {/* Final bar */}
      <div style={{
        position: "absolute", top: 10, left: 0, height: 6,
        width: `${finalWidth}%`,
        background: final <= tolerance ? colors.green[500] : colors.primary[400],
        borderRadius: 3,
      }} />
      {/* Tolerance line */}
      <div style={{
        position: "absolute", top: 0, left: `${tolLine}%`, height: 18,
        borderLeft: `2px dashed ${colors.gray[400]}`,
      }} />
    </div>
  );
}

function BillRow({ item, onSelect }) {
  const cal = item.calibration || {};
  const converged = cal.converged;
  const initial = (cal.initial_diff_pct || 0) / 100;
  const final = (cal.final_diff_pct || 0) / 100;
  const tolerance = item.tolerance || 0.15;

  return (
    <tr
      onClick={() => onSelect?.(item)}
      style={{ cursor: "pointer", borderBottom: `1px solid ${colors.border.light}` }}
      className="card-hover"
    >
      <td style={{ padding: `${spacing.md} ${spacing.lg}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm }}>
        {item.reform_id}
      </td>
      <td style={{ padding: `${spacing.md} ${spacing.lg}`, fontWeight: typography.fontWeight.semibold }}>
        {item.state}
      </td>
      <td style={{ padding: `${spacing.md} ${spacing.lg}`, textAlign: "right", fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm }}>
        {initial > 0 ? `${(initial * 100).toFixed(1)}%` : "—"}
      </td>
      <td style={{ padding: `${spacing.md} ${spacing.lg}`, textAlign: "right", fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm, color: converged ? colors.green[600] : colors.text.secondary }}>
        {final > 0 ? `${(final * 100).toFixed(1)}%` : "—"}
      </td>
      <td style={{ padding: `${spacing.md} ${spacing.lg}`, width: 160 }}>
        {initial > 0 && <DiffBar initial={initial} final={final} tolerance={tolerance} />}
      </td>
      <td style={{ padding: `${spacing.md} ${spacing.lg}` }}>
        {converged ? (
          <span style={{ background: colors.green[50], color: colors.green[700], padding: "2px 8px", borderRadius: 12, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium }}>
            Converged
          </span>
        ) : cal.diagnosis_category ? (
          <span style={{ background: colors.blue[50], color: colors.blue[700], padding: "2px 8px", borderRadius: 12, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium }}>
            {cal.diagnosis_category.replace("data-level:", "").replace(/_/g, " ")}
          </span>
        ) : (
          <span style={{ color: colors.text.tertiary, fontSize: typography.fontSize.xs }}>—</span>
        )}
      </td>
      <td style={{ padding: `${spacing.md} ${spacing.lg}`, fontSize: typography.fontSize.xs, color: colors.text.secondary, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {cal.root_cause?.slice(0, 60) || "—"}
      </td>
    </tr>
  );
}

function StateBiasChart({ data }) {
  if (!data.length) return null;
  const maxAbs = Math.max(...data.map(d => Math.abs(d.avg_residual)), 0.01);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
      {data.map(d => {
        const pct = d.avg_residual;
        const barWidth = Math.abs(pct / maxAbs) * 50;
        const isNeg = pct < 0;
        return (
          <div key={d.state} style={{ display: "flex", alignItems: "center", gap: spacing.sm, height: 24 }}>
            <div style={{ width: 30, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, textAlign: "right" }}>
              {d.state}
            </div>
            <div style={{ flex: 1, position: "relative", height: 16 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, borderLeft: `1px solid ${colors.gray[300]}` }} />
              <div style={{
                position: "absolute",
                top: 2, height: 12, borderRadius: 6,
                background: isNeg ? colors.blue[400] : colors.red[400],
                ...(isNeg
                  ? { right: "50%", width: `${barWidth}%` }
                  : { left: "50%", width: `${barWidth}%` }
                ),
              }} />
            </div>
            <div style={{ width: 50, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, textAlign: "right", color: isNeg ? colors.blue[600] : colors.red[600] }}>
              {(pct * 100).toFixed(1)}%
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: spacing.xs, paddingLeft: 38 }}>
        <span style={{ fontSize: typography.fontSize.xs, color: colors.text.tertiary }}>PE underestimates</span>
        <span style={{ fontSize: typography.fontSize.xs, color: colors.text.tertiary }}>PE overestimates</span>
      </div>
    </div>
  );
}

function IterationTimeline({ log }) {
  if (!log || !log.length) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 32 }}>
      {log.map((entry, i) => {
        const status = entry.status;
        const bg = status === "accept" ? colors.green[500]
          : status === "keep" ? colors.primary[400]
          : status === "discard" ? colors.red[300]
          : colors.gray[300];
        return (
          <div
            key={i}
            title={`#${entry.attempt}: ${entry.description?.slice(0, 60) || ""} (${entry.pct_diff}%)`}
            style={{
              width: 24, height: 24, borderRadius: "50%",
              background: bg, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, color: colors.white, fontWeight: typography.fontWeight.bold,
              fontFamily: typography.fontFamily.mono,
            }}
          >
            {entry.attempt}
          </div>
        );
      })}
    </div>
  );
}

export default function CalibrationDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    async function load() {
      // Fetch validation_metadata + model_notes.calibration
      const [vmResult, riResult] = await Promise.all([
        supabase.table("validation_metadata").select("*"),
        supabase.table("reform_impacts").select("id, model_notes"),
      ]);

      const vmMap = {};
      for (const row of vmResult.data || []) {
        vmMap[row.id] = row;
      }

      const items = [];
      for (const ri of riResult.data || []) {
        const mn = typeof ri.model_notes === "string" ? JSON.parse(ri.model_notes) : (ri.model_notes || {});
        const cal = mn.calibration;
        if (!cal) continue;

        const vm = vmMap[ri.id] || {};
        items.push({
          reform_id: ri.id,
          state: ri.id.split("-")[0].toUpperCase(),
          calibration: cal,
          pe_estimate: vm.pe_estimate,
          fiscal_note_estimate: vm.fiscal_note_estimate,
          difference_pct: vm.difference_from_fiscal_note_pct,
          within_range: vm.within_range,
          iterations: vm.iterations,
          iteration_log: vm.iteration_log || [],
          tolerance: 0.15,
        });
      }

      setData(items);
      setLoading(false);
    }
    load();
  }, []);

  const stats = useMemo(() => {
    if (!data.length) return null;
    const converged = data.filter(d => d.calibration?.converged);
    const diffs = data.map(d => (d.calibration?.initial_diff_pct || 0) - (d.calibration?.final_diff_pct || 0)).filter(d => d > 0);
    const attempts = data.map(d => d.calibration?.attempts || 0).filter(a => a > 0);

    return {
      total: data.length,
      converged: converged.length,
      convergenceRate: data.length > 0 ? converged.length / data.length : 0,
      avgImprovement: diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0,
      avgAttempts: attempts.length > 0 ? attempts.reduce((a, b) => a + b, 0) / attempts.length : 0,
    };
  }, [data]);

  const stateBiases = useMemo(() => {
    const byState = {};
    for (const item of data) {
      const state = item.state;
      if (!byState[state]) byState[state] = [];
      const cal = item.calibration;
      if (cal?.final_diff_pct != null && item.pe_estimate && item.calibration?.target) {
        const sign = item.pe_estimate > Math.abs(item.calibration.target) ? 1 : -1;
        byState[state].push(sign * cal.final_diff_pct / 100);
      }
    }
    return Object.entries(byState)
      .filter(([, vals]) => vals.length > 0)
      .map(([state, vals]) => ({
        state,
        count: vals.length,
        avg_residual: vals.reduce((a, b) => a + b, 0) / vals.length,
      }))
      .sort((a, b) => a.avg_residual - b.avg_residual);
  }, [data]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: spacing["4xl"], color: colors.text.tertiary }}>
        Loading calibration data...
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: 1200,
      margin: "0 auto",
      padding: `${spacing["3xl"]} ${spacing["2xl"]}`,
      fontFamily: typography.fontFamily.body,
    }}>
      {/* Header */}
      <div style={{ marginBottom: spacing["3xl"] }}>
        <h1 style={{
          fontSize: typography.fontSize["3xl"],
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: colors.text.primary,
          margin: 0,
        }}>
          Calibration Dashboard
        </h1>
        <p style={{
          fontSize: typography.fontSize.base,
          color: colors.text.secondary,
          marginTop: spacing.sm,
          lineHeight: 1.6,
        }}>
          How PolicyEngine estimates compare to official fiscal notes, and how we improve them.
          Each bill goes through an autonomous calibration loop that iteratively refines parameter
          mappings until the estimate converges within tolerance.
        </p>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: "flex", gap: spacing.lg, flexWrap: "wrap", marginBottom: spacing["3xl"] }}>
          <StatCard label="Bills Calibrated" value={stats.total} />
          <StatCard
            label="Convergence Rate"
            value={`${(stats.convergenceRate * 100).toFixed(0)}%`}
            subtitle={`${stats.converged} of ${stats.total} within tolerance`}
            color={stats.convergenceRate > 0.7 ? colors.green[600] : colors.primary[600]}
          />
          <StatCard
            label="Avg Improvement"
            value={`${stats.avgImprovement.toFixed(1)}pp`}
            subtitle="Initial vs final discrepancy"
            color={colors.primary[600]}
          />
          <StatCard
            label="Avg Attempts"
            value={stats.avgAttempts.toFixed(1)}
            subtitle="Experiments per bill"
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 350px", gap: spacing["2xl"], alignItems: "start" }}>
        {/* Bill table */}
        <div style={{
          background: colors.white,
          border: `1px solid ${colors.border.light}`,
          borderRadius: spacing.radius.xl,
          overflow: "hidden",
        }}>
          <div style={{
            padding: `${spacing.lg} ${spacing["2xl"]}`,
            borderBottom: `1px solid ${colors.border.light}`,
          }}>
            <h2 style={{
              fontSize: typography.fontSize.lg,
              fontWeight: typography.fontWeight.semibold,
              margin: 0,
            }}>Per-Bill Results</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.fontSize.sm }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${colors.border.light}`, background: colors.gray[50] }}>
                  {["Bill", "State", "Initial", "Final", "Progress", "Status", "Root Cause"].map(h => (
                    <th key={h} style={{
                      padding: `${spacing.sm} ${spacing.lg}`,
                      textAlign: h === "Initial" || h === "Final" ? "right" : "left",
                      fontWeight: typography.fontWeight.medium,
                      color: colors.text.secondary,
                      fontSize: typography.fontSize.xs,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map(item => (
                  <BillRow key={item.reform_id} item={item} onSelect={setSelected} />
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: spacing["3xl"], textAlign: "center", color: colors.text.tertiary }}>
                      No calibrated bills yet. Run <code>auto_calibrate.py --finalize</code> after calibrating a bill.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: spacing["2xl"] }}>
          {/* State bias chart */}
          {stateBiases.length > 0 && (
            <div style={{
              background: colors.white,
              border: `1px solid ${colors.border.light}`,
              borderRadius: spacing.radius.xl,
              padding: spacing["2xl"],
            }}>
              <h3 style={{
                fontSize: typography.fontSize.base,
                fontWeight: typography.fontWeight.semibold,
                margin: `0 0 ${spacing.lg}`,
              }}>State-Level Bias</h3>
              <StateBiasChart data={stateBiases} />
            </div>
          )}

          {/* Selected bill detail */}
          {selected && (
            <div style={{
              background: colors.white,
              border: `1px solid ${colors.border.light}`,
              borderRadius: spacing.radius.xl,
              padding: spacing["2xl"],
            }}>
              <h3 style={{
                fontSize: typography.fontSize.base,
                fontWeight: typography.fontWeight.semibold,
                margin: `0 0 ${spacing.lg}`,
              }}>{selected.reform_id}</h3>

              <div style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary, lineHeight: 1.8 }}>
                <div><strong>Target:</strong> ${(selected.calibration.target / 1e6).toFixed(1)}M</div>
                <div><strong>PE Estimate:</strong> ${(selected.pe_estimate / 1e6).toFixed(1)}M</div>
                <div><strong>Final diff:</strong> {selected.calibration.final_diff_pct?.toFixed(1)}%</div>
                <div><strong>Attempts:</strong> {selected.calibration.attempts}</div>
                {selected.calibration.root_cause && (
                  <div style={{ marginTop: spacing.md }}>
                    <strong>Root cause:</strong>
                    <div style={{ marginTop: spacing.xs, fontSize: typography.fontSize.xs, color: colors.text.secondary, lineHeight: 1.5 }}>
                      {selected.calibration.root_cause}
                    </div>
                  </div>
                )}
              </div>

              {selected.iteration_log?.length > 0 && (
                <div style={{ marginTop: spacing.lg }}>
                  <div style={{ fontSize: typography.fontSize.xs, color: colors.text.tertiary, marginBottom: spacing.xs }}>
                    Iteration timeline
                  </div>
                  <IterationTimeline log={selected.iteration_log} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
