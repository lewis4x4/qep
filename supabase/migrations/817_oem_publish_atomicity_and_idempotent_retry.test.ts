import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "817_oem_publish_atomicity_and_idempotent_retry.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(functionName: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("817 OEM publish atomicity and retry idempotency", () => {
  it("wraps every rename, revoke, wrapper, and grant in one migration transaction", () => {
    expect(compactSql.trim().startsWith("-- migration 817")).toBe(true);
    expect(compactSql).toContain("begin;");
    expect(compactSql.trim().endsWith("commit;")).toBe(true);
    expect(compactSql.indexOf("begin;")).toBeLessThan(
      compactSql.indexOf("rename to apply_qb_oem_reprice_draft_v813"),
    );
  });

  it("publishes the catalog and persists every event stream in one transaction", () => {
    const fn = functionSql("publish_and_persist_qb_oem_price_change_event");
    const lock = fn.indexOf("pg_advisory_xact_lock");
    const publish = fn.indexOf("public.publish_qb_price_sheet_atomic(");
    const persist = fn.indexOf("public.persist_qb_oem_price_change_event(");
    expect(fn).toContain("security definer set search_path = ''");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(lock);
    expect(persist).toBeGreaterThan(publish);
    expect(fn).toContain(
      "return v_event || jsonb_build_object('publish', v_publish)",
    );
    expect(compactSql).toContain(
      "grant execute on function public.publish_and_persist_qb_oem_price_change_event",
    );
  });

  it("keeps the v813 mutation bodies private behind stable public names", () => {
    expect(compactSql).toContain(
      "rename to apply_qb_oem_reprice_draft_v813",
    );
    expect(compactSql).toContain(
      "rename to reverse_qb_oem_reprice_apply_v813",
    );
    expect(compactSql).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(compactSql).not.toContain(
      "grant execute on function public.apply_qb_oem_reprice_draft_v813",
    );
    expect(compactSql).not.toContain(
      "grant execute on function public.reverse_qb_oem_reprice_apply_v813",
    );
  });

  it("resolves apply retries from immutable audit evidence before legacy validation", () => {
    const fn = functionSql("apply_qb_oem_reprice_draft");
    const auditRead = fn.indexOf("from public.qb_quote_reprice_audits audit");
    const legacyCall = fn.indexOf("public.apply_qb_oem_reprice_draft_v813(");
    expect(auditRead).toBeGreaterThanOrEqual(0);
    expect(legacyCall).toBeGreaterThan(auditRead);
    expect(fn).toContain("audit.draft_id = p_draft_id");
    expect(fn).toContain(
      "v_existing_audit.actor_id is distinct from p_actor_id",
    );
    expect(fn).toContain("'idempotent', true");
  });

  it("resolves reversal retries from immutable audit evidence before legacy validation", () => {
    const fn = functionSql("reverse_qb_oem_reprice_apply");
    const auditRead = fn.indexOf("from public.qb_quote_reprice_audits audit");
    const legacyCall = fn.indexOf("public.reverse_qb_oem_reprice_apply_v813(");
    expect(auditRead).toBeGreaterThanOrEqual(0);
    expect(legacyCall).toBeGreaterThan(auditRead);
    expect(fn).toContain("audit.apply_audit_id = p_apply_audit_id");
    expect(fn).toContain(
      "v_existing_audit.actor_id is distinct from p_actor_id",
    );
    expect(fn).toContain("'idempotent', true");
  });
});
