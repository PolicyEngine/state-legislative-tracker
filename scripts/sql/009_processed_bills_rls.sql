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

-- Without a write grant, no other policy on this table can admit a write. RLS
-- doesn't cover TRUNCATE, so this revoke is its only guard. REVOKE ALL also
-- covers PUBLIC and privileges newer Postgres versions add (17's MAINTAIN).
REVOKE ALL ON processed_bills FROM PUBLIC, anon, authenticated;
GRANT SELECT ON processed_bills TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON processed_bills TO service_role;

-- The same for the sequences that number its rows, whatever the column.
DO $$
DECLARE
  seq regclass;
BEGIN
  FOR seq IN
    SELECT d.objid::regclass
    FROM pg_depend AS d
    JOIN pg_class AS s ON s.oid = d.objid AND s.relkind = 'S'
    WHERE d.classid = 'pg_class'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = 'processed_bills'::regclass
      AND d.deptype IN ('a', 'i')
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq);
  END LOOP;
END
$$;
