-- ============================================================================
-- Add triage scoring columns to processed_bills
-- Only 3 columns needed: confidence_score, reform_type, scoring_reasoning
-- ============================================================================

ALTER TABLE processed_bills
  ADD COLUMN IF NOT EXISTS confidence_score    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reform_type         TEXT,
  ADD COLUMN IF NOT EXISTS scoring_reasoning   TEXT;

COMMENT ON COLUMN processed_bills.confidence_score IS 'Encodability score 0-100 from /triage-bills';
COMMENT ON COLUMN processed_bills.reform_type IS 'parametric, structural, or unknown';
COMMENT ON COLUMN processed_bills.scoring_reasoning IS 'One-sentence explanation of the confidence score';

-- Fast lookup of high-confidence un-skipped bills
CREATE INDEX IF NOT EXISTS idx_processed_bills_confidence
  ON processed_bills (confidence_score DESC)
  WHERE skipped_reason IS NULL;

-- View: active bills not yet encoded, sorted by score
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
  pb.reform_type,
  pb.scoring_reasoning
FROM processed_bills pb
LEFT JOIN research r ON pb.bill_id = r.legiscan_bill_id
WHERE r.id IS NULL
  AND pb.skipped_reason IS NULL
ORDER BY pb.confidence_score DESC, pb.state, pb.bill_number;
