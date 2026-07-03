import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText(
  "supabase",
  "migrations",
  "758_d37_d36_stream_k_roadmap_reconciliation.sql",
);
const sourceTruthSql = readText(
  "supabase",
  "migrations",
  "650_qep_phase_one_source_of_truth_streams_g_to_k.sql",
);
const pricingRuleset = readText("docs", "architecture", "parts-pricing-ruleset.md");
const pricingEngineSql = readText(
  "supabase",
  "migrations",
  "669_g81_parts_pricing_engine_counter_discount_cap.sql",
);
const workflowPacket = readText(
  "docs",
  "designs",
  "qep-parts-workflow-document-2026-05-29-review-candidate.md",
);
const financeArtifact = readText(
  "docs",
  "operations",
  "QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md",
);

const compactCloseout = compact(closeoutSql);
const compactSourceTruth = compact(sourceTruthSql);
const compactPricingRuleset = compact(pricingRuleset);
const compactPricingEngine = compact(pricingEngineSql);
const compactWorkflowPacket = compact(workflowPacket);
const compactFinanceArtifact = compact(financeArtifact);

describe("758_d37_d36_stream_k_roadmap_reconciliation.sql contract", () => {
  it("closes D3.7 with ruleset and migration 669 evidence only", () => {
    expect(compactCloseout).toContain("where task_id = 'd3.7'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("docs/architecture/parts-pricing-ruleset.md");
    expect(compactCloseout).toContain(
      "669_g81_parts_pricing_engine_counter_discount_cap.sql",
    );
    expect(compactCloseout).toContain("deferred extensions remain open");
    expect(compactCloseout).toContain("does not close freight");
    expect(compactCloseout).toContain("does not close controller signoff");

    expect(compactPricingRuleset).toContain("roadmap: d3.7 / qep-101");
    expect(compactPricingRuleset).toContain("counter_discount_cap_pct = 5");
    expect(compactPricingRuleset).toContain("deferred extensions");
    expect(compactPricingEngine).toContain("'counter_discount_cap_pct', 5");
    expect(compactPricingEngine).toContain("where task_id = 'g8.1'");
  });

  it("keeps D3.6 owner-review gated and refreshes the packet language", () => {
    expect(compactCloseout).toContain("where task_id = 'd3.6'");
    expect(compactCloseout).toContain("ship_state = 'pending_decision'");
    expect(compactCloseout).toContain("blk-parts-wf-owner-review");
    expect(compactCloseout).toContain("does not mark d3.6 shipped");
    expect(compactCloseout).toContain("requires juan + norman validation");

    expect(compactWorkflowPacket).toContain("2026-07-03 owner-review gate");
    expect(compactWorkflowPacket).toContain(
      "no source-controlled juan + norman signed v1",
    );
    expect(compactWorkflowPacket).toContain("must not be marked shipped");
  });

  it("reconciles Stream K without hard-coding open finance values", () => {
    expect(compactCloseout).toContain("where task_id = 'k1.1'");
    expect(compactCloseout).toContain("ship_state = 'not_started'");
    expect(compactCloseout).toContain("k1.1 unblocked");
    expect(compactCloseout).toContain("do not hard-code");

    expect(compactCloseout).toContain("where task_id = 'k3.1'");
    expect(compactCloseout).toContain("blk-fin-migration-path");
    expect(compactCloseout).toContain("does not mark k3.1 shipped");
    expect(compactCloseout).toContain("quickbooks-as-ledger is no longer an open question");

    expect(compactCloseout).toContain("where task_id = 'k4.1'");
    expect(compactCloseout).toContain("k4.1 shipped");
    expect(compactCloseout).toContain("build-lock memo g5 is reconciled");

    expect(compactFinanceArtifact).toContain("qep os is the forward accounting system of record");
    expect(compactFinanceArtifact).toContain("k1.1 can move forward as implementation work");
    expect(compactFinanceArtifact).toContain("k3.1 stays open");
    expect(compactFinanceArtifact).toContain("k4.1 has its decision evidence");
  });

  it("updates the Stream K source-truth seed to match the reconciliation", () => {
    expect(compactSourceTruth).toContain("2026-07-03 reconciliation");
    expect(compactSourceTruth).toContain(
      "docs/operations/qep_finance_k_stream_decision_artifact_2026-07-03.md",
    );
    expect(compactSourceTruth).toContain("'not_started', 'engineer'");
    expect(compactSourceTruth).toContain("blk-fin-migration-path");
    expect(compactSourceTruth).toContain("'shipped', 'architect'");
    expect(compactSourceTruth).toContain("remaining open finance values must stay parameterized");
  });

  it("does not touch D3.12 / CYBER-INS and keeps K2.1 gated", () => {
    expect(compactCloseout).not.toContain("where task_id = 'd3.12'");
    expect(compactCloseout).not.toContain("where code = 'cyber-ins'");
    expect(compactSourceTruth).toContain("('k2.1', 'k', 'k2'");
    expect(compactSourceTruth).toContain("'blk-fin-working-session'");
  });
});
