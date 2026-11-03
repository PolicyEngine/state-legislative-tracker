// Replays scripts/sql on a real Postgres and tests what each Data API role can
// do to processed_bills. Needs a superuser connection:
//
//   TRACKER_TEST_POSTGRES_URL=postgresql://postgres@localhost/postgres bun run test
//
// Invariants, for each of the anon and authenticated roles:
// - it reads every processed_bills and pending_analysis row and column that
//   the table owner reads;
// - it holds SELECT on processed_bills and nothing else on the table or its id
//   sequence, so it can't insert, update, delete or truncate;
// - a stray insert, update or delete grant still changes no rows, and an
//   insert still fails. RLS doesn't cover TRUNCATE, so the revoke is its only
//   guard;
// - with an open policy or a PUBLIC write grant already on the table, the
//   migration still closes writes.
// The service role keeps every read and write the monitors and triage use.
// Each statement runs with the role claim PostgREST sets, so a policy that
// reads auth.role() sees what it would see on a real request.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TRACKER_TEST_POSTGRES_URL;
// The SQL access workflow sets this, so a lost URL fails the job instead of
// skipping every test. `bun run test` on its own still needs no database.
if (process.env.TRACKER_TEST_POSTGRES_REQUIRED === "1" && !ADMIN_URL) {
  throw new Error("TRACKER_TEST_POSTGRES_REQUIRED is set but TRACKER_TEST_POSTGRES_URL is not");
}
const SQL_DIR = path.resolve(__dirname);
const MIGRATION = "009_processed_bills_rls.sql";
// 004's pending_analysis has columns that 005's replacement drops, so Postgres
// refuses to run both. Only 005 matches the columns the scripts use.
const SUPERSEDED = "004_add_confidence_score.sql";
const READ_ROLES = ["anon", "authenticated"];

// Supabase's defaults: both roles can use the schema, and each new table grants
// them everything. Nothing in scripts/sql creates processed_bills, so the columns
// here come from docs/SUPABASE_MIGRATION.md and the columns the scripts write.
const SUPABASE_SETUP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;
`;
// auth.role() matches Supabase's own definition.
const DATABASE_SETUP = `
create schema auth;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

create table processed_bills (
  id bigserial primary key,
  bill_id integer not null unique,
  state text,
  bill_number text,
  title text,
  description text,
  status text,
  status_date date,
  last_action text,
  last_action_date date,
  official_url text,
  session_name text,
  github_issue_url text,
  matched_query text,
  legiscan_url text,
  skipped_reason text,
  created_at timestamptz default now()
);
`;
// The rows differ on each column a read policy might filter on: a federal bill,
// a skipped bill, scores of 0 and null, and a bill with no action date.
const SEED = `
insert into processed_bills
  (bill_id, state, bill_number, title, status, last_action, last_action_date,
   confidence_score, skipped_reason)
values
  (1, 'ZZ', 'HB 1', 'First test bill', 'Introduced', 'Filed', '2026-01-01', 50, null),
  (2, 'ZZ', 'HB 2', 'Second test bill', 'Enacted', 'Signed', '2026-02-01', 90, null),
  (3, 'US', 'HR 3', 'Federal test bill', 'Introduced', 'Referred', '2026-03-01', 70, null),
  (4, 'ZZ', 'SB 4', 'Skipped test bill', 'Introduced', 'Filed', '2026-01-15', 80, 'Not relevant'),
  (5, 'ZZ', 'SB 5', 'Low score test bill', 'Introduced', 'Filed', null, 0, null),
  (6, 'ZZ', 'SB 6', 'Unscored test bill', 'Introduced', 'Filed', '2026-01-20', null, null);
`;
const SEED_ROWS = 6;
const READS =
  "select jsonb_build_object(" +
  "'bills', (select jsonb_agg(to_jsonb(b) order by b.bill_id) from processed_bills b), " +
  "'pending', (select jsonb_agg(to_jsonb(p) order by p.bill_id) from pending_analysis p))";
const FEED =
  "select bill_number from processed_bills " +
  "where confidence_score > 19 and skipped_reason is null " +
  "order by last_action_date desc nulls last";

function psql(url, sql) {
  const result = spawnSync(
    "psql",
    [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
    { input: sql, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

describe.skipIf(!ADMIN_URL)("processed_bills access", () => {
  const name = `tracker_rls_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const url = ADMIN_URL ? Object.assign(new URL(ADMIN_URL), { pathname: `/${name}` }).href : "";
  const migrationSql = readFileSync(path.join(SQL_DIR, MIGRATION), "utf8");
  // The superuser that runs the replay owns every table, so it reads every row.
  const ownerReads = () => psql(url, READS);
  const reads = (role) => asRole(role, READS);
  let anonBefore;
  let openBefore;

  // Runs sql as role, with the role claim a Data API request carries, then rolls back.
  function asRole(role, sql, setup = "") {
    const claims = JSON.stringify({ role });
    return psql(
      url,
      `begin;\n${setup};\nset local request.jwt.claims = '${claims}';\nset local role ${role};\n${sql};\nrollback;`,
    );
  }

  const changed = (statement) =>
    `with changed as (${statement} returning 1) select count(*) from changed`;

  beforeAll(() => {
    psql(ADMIN_URL, SUPABASE_SETUP);
    psql(ADMIN_URL, `create database ${name}`);
    psql(url, DATABASE_SETUP);
    const files = readdirSync(SQL_DIR)
      .filter((file) => file.endsWith(".sql") && file !== SUPERSEDED)
      .sort();
    for (const file of files.filter((file) => file < MIGRATION)) {
      psql(url, readFileSync(path.join(SQL_DIR, file), "utf8"));
    }
    psql(url, SEED);
    anonBefore = reads("anon");
    openBefore = asRole("anon", changed("update processed_bills set title = title"));
    for (const file of files.filter((file) => file >= MIGRATION)) {
      psql(url, readFileSync(path.join(SQL_DIR, file), "utf8"));
    }
  });

  afterAll(() => {
    psql(ADMIN_URL, `drop database if exists ${name} with (force)`);
  });

  it("starts with anon able to read and change every row, so the checks below can fail", () => {
    expect(openBefore).toBe(String(SEED_ROWS));
    expect(JSON.parse(anonBefore).bills).toHaveLength(SEED_ROWS);
  });

  it.each(READ_ROLES)("lets %s read every row and column the owner reads", (role) => {
    expect(JSON.parse(reads(role)).bills).toHaveLength(SEED_ROWS);
    expect(reads(role)).toBe(ownerReads());
  });

  it("serves the bill activity feed's query to anon as the owner sees it", () => {
    const rows = asRole("anon", FEED);
    expect(rows.split("\n")).toEqual(["HR 3", "HB 2", "HB 1"]);
    expect(rows).toBe(psql(url, FEED));
  });

  describe.each(READ_ROLES)("as %s", (role) => {
    const writes = {
      insert: "insert into processed_bills (bill_id) values (100)",
      update: "update processed_bills set title = 'changed'",
      delete: "delete from processed_bills",
      truncate: "truncate processed_bills",
    };

    it.each(Object.keys(writes))("refuses %s with no grant", (command) => {
      expect(() => asRole(role, writes[command])).toThrow(/42501: permission denied/);
    });

    it("holds SELECT on processed_bills and nothing else on it or its sequence", () => {
      const has = (privilege) =>
        psql(url, `select has_table_privilege('${role}', 'processed_bills', '${privilege}')`);
      const denied = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
      if (Number(psql(url, "show server_version_num")) >= 170000) denied.push("MAINTAIN");
      expect(has("SELECT")).toBe("t");
      for (const privilege of denied) expect(has(privilege), privilege).toBe("f");
      expect(
        psql(
          url,
          `select has_sequence_privilege('${role}', ` +
            "pg_get_serial_sequence('processed_bills', 'id'), 'USAGE,SELECT,UPDATE')",
        ),
      ).toBe("f");
    });

    it("changes nothing with a stray insert, update or delete grant", () => {
      const grant = `grant insert, update, delete on processed_bills to ${role}`;
      // An explicit id skips the sequence, which the role can't use either, so
      // the insert reaches the row level check.
      const insert = "insert into processed_bills (id, bill_id) values (100, 100)";
      expect(asRole(role, changed(writes.update), grant)).toBe("0");
      expect(asRole(role, changed(writes.delete), grant)).toBe("0");
      expect(() => asRole(role, insert, grant)).toThrow(/42501: new row violates row-level/);
    });

    it.each([
      ["an open policy", ""],
      [
        "an open policy and PUBLIC write grants",
        "grant insert, update, delete on processed_bills to public; " +
          "grant all on sequence processed_bills_id_seq to public;",
      ],
    ])("refuses writes even if the table already holds %s", (_, grant) => {
      const setup = `
        ${grant}
        create policy "Open" on processed_bills for all using (true) with check (true);
        ${migrationSql}`;
      expect(() => asRole(role, writes.update, setup)).toThrow(/42501: permission denied/);
      expect(() => asRole(role, writes.delete, setup)).toThrow(/42501: permission denied/);
      expect(() => asRole(role, writes.insert, setup)).toThrow(/42501: permission denied/);
      expect(
        asRole(
          role,
          "select has_sequence_privilege(current_user, " +
            "pg_get_serial_sequence('processed_bills', 'id'), 'USAGE,SELECT,UPDATE')",
          setup,
        ),
      ).toBe("f");
    });
  });

  it("lets the service role run each write the scripts use", () => {
    expect(asRole("service_role", changed("update processed_bills set status = 'x' where id = 1"))).toBe("1");
    expect(
      asRole(
        "service_role",
        "insert into processed_bills (bill_id, state, bill_number) values (2, 'ZZ', 'HB 2') " +
          "on conflict (bill_id) do update set title = 'upserted' returning title",
      ),
    ).toBe("upserted");
    expect(asRole("service_role", changed("insert into processed_bills (bill_id) values (100)"))).toBe("1");
    expect(asRole("service_role", changed("delete from processed_bills"))).toBe(String(SEED_ROWS));
  });

  it("keeps the service role's writes when its only grants came through PUBLIC", () => {
    const setup = `
      revoke all on processed_bills from service_role;
      revoke all on sequence processed_bills_id_seq from service_role;
      grant all on processed_bills to public;
      grant all on sequence processed_bills_id_seq to public;
      ${migrationSql}`;
    expect(asRole("service_role", changed("update processed_bills set status = 'x' where id = 1"), setup)).toBe("1");
    expect(asRole("service_role", changed("insert into processed_bills (bill_id) values (100)"), setup)).toBe("1");
    expect(asRole("service_role", changed("delete from processed_bills where id = 1"), setup)).toBe("1");
  });

  it("keeps row level security on every table and only these two policies here", () => {
    expect(
      psql(
        url,
        "select count(*) from pg_class where relnamespace = 'public'::regnamespace " +
          "and relkind in ('r', 'p') and not relrowsecurity",
      ),
    ).toBe("0");
    expect(
      psql(url, "select policyname from pg_policies where tablename = 'processed_bills' order by 1").split("\n"),
    ).toEqual(["Public read processed_bills", "Service write processed_bills"]);
  });

  it("can run again", () => {
    psql(url, migrationSql);
    for (const role of READ_ROLES) expect(reads(role)).toBe(ownerReads());
  });
});
