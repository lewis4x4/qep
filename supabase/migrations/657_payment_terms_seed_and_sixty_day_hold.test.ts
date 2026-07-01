import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "657_payment_terms_seed_and_sixty_day_hold.sql",
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
  return match?.[0] ?? "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("657_payment_terms_seed_and_sixty_day_hold.sql contract", () => {
  it("wraps the slice in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });

  it("seeds the canonical payment terms idempotently for the default workspace", () => {
    expect(compactSql).toContain("insert into public.payment_terms");
    // Net 30 is the house default with a 30-day net window.
    expect(compactSql).toContain("('default', 'net30', 'net 30', 30");
    // Full canonical catalogue is present.
    expect(compactSql).toContain("'net15'");
    expect(compactSql).toContain("'net45'");
    expect(compactSql).toContain("'net60'");
    expect(compactSql).toContain("'cod'");
    expect(compactSql).toContain("'prepaid'");
    expect(compactSql).toContain("'due_on_receipt'");
  });

  it("upserts on the (workspace_id, code) unique key rather than duplicating", () => {
    expect(compactSql).toContain("on conflict (workspace_id, code) do update");
    expect(compactSql).toContain("set name          = excluded.name".replace(/\s+/g, " "));
    expect(compactSql).toContain("net_days      = excluded.net_days".replace(/\s+/g, " "));
  });

  it("does not hardcode Net 45 customer assignments (deferred to Round 2)", () => {
    // Net 45 exists as a catalogue row but must not be stamped onto any company.
    expect(compactSql).not.toContain("set payment_terms_id = ");
    expect(compactSql).toContain("net 45 assignments");
  });

  it("exposes a NET30 default resolver and fills it only when unset", () => {
    const resolver = compact(functionSql("default_payment_terms_id"));
    expect(resolver).toContain("code = 'net30'");
    expect(resolver).toContain("active = true");

    const trg = compact(functionSql("trg_set_qrm_company_default_payment_terms"));
    // Per-customer override is preserved: only backfill when null.
    expect(trg).toContain("if new.payment_terms_id is null then");
    expect(trg).toContain("public.default_payment_terms_id(new.workspace_id)");
  });

  it("installs a BEFORE INSERT default-terms trigger on qrm_companies", () => {
    expect(compactSql).toContain(
      "create trigger set_qrm_company_default_payment_terms before insert on public.qrm_companies",
    );
  });

  it("enforces the 60-day auto-hold window against invoice due dates", () => {
    const fn = compact(functionSql("evaluate_credit_holds"));
    expect(fn).toContain("interval '60 days'");
    expect(fn).toContain("ci.due_date < (now() - interval '60 days')");
    expect(fn).toContain("ci.status not in ('paid', 'void', 'reversed')");
    expect(fn).toContain("ci.balance_due > 0");
    expect(fn).toContain("credit_hold        = true".replace(/\s+/g, " "));
    expect(fn).toContain("auto: invoice 60+ days past due");
  });

  it("only auto-releases AUTO holds and leaves manual holds intact", () => {
    const fn = compact(functionSql("evaluate_credit_holds"));
    expect(fn).toContain("credit_hold_reason like 'auto:%'");
    expect(fn).toContain("credit_hold        = false".replace(/\s+/g, " "));
    expect(fn).toContain("c.id not in (select crm_company_id from past_due)");
  });

  it("is a security-definer function with a pinned search_path", () => {
    const fn = compact(functionSql("evaluate_credit_holds"));
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    expect(fn).toContain("returns integer");
  });

  it("provides a boolean credit-hold helper", () => {
    const fn = compact(functionSql("is_customer_on_credit_hold"));
    expect(fn).toContain("returns boolean");
    expect(fn).toContain("c.credit_hold");
  });

  it("guards new-order creation by raising when the customer is on hold", () => {
    const fn = compact(functionSql("assert_customer_not_on_hold"));
    expect(fn).toContain("returns void");
    expect(fn).toContain("if coalesce(v_on_hold, false) then");
    expect(fn).toContain("raise exception");
    expect(fn).toContain("is on credit hold and cannot place new orders");
  });
});
