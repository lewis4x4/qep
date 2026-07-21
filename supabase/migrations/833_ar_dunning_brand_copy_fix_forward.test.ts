import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/833_ar_dunning_brand_copy_fix_forward.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("833 AR dunning brand-copy fix-forward", () => {
  it("rewrites the live function instead of modifying migration 828", () => {
    expect(compact).toContain(
      "to_regprocedure( 'public.run_ar_dunning_cycle(text,date)' )",
    );
    expect(compact).toContain("pg_get_functiondef(proc.oid)");
    expect(compact).toContain("execute v_updated_definition");
    expect(compact).toContain("expected 2 placeholders");
    expect(compact).toContain("expected 4 placeholders");
  });

  it("uses clear event-specific and invoice copy", () => {
    for (const copy of [
      "Account statement generated",
      "Monthly finance charge assessed",
      "Monthly finance charge",
      "Past-due payment reminder queued",
      "Credit hold applied for past-due balance",
    ]) {
      expect(sql).toContain(copy);
    }
  });

  it("preserves function ownership, ACL, and security properties", () => {
    for (const property of [
      "proc.proowner",
      "proc.proacl",
      "proc.proconfig",
      "proc.prosecdef",
      "proc.proleakproof",
      "proc.provolatile",
      "proc.proparallel",
    ]) {
      expect(compact).toContain(property);
    }
    expect(compact).toContain(
      "run_ar_dunning_cycle must remain security definer",
    );
    expect(compact).toContain(
      "ownership, grants, or security settings changed during copy repair",
    );
    expect(compact).not.toContain("drop function");
  });

  it("repairs known columns across all workspaces without deleting evidence", () => {
    expect(compact).toContain("update public.ar_dunning_events");
    expect(compact).toContain("update public.customer_invoices");
    expect(compact).toContain("update public.customer_invoice_line_items");
    expect(compact).not.toContain("where workspace_id =");
    expect(compact).not.toContain("delete from");
    expect(compact).not.toContain("truncate table");
  });

  it("fails if the live definition or repaired rows retain placeholder text", () => {
    expect(compact).toContain(
      "live run_ar_dunning_cycle definition retains temporary brand copy",
    );
    expect(compact).toContain("ar dunning event copy repair is incomplete");
    expect(compact).toContain(
      "finance-charge invoice copy repair is incomplete",
    );
    expect(compact).toContain("finance-charge line copy repair is incomplete");
  });
});
