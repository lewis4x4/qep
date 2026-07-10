import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/819_rental_worldclass_desk_money.sql"),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("819 rental world-class desk money", () => {
  it("expands deposit_status for applied and refund paths", () => {
    expect(compact).toContain("applied");
    expect(compact).toContain("refund_due");
    expect(compact).toContain("refunded");
    expect(compact).toContain("partially_applied");
    expect(compact).toContain("drop constraint if exists rental_contracts_deposit_status_check");
  });

  it("closes returned contracts only after a posted final invoice", () => {
    expect(compact).toContain("create or replace function public.rental_close_contract");
    expect(compact).toContain("metadata->>'kind'");
    expect(compact).toContain("'final'");
    expect(compact).toContain("lifecycle_state is distinct from 'returned'");
    expect(compact).toContain("hard close requires a reason");
    expect(compact).toContain("grant execute on function public.rental_close_contract");
  });
});
