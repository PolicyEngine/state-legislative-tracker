-- ============================================================================
-- Data Findings Table
-- Durable, variable-specific findings from reform data diagnostics.
-- Each finding says: "For state X, PE variable Y differs from public data by Z%"
-- Findings persist across reforms, accumulate confidence, and are version-tagged.
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_findings (
    id                  SERIAL PRIMARY KEY,
    state               TEXT NOT NULL,
    variable            TEXT NOT NULL,           -- PE variable name (e.g., "adjusted_gross_income")
    year                INT NOT NULL,

    -- The finding
    pe_value            NUMERIC,
    benchmark_value     NUMERIC,
    benchmark_source    TEXT,                    -- Where the public data comes from
    pct_diff            NUMERIC,                -- (PE - benchmark) / benchmark
    finding             TEXT,                    -- Human-readable explanation

    -- Reform-specific context
    reform_type         TEXT,                    -- What kind of reform triggered this check
    relevant_to         TEXT[],                  -- Which reform types this finding applies to

    -- Provenance
    discovered_by       TEXT REFERENCES research(id) ON DELETE SET NULL,
    pe_us_version       TEXT NOT NULL,
    dataset_version     TEXT,

    -- Durability tracking
    confirmed_by        TEXT[] DEFAULT '{}',     -- Reform IDs that re-confirmed this
    times_confirmed     INT DEFAULT 1,
    last_verified       TIMESTAMPTZ DEFAULT NOW(),
    still_valid         BOOLEAN DEFAULT TRUE,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    -- One finding per (state, variable, year, pe_us_version)
    UNIQUE(state, variable, year, pe_us_version)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_data_findings_state ON data_findings(state);
CREATE INDEX IF NOT EXISTS idx_data_findings_variable ON data_findings(variable);
CREATE INDEX IF NOT EXISTS idx_data_findings_version ON data_findings(pe_us_version);
CREATE INDEX IF NOT EXISTS idx_data_findings_valid ON data_findings(still_valid);
CREATE INDEX IF NOT EXISTS idx_data_findings_state_var ON data_findings(state, variable, year);

-- Comments
COMMENT ON TABLE data_findings IS 'Variable-specific data quality findings from reform diagnostics. Accumulate across reforms.';
COMMENT ON COLUMN data_findings.variable IS 'PolicyEngine variable name (e.g., adjusted_gross_income, earned_income)';
COMMENT ON COLUMN data_findings.pct_diff IS 'Signed difference: (PE - benchmark) / |benchmark|. Positive = PE higher.';
COMMENT ON COLUMN data_findings.times_confirmed IS 'Number of independent reforms that confirmed this finding';
COMMENT ON COLUMN data_findings.still_valid IS 'False when PE-US version changes (findings need re-verification)';

-- RLS: public read, service key write
ALTER TABLE data_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON data_findings
    FOR SELECT USING (true);

CREATE POLICY "Service key write access" ON data_findings
    FOR ALL USING (auth.role() = 'service_role');

-- Function to confirm an existing finding (called when another reform sees the same result)
CREATE OR REPLACE FUNCTION confirm_data_finding(
    p_finding_id INT,
    p_confirming_reform TEXT
) RETURNS VOID AS $$
BEGIN
    UPDATE data_findings
    SET confirmed_by = array_append(confirmed_by, p_confirming_reform),
        times_confirmed = times_confirmed + 1,
        last_verified = NOW(),
        updated_at = NOW()
    WHERE id = p_finding_id
      AND NOT (p_confirming_reform = ANY(confirmed_by));
END;
$$ LANGUAGE plpgsql;

-- Function to invalidate findings for old PE-US versions
CREATE OR REPLACE FUNCTION invalidate_old_findings(
    p_current_version TEXT
) RETURNS INT AS $$
DECLARE
    affected INT;
BEGIN
    UPDATE data_findings
    SET still_valid = FALSE, updated_at = NOW()
    WHERE pe_us_version != p_current_version
      AND still_valid = TRUE;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql;
