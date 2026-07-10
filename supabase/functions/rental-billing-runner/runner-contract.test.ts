import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "functions",
    "rental-billing-runner",
    "index.ts",
  ),
  "utf8",
);
const compact = source.replace(/\s+/g, " ").toLowerCase();

describe("rental billing runner durable protocol wiring", () => {
  it("uses durable start/claim/complete/finalize RPCs and no fleet limit", () => {
    expect(compact).toContain(
      'admin.rpc( "start_or_resume_rental_billing_run"',
    );
    expect(compact).toContain('admin.rpc( "claim_rental_billing_batch"');
    expect(compact).toContain(
      'admin.rpc( "post_rental_invoice_for_billing_item"',
    );
    expect(compact).toContain('admin.rpc("complete_rental_billing_item"');
    expect(compact).toContain('admin.rpc( "finalize_rental_billing_run"');
    expect(compact).not.toContain(".limit(500)");
  });

  it("processes a bounded claimed cohort concurrently and continues partial work", () => {
    expect(compact).toContain("mapwithconcurrency(");
    expect(compact).toContain(
      "const batchsize = clampinteger(body.batch_size, 25, 1, 100)",
    );
    expect(compact).toContain(
      "const concurrency = clampinteger(body.concurrency, 4, 1, 8)",
    );
    expect(compact).toContain(
      "totals.claimable_count > 0 ? schedulecontinuation",
    );
    expect(compact).toContain('protocol: "durable_batch_v1"');
  });

  it("treats a concurrent unique winner as an idempotent skip", () => {
    expect(compact).toContain('invoiceerror?.code === "23505"');
    expect(compact).toContain(
      'reason: "concurrent worker won contract period"',
    );
    expect(compact).toContain('.not("status", "in", "(void,reversed)")');
  });

  it("recovers an invoice committed by the same run after a lost checkpoint", () => {
    expect(compact).toContain(
      '"id, rental_billing_run_id, taxable_amount_cents, tax_cents, total_cents, customer_invoice_id"',
    );
    expect(compact).toContain('"post_rental_invoice_for_billing_item"');
    expect(compact).toContain("existing.rental_billing_run_id === runid");
    expect(compact).toContain("winner.rental_billing_run_id === runid");
    expect(compact).toContain("mirror_skipped: existing.customer_invoice_id == null");
    expect(compact).toContain("mirror_skipped: winner.customer_invoice_id == null");
  });

  it("dead-letters one poison contract without aborting later results", () => {
    expect(compact).toContain('p_source: "rental_billing_failed"');
    expect(compact).toContain('status: "failed", reason: detail');
    expect(compact).toContain(
      "for (let index = 0; index < claims.length; index++)",
    );
  });

  it("keeps every contract fetch and money lookup workspace scoped", () => {
    expect(
      source.match(/\.eq\("workspace_id", contract\.workspace_id\)/g)?.length ??
        0,
    )
      .toBeGreaterThanOrEqual(4);
    expect(compact).toContain(
      '.eq("workspace_id", workspaceid) .in("id", claims.map',
    );
  });
});
