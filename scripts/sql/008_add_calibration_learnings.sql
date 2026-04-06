-- ============================================================================
-- Calibration Learnings Table
-- Stores cross-bill patterns discovered during autonomous reform calibration.
-- Fed back into the validation harness to improve future calibrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS calibration_learnings (
  id              SERIAL PRIMARY KEY,
  reform_id       TEXT REFERENCES research(id) ON DELETE SET NULL,
  state           TEXT NOT NULL,

  -- What was learned
  pattern         TEXT NOT NULL,       -- "baseline_mismatch", "data_gap", "per_person_vs_return", "strategy_bias", "state_systematic"
  learning        TEXT NOT NULL,       -- Human-readable lesson
  details         JSONB,              -- Machine-readable details (correction factors, parameter paths, etc.)

  -- Classification
  category        TEXT,               -- Diagnosis category: "parameter-solvable", "data-level:state-systematic", etc.
  scope           TEXT DEFAULT 'state', -- "state" (applies to one state) or "global" (applies everywhere)

  -- For strategy corrections (scope = "global")
  strategy_name   TEXT,               -- "revenue_base", "back_of_envelope", etc.
  correction_factor NUMERIC,          -- Multiply strategy estimate by this (e.g., 0.91)

  -- For state bias corrections (scope = "state")
  avg_residual    NUMERIC,            -- Average residual for this state (signed, e.g., -0.15)
  residual_direction TEXT,            -- "PE high", "PE low", "mixed"
  based_on_count  INTEGER,            -- Number of bills this correction is based on

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cal_learnings_state ON calibration_learnings(state);
CREATE INDEX IF NOT EXISTS idx_cal_learnings_pattern ON calibration_learnings(pattern);
CREATE INDEX IF NOT EXISTS idx_cal_learnings_scope ON calibration_learnings(scope);
CREATE INDEX IF NOT EXISTS idx_cal_learnings_strategy ON calibration_learnings(strategy_name);

-- Comments
COMMENT ON TABLE calibration_learnings IS 'Cross-bill patterns from autonomous reform calibration. Used to improve future calibrations.';
COMMENT ON COLUMN calibration_learnings.pattern IS 'Pattern type: baseline_mismatch, data_gap, per_person_vs_return, strategy_bias, state_systematic';
COMMENT ON COLUMN calibration_learnings.scope IS 'state = applies to one state; global = applies to all states';
COMMENT ON COLUMN calibration_learnings.correction_factor IS 'For strategy corrections: multiply estimate by this factor';
COMMENT ON COLUMN calibration_learnings.avg_residual IS 'For state bias: signed avg residual (negative = PE underestimates)';

-- RLS: public read, service key write (matches other tables)
ALTER TABLE calibration_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON calibration_learnings
  FOR SELECT USING (true);

CREATE POLICY "Service key write access" ON calibration_learnings
  FOR ALL USING (auth.role() = 'service_role');
