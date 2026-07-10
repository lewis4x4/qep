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
    for (const rpc of [
      "start_or_resume_rental_billing_run",
      "claim_rental_billing_batch",
      "post_rental_invoice_for_billing_item",
      "mirror_rental_invoice_for_billing_item",
      "complete_rental_billing_item",
      "finalize_rental_billing_run",
    ]) {
      expect(source).toContain(`admin.rpc`);
      expect(source).toContain(`"${rpc}"`);
    }
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
    expect(compact).toContain("return await finishrentalmirror(admin");
    expect(compact).toContain('status: "deferred"');
    expect(compact).toContain('admin.rpc("defer_rental_billing_mirror"');
    expect(compact).toContain('"attach_rental_invoice_to_billing_item"');
  });

  it("resumes crash-after-post mirror work before prior-invoice planning", () => {
    expect(compact).toContain(
      '.select("id, rental_invoice_id, billed_cents, tax_cents")',
    );
    const resume = compact.indexOf(
      "if (checkpoint?.rental_invoice_id) { return await finishrentalmirror",
    );
    const planning = compact.indexOf(
      "return await processcontract( admin, contract, runid",
    );
    expect(resume).toBeGreaterThan(0);
    expect(planning).toBeGreaterThan(resume);
  });

  it("submits the exact financial source snapshot for locked validation", () => {
    expect(compact).toContain("function buildbillingsourcesnapshot(");
    expect(compact).toContain("version: 2");
    expect(compact).toContain("billing_source_snapshot: billingsourcesnapshot");
    expect(compact).toContain("numbering_branch: numberingbranch");
    expect(compact).toContain("tax_resolution: taxresolution");
    expect(compact).toContain("tax.sourcesnapshot");
    expect(compact).toContain(
      '"id, period_end, rental_charge_cents, status, metadata"',
    );
    expect(compact).toContain(
      '"id, included_hours, outbound_meter_hours, return_meter_hours, overage_hourly_rate_cents"',
    );
    expect(compact).toContain('.order("id", { ascending: true })');
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
    expect(compact).toContain('.eq("workspace_id", workspaceid)');
    expect(compact).toContain("claims.map((claim) => claim.rental_contract_id");
  });
});
