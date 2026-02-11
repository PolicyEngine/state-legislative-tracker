-- ============================================================================
-- Dataset Hash Tracking for LegiScan Bulk Dataset API
-- Tracks which dataset versions have been processed to avoid re-downloading
-- ============================================================================

CREATE TABLE IF NOT EXISTS dataset_hashes (
  session_id    INTEGER PRIMARY KEY,
  state         TEXT NOT NULL,
  dataset_hash  TEXT NOT NULL,
  dataset_date  TEXT,
  session_name  TEXT,
  last_checked  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_dataset_hashes_state ON dataset_hashes(state);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE dataset_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read dataset_hashes" ON dataset_hashes
  FOR SELECT USING (true);

CREATE POLICY "Service write dataset_hashes" ON dataset_hashes
  FOR ALL USING (auth.role() = 'service_role');
