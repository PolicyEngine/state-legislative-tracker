-- ============================================================================
-- Row level security on processed_bills
-- The app reads this table with the anon key. The monitors and triage write
-- with the service key, which bypasses RLS. Safe to run more than once.
-- ============================================================================
ALTER TABLE processed_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read processed_bills" ON processed_bills;
CREATE POLICY "Public read processed_bills" ON processed_bills
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service write processed_bills" ON processed_bills;
CREATE POLICY "Service write processed_bills" ON processed_bills
  FOR ALL USING (auth.role() = 'service_role');

-- Without a write grant, no other policy on this table can admit a write.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON processed_bills FROM anon, authenticated;
