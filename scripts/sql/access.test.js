// Replays scripts/sql on a real Postgres and tests what each Data API role can
// do to processed_bills. Needs a superuser connection:
//
//   TRACKER_TEST_POSTGRES_URL=postgresql://postgres@localhost/postgres bun run test
//
// Invariants, for each of the anon and authenticated roles:
// - it reads the same processed_bills and pending_analysis rows as before;
// - it can't insert, update or delete, even with a stray grant or an open policy.
// The service role keeps every read and write the monitors and triage use.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TRACKER_TEST_POSTGRES_URL;
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
const DATABASE_SETUP = `
create schema auth;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
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
const SEED = `
insert into processed_bills
  (bill_id, state, bill_number, title, status, last_action, last_action_date, confidence_score)
values
  (1, 'ZZ', 'HB 1', 'First test bill', 'Introduced', 'Filed', '2026-01-01', 50),
  (2, 'ZZ', 'HB 2', 'Second test bill', 'Enacted', 'Signed', '2026-02-01', 90);
`;

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
  const reads = (role) =>
    asRole(
      role,
      "select jsonb_build_object(" +
        "'bills', (select jsonb_agg(to_jsonb(b) order by b.bill_id) from processed_bills b), " +
        "'pending', (select jsonb_agg(to_jsonb(p) order by p.bill_id) from pending_analysis p))",
    );
  let readsBefore;
  let openBefore;

  function asRole(role, sql, setup = "") {
    return psql(url, `begin;\n${setup};\nset local role ${role};\n${sql};\nrollback;`);
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
    readsBefore = Object.fromEntries(READ_ROLES.map((role) => [role, reads(role)]));
    openBefore = asRole("anon", changed("update processed_bills set title = title"));
    for (const file of files.filter((file) => file >= MIGRATION)) {
      psql(url, readFileSync(path.join(SQL_DIR, file), "utf8"));
    }
  });

  afterAll(() => {
    psql(ADMIN_URL, `drop database if exists ${name} with (force)`);
  });

  it("starts with anon able to change rows, so the checks below can fail", () => {
    expect(openBefore).toBe("2");
    expect(JSON.parse(readsBefore.anon).bills).toHaveLength(2);
    expect(JSON.parse(readsBefore.anon).pending).toHaveLength(2);
  });

  it.each(READ_ROLES)("lets %s read what it read before", (role) => {
    expect(reads(role)).toBe(readsBefore[role]);
  });

  it("serves the bill activity feed's query to anon", () => {
    const rows = asRole(
      "anon",
      "select bill_number from processed_bills " +
        "where confidence_score > 19 and skipped_reason is null " +
        "order by last_action_date desc nulls last",
    );
    expect(rows.split("\n")).toEqual(["HB 2", "HB 1"]);
  });

  describe.each(READ_ROLES)("as %s", (role) => {
    const writes = {
      insert: "insert into processed_bills (bill_id) values (3)",
      update: "update processed_bills set title = 'changed'",
      delete: "delete from processed_bills",
      truncate: "truncate processed_bills",
    };

    it.each(Object.keys(writes))("refuses %s with no grant", (command) => {
      expect(() => asRole(role, writes[command])).toThrow(/42501: permission denied/);
    });

    it("changes nothing with a stray write grant", () => {
      const grant = `grant insert, update, delete on processed_bills to ${role}`;
      expect(asRole(role, changed(writes.update), grant)).toBe("0");
      expect(asRole(role, changed(writes.delete), grant)).toBe("0");
      expect(() => asRole(role, writes.insert, grant)).toThrow(/42501: new row violates row-level/);
    });

    it("refuses writes even if the table already holds an open policy", () => {
      const openPolicy = `
        create policy "Open" on processed_bills for all using (true) with check (true);
        ${migrationSql}`;
      expect(() => asRole(role, writes.update, openPolicy)).toThrow(/42501: permission denied/);
      expect(() => asRole(role, writes.delete, openPolicy)).toThrow(/42501: permission denied/);
      expect(() => asRole(role, writes.insert, openPolicy)).toThrow(/42501: permission denied/);
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
    expect(asRole("service_role", changed("insert into processed_bills (bill_id) values (3)"))).toBe("1");
    expect(asRole("service_role", changed("delete from processed_bills"))).toBe("2");
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
    for (const role of READ_ROLES) expect(reads(role)).toBe(readsBefore[role]);
  });
});
