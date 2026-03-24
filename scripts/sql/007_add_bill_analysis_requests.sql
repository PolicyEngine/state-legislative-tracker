-- ============================================================================
-- TABLE: bill_analysis_requests
-- Stores requests from users asking PolicyEngine to analyze an unmodeled bill.
-- This acts as the canonical export source for CSV downloads / back-office review.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bill_analysis_requests (
  id                    BIGSERIAL PRIMARY KEY,
  state                 TEXT NOT NULL,
  bill_number           TEXT NOT NULL,
  title                 TEXT NOT NULL,
  bill_url              TEXT NOT NULL,
  requester_email       TEXT NOT NULL,
  subscribe_newsletter  BOOLEAN NOT NULL DEFAULT FALSE,
  request_source        TEXT,
  origin                TEXT,
  user_agent            TEXT,
  handled               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE bill_analysis_requests IS 'Inbound requests for new bill analysis from the public tracker UI';
COMMENT ON COLUMN bill_analysis_requests.bill_url IS 'Official or source URL for the requested bill';
COMMENT ON COLUMN bill_analysis_requests.subscribe_newsletter IS 'Whether the requester opted into the newsletter at submission time';
COMMENT ON COLUMN bill_analysis_requests.request_source IS 'UI source identifier, e.g. recent_activity_all_bills';

CREATE INDEX IF NOT EXISTS idx_bill_analysis_requests_created_at
  ON bill_analysis_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bill_analysis_requests_handled
  ON bill_analysis_requests(handled);

ALTER TABLE bill_analysis_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service write bill analysis requests" ON bill_analysis_requests
  FOR ALL USING (auth.role() = 'service_role');
