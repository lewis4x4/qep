import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/825_owner_answer_source_truth_reconciliation.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("825 owner-answer source-truth reconciliation", () => {
  it("ingests the complete non-parts owner packet", () => {
    for (const code of [
      "F1",
      "F12",
      "SV1",
      "SV20",
      "RN1",
      "RN10",
      "SA1",
      "SA10",
    ]) {
      expect(sql).toContain(`\"code\":\"${code}\"`);
    }
    expect(compact).not.toContain('"code":"p1"');
  });

  it("keeps unresolved values open instead of inventing them", () => {
    for (const code of ["F4", "SV9", "SV15", "SV19"]) {
      expect(sql).toContain(`\"code\":\"${code}\"`);
    }
    expect(compact).toContain("blk-fin-lender-schedules");
    expect(compact).toContain("blk-service-retail-haul-rates");
    expect(compact).toContain("blk-service-roster");
    expect(compact).toContain("blk-grapple-metrics");
    expect(compact).toContain("blk-rental-tax-certs");
  });

  it("records every explicit sales-decision reversal", () => {
    for (const marker of [
      "rep_choice_default_return_to_rep",
      "allow_convert_at_acceptance",
      "'per_oem'",
      "'both'",
      "'briefing_deals_followups'",
      "'collapse'",
    ]) {
      expect(compact).toContain(marker);
    }
    expect(compact).toContain("prior answers remain preserved");
    expect(compact).toContain("qep_decision_precedents");
  });

  it("corrects the system-of-record and QuickBooks wording", () => {
    expect(compact).toContain(
      "quickbooks desktop check-register + cpa-reporting feed / migration path",
    );
    expect(compact).toContain(
      "qep os is the forward accounting system of record",
    );
    expect(compact).toContain("intellidealer is the transition sor");
  });

  it("reopens implementation work and preserves external blockers", () => {
    expect(compact).toContain("where task_id = 'a4.2'");
    expect(compact).toContain("where task_id = 'a4.5'");
    expect(compact).toContain("where task_id = 'b1.1'");
    expect(compact).toContain("where task_id = 'b1.3'");
    expect(compact).toContain("'l12.1', 'l', 'l12'");
    expect(compact).toContain("'k3.2', 'k', 'k3'");
  });

  it("marks substantive roadmap changes for the Linear mirror", () => {
    expect(compact).toContain("insert into public.qep_roadmap_sync_events");
    expect(compact).toContain("2026_07_20_owner_answer_packet");
    expect(compact).toContain("mission_alignment");
  });
});
