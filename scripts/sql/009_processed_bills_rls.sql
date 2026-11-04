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

-- The same for the sequences the table owns (serial or identity), whatever the
-- column. A sequence the table doesn't own may number another table's rows,
-- so this file leaves it alone.
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

-- A view writes its tables with its owner's privileges, and these policies
-- don't bind the table's owner, so a write grant on an updatable view that
-- owner holds would let anon write this table. On every view built on
-- processed_bills, directly or through other views, anon and authenticated
-- keep SELECT and nothing else. CREATE OR REPLACE VIEW keeps these grants. A
-- view created later, or dropped and created again, takes its creator's
-- default privileges, so run this file again after either.
DO $$
DECLARE
  dependent regclass;
BEGIN
  FOR dependent IN
    WITH RECURSIVE dependents AS (
      SELECT r.ev_class AS oid
      FROM pg_depend AS d
      JOIN pg_rewrite AS r ON r.oid = d.objid
      JOIN pg_class AS v ON v.oid = r.ev_class AND v.relkind = 'v'
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND d.refobjid = 'processed_bills'::regclass
      UNION
      SELECT r.ev_class
      FROM dependents AS p
      JOIN pg_depend AS d ON d.refobjid = p.oid
      JOIN pg_rewrite AS r ON r.oid = d.objid
      JOIN pg_class AS v ON v.oid = r.ev_class AND v.relkind = 'v'
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.refclassid = 'pg_class'::regclass
    )
    SELECT oid::regclass FROM dependents
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated', dependent);
    EXECUTE format('GRANT SELECT ON %s TO anon, authenticated, service_role', dependent);
  END LOOP;
END
$$;
