import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "scripts", "rental", "rental-billing-load-test.mjs"),
  "utf8",
);
const compact = source.replace(/\s+/g, " ").toLowerCase();

describe("rental billing production-shaped load harness", () => {
  it("rediscovers fixture contracts after an interrupted soft-delete cleanup", () => {
    const cohortSource =
      source.match(/async function cohort\(runId\)[\s\S]*?\n}\n/)?.[0] ?? "";
    expect(cohortSource).toContain(
      '.like("dealer_notes", `LOADTEST:${runId}:%`)',
    );
    expect(cohortSource).not.toContain('.is("deleted_at", null)');
  });

  it("defaults to a cohort above the former 500-contract ceiling", () => {
    expect(compact).toContain(
      'case "seed": await seed(number(process.argv[3] ?? 625))',
    );
    expect(compact).toContain("drain acceptance requires >500 contracts");
  });

  it("drains with bounded concurrent HTTP workers and disables auto-fanout", () => {
    expect(compact).toContain("const workers = math.max(1, math.min(8");
    expect(compact).toContain("await promise.all(");
    expect(compact).toContain("array.from({ length: workers }");
    expect(compact).toContain("contract_ids: ids");
    expect(compact).toContain("auto_continue: false");
    expect(compact).toContain("round > 200");
  });

  it("captures before/after throughput and terminal checkpoint evidence", () => {
    expect(compact).toContain("legacy_baseline_ms_per_contract = 250");
    expect(compact).toContain("speedup_vs_legacy");
    expect(compact).toContain("request_p50_ms");
    expect(compact).toContain("request_p95_ms");
    expect(compact).toContain("billing_drain_complete");
    expect(compact).toContain("await tagbillingrunforcleanup(billingrunid, runid)");
    expect(compact).toContain("load_test_cohort_id: cohortrunid");
  });

  it("replays the completed run and requires zero claims and zero new invoices", () => {
    expect(compact).toContain("replay.payload.batch?.claimed === 0");
    expect(compact).toContain(
      "invoicesbeforereplay.length === invoicesafterreplay.length",
    );
  });

  it("removes the complete AR/GL mirror graph and verifies cleanup", () => {
    expect(source).toMatch(
      /\.from\("customer_invoice_line_items"\)\s*\.delete\(\)/,
    );
    expect(source).toMatch(/\.from\("customer_invoices"\)\s*\.delete\(\)/);
    expect(source).toMatch(
      /\.from\("quickbooks_gl_sync_jobs"\)\s*\.delete\(\)/,
    );
    expect(compact).toContain("load cleanup blocked:");
    expect(compact).toContain(
      "reached quickbooks; reverse them before retrying cleanup",
    );
    expect(compact).toContain("load cleanup ar verification");
    expect(compact).toContain("load cleanup gl verification");
    expect(compact).toContain(
      "load cleanup verification found residual ar/gl rows",
    );
  });

  it("removes and verifies all fixture checkpoints, run headers, and exceptions", () => {
    expect(compact).toContain('"load cleanup run ownership guard"');
    expect(compact).toContain('"load cleanup tagged-run lookup"');
    expect(compact).toContain(
      '.contains("metadata", { load_test_cohort_id: runid })',
    );
    expect(compact).toContain(
      "billing item(s) belong to non-fixture contracts",
    );
    expect(compact).toContain('.eq("entity_table", "rental_contracts")');
    expect(compact).toContain('.eq("entity_table", "rental_invoices")');
    expect(source).toMatch(
      /\.from\("rental_billing_run_items"\)\s*\.delete\(\)/,
    );
    expect(source).toMatch(/\.from\("rental_billing_runs"\)\s*\.delete\(\)/);
    expect(compact).toContain("load cleanup billing-item verification");
    expect(compact).toContain("load cleanup billing-run verification");
    expect(compact).toContain("load cleanup contract exception verification");
    expect(compact).toContain("load cleanup invoice exception verification");
  });
});
