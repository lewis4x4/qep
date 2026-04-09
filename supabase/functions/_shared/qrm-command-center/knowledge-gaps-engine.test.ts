/**
 * Knowledge Gaps + Absence Engine — unit tests.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildKnowledgeGapsPayload,
  type KnowledgeGapRow,
  type DealAbsenceRow,
} from "./knowledge-gaps-engine.ts";

function makeGap(overrides: Partial<KnowledgeGapRow> = {}): KnowledgeGapRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    question: overrides.question ?? "What is the parts markup policy?",
    frequency: overrides.frequency ?? 5,
    last_asked_at: overrides.last_asked_at ?? "2026-04-08T12:00:00Z",
    user_id: overrides.user_id ?? null,
    profiles: overrides.profiles ?? null,
  };
}

function makeDeal(overrides: Partial<DealAbsenceRow> = {}): DealAbsenceRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    assigned_rep_id: overrides.assigned_rep_id ?? "rep-1",
    // Use "in" check so explicit null overrides are preserved (not replaced by defaults)
    amount: "amount" in overrides ? (overrides.amount as number | null) : 100_000,
    expected_close_on: "expected_close_on" in overrides ? (overrides.expected_close_on as string | null) : "2026-05-01",
    primary_contact_id: "primary_contact_id" in overrides ? (overrides.primary_contact_id as string | null) : "contact-1",
    company_id: "company_id" in overrides ? (overrides.company_id as string | null) : "company-1",
    profiles: overrides.profiles ?? { full_name: "John Smith", iron_role: "iron_advisor" },
  };
}

// ─── Non-manager returns empty ─────────────────────────────────────────────

Deno.test("non-manager returns empty payload", () => {
  const result = buildKnowledgeGapsPayload([makeGap()], [makeDeal()], false);
  assertEquals(result.isManagerView, false);
  assertEquals(result.topGaps.length, 0);
  assertEquals(result.repAbsence.length, 0);
});

// ─── Knowledge gaps ────────────────────────────────────────────────────────

Deno.test("top gaps sorted by frequency descending", () => {
  const gaps = [
    makeGap({ question: "Q1", frequency: 3 }),
    makeGap({ question: "Q2", frequency: 12 }),
    makeGap({ question: "Q3", frequency: 7 }),
  ];
  const result = buildKnowledgeGapsPayload(gaps, [], true);
  assertEquals(result.topGaps.length, 3);
  assertEquals(result.topGaps[0].question, "Q2");
  assertEquals(result.topGaps[0].frequency, 12);
  assertEquals(result.topGaps[2].question, "Q1");
});

Deno.test("gaps limited to 10", () => {
  const gaps = Array.from({ length: 15 }, (_, i) => makeGap({ question: `Q${i}`, frequency: i }));
  const result = buildKnowledgeGapsPayload(gaps, [], true);
  assertEquals(result.topGaps.length, 10);
});

// ─── Rep absence scoring ───────────────────────────────────────────────────

Deno.test("rep with all fields populated scores 1.0", () => {
  const deals = [makeDeal({ assigned_rep_id: "rep-1" })]; // all fields present
  const result = buildKnowledgeGapsPayload([], deals, true);
  assertEquals(result.repAbsence.length, 1);
  assertEquals(result.repAbsence[0].absenceScore, 1);
  assertEquals(result.repAbsence[0].missingAmount, 0);
});

Deno.test("rep with all fields missing scores 0.0", () => {
  const deals = [makeDeal({
    assigned_rep_id: "rep-1",
    amount: null,
    expected_close_on: null,
    primary_contact_id: null,
    company_id: null,
  })];
  const result = buildKnowledgeGapsPayload([], deals, true);
  assertEquals(result.repAbsence[0].absenceScore, 0);
  assertEquals(result.repAbsence[0].missingAmount, 1);
  assertEquals(result.repAbsence[0].missingCloseDate, 1);
});

Deno.test("multiple reps sorted by worst data first", () => {
  const deals = [
    makeDeal({ assigned_rep_id: "rep-a", amount: null, profiles: { full_name: "Rep A", iron_role: "iron_advisor" } }),
    makeDeal({ assigned_rep_id: "rep-b", profiles: { full_name: "Rep B", iron_role: "iron_advisor" } }),
  ];
  const result = buildKnowledgeGapsPayload([], deals, true);
  assertEquals(result.repAbsence[0].repId, "rep-a"); // worse score first
  assertEquals(result.repAbsence[1].repId, "rep-b");
});

// ─── Worst fields ──────────────────────────────────────────────────────────

Deno.test("worst fields computed from all deals", () => {
  const deals = [
    makeDeal({ assigned_rep_id: "r1", amount: null, expected_close_on: null }),
    makeDeal({ assigned_rep_id: "r1", amount: null }),
    makeDeal({ assigned_rep_id: "r2" }), // all present
  ];
  const result = buildKnowledgeGapsPayload([], deals, true);
  // amount missing in 2 of 3 deals = 67%
  const amountGap = result.worstFields.find((f) => f.field === "amount");
  assertEquals(amountGap?.missingPct, 67);
});

// ─── Empty data ────────────────────────────────────────────────────────────

Deno.test("empty data returns empty payload with manager flag", () => {
  const result = buildKnowledgeGapsPayload([], [], true);
  assertEquals(result.isManagerView, true);
  assertEquals(result.topGaps.length, 0);
  assertEquals(result.repAbsence.length, 0);
  assertEquals(result.worstFields.length, 0);
});

Deno.test("null data returns empty payload", () => {
  const result = buildKnowledgeGapsPayload(null, null, true);
  assertEquals(result.topGaps.length, 0);
  assertEquals(result.repAbsence.length, 0);
});
