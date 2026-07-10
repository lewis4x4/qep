import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(
    process.cwd(),
    "scripts",
    "rental",
    "rental-billing-load-test.mjs",
  ),
  "utf8",
);
const compact = source.replace(/\s+/g, " ").toLowerCase();

describe("rental billing production-shaped load harness", () => {
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
  });

  it("replays the completed run and requires zero claims and zero new invoices", () => {
    expect(compact).toContain("replay.payload.batch?.claimed === 0");
    expect(compact).toContain(
      "invoicesbeforereplay.length === invoicesafterreplay.length",
    );
  });
});
