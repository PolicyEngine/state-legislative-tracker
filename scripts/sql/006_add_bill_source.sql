-- ============================================================================
-- Add source tracking to processed_bills
-- Supports multiple bill discovery sources (LegiScan, OpenStates, etc.)
-- ============================================================================

ALTER TABLE processed_bills
  ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'legiscan',
  ADD COLUMN IF NOT EXISTS source_id  TEXT;

COMMENT ON COLUMN processed_bills.source IS 'Discovery source: legiscan, openstates';
COMMENT ON COLUMN processed_bills.source_id IS 'Original ID from the source (e.g., OpenStates ocd-bill/...)';

-- Unique constraint on state + bill_number to prevent cross-source duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_bills_state_bill
  ON processed_bills (state, bill_number);
