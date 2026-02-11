-- ============================================================================
-- Add confidence scoring columns to processed_bills
-- Supports auto-triage: score each bill's encodability (0-100)
-- ============================================================================

ALTER TABLE processed_bills
  ADD COLUMN IF NOT EXISTS confidence_score    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_categories  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS matched_parameters  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS top_category        TEXT,
  ADD COLUMN IF NOT EXISTS auto_encode_status  TEXT;    -- NULL, queued, success, failed

COMMENT ON COLUMN processed_bills.confidence_score IS 'Encodability score 0-100 based on keyword-to-parameter matching';
COMMENT ON COLUMN processed_bills.matched_categories IS 'Array of category strings that matched, e.g. ["flat_income_tax_rate", "standard_deduction"]';
COMMENT ON COLUMN processed_bills.matched_parameters IS 'Array of PE parameter templates that matched';
COMMENT ON COLUMN processed_bills.top_category IS 'Highest-scoring matched category';
COMMENT ON COLUMN processed_bills.auto_encode_status IS 'Auto-encode pipeline status: NULL (not attempted), queued, success, failed';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast lookup of high-confidence un-skipped bills
CREATE INDEX IF NOT EXISTS idx_processed_bills_confidence
  ON processed_bills (confidence_score DESC)
  WHERE skipped_reason IS NULL;

-- ============================================================================
-- Update pending_analysis view to sort by confidence and include score columns
-- ============================================================================

CREATE OR REPLACE VIEW pending_analysis AS
SELECT
  pb.bill_id,
  pb.state,
  pb.bill_number,
  pb.title,
  pb.status,
  pb.last_action,
  pb.last_action_date,
  pb.legiscan_url,
  pb.confidence_score,
  pb.matched_categories,
  pb.matched_parameters,
  pb.top_category
FROM processed_bills pb
LEFT JOIN research r ON pb.bill_id = r.legiscan_bill_id
WHERE r.id IS NULL
  AND pb.skipped_reason IS NULL
ORDER BY pb.confidence_score DESC, pb.state, pb.bill_number;
