import { assertEquals } from "jsr:@std/assert@1";
import {
  recommendMovesFromSignals,
  type RecommenderSignal,
} from "./qrm-recommender.ts";

function makeSignal(overrides: Partial<RecommenderSignal> & {
  kind: RecommenderSignal["kind"];
}): RecommenderSignal {
  return {
    id: "sig-1",
    workspace_id: "ws-1",
    severity: "medium",
    source: "crm",
    title: "Test signal",
    description: null,
    entity_type: "deal",
    entity_id: "d-1",
    assigned_rep_id: "rep-1",
    occurred_at: "2026-04-20T00:00:00Z",
    suppressed_until: null,
    payload: {},
    ...overrides,
  };
}

Deno.test("recommender turns inbound_email into a call_now move", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({
      kind: "inbound_email",
      severity: "high",
      title: "Jane @ Acme replied to your quote",
    }),
  ]);

  assertEquals(moves.length, 1);
  assertEquals(moves[0].kind, "call_now");
  // Inbound email base 92 + high severity boost +5 = 97, clamped to 100 on
  // critical / boost above 100. high boost is +5 → priority 97.
  assertEquals(moves[0].priority, 97);
  assertEquals(moves[0].confidence, 0.85);
  assertEquals(moves[0].entityType, "deal");
  assertEquals(moves[0].entityId, "d-1");
  assertEquals(moves[0].assignedRepId, "rep-1");
  assertEquals(moves[0].signalIds, ["sig-1"]);
  assertEquals(moves[0].recommender, "deterministic");
  assertEquals(moves[0].recommenderVersion, "deterministic-v1");
  assertEquals(moves[0].ruleId, "inbound_email_call_now");
});

Deno.test("recommender turns sla_breach (critical) into call_now with boosted priority", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({
      kind: "sla_breach",
      severity: "critical",
      description: "Response SLA was breached 3h ago",
    }),
  ]);

  assertEquals(moves[0].kind, "call_now");
  // sla_breach base 90 + critical boost +10 = 100
  assertEquals(moves[0].priority, 100);
  assertEquals(moves[0].confidence, 0.95);
  assertEquals(moves[0].rationale, "Response SLA was breached 3h ago");
});

Deno.test("recommender turns quote_viewed into call_now", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "quote_viewed", severity: "medium" }),
  ]);
  assertEquals(moves[0].kind, "call_now");
  assertEquals(moves[0].priority, 88);
});

Deno.test("recommender turns credit_declined into rescue_offer", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "credit_declined", severity: "high" }),
  ]);
  assertEquals(moves[0].kind, "rescue_offer");
  assertEquals(moves[0].priority, 83); // 78 + 5 high boost
});

Deno.test("recommender turns telematics_fault into service_escalate", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({
      kind: "telematics_fault",
      severity: "high",
      entity_type: "equipment",
      entity_id: "e-1",
    }),
  ]);
  assertEquals(moves[0].kind, "service_escalate");
  assertEquals(moves[0].entityType, "equipment");
  assertEquals(moves[0].entityId, "e-1");
});

Deno.test("recommender turns competitor_mention into rescue_offer", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "competitor_mention", severity: "high" }),
  ]);
  assertEquals(moves[0].kind, "rescue_offer");
});

Deno.test("recommender skips signals suppressed into the future", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "inbound_email", suppressed_until: future }),
  ]);
  assertEquals(moves.length, 0);
});

Deno.test("recommender processes signals whose suppression has elapsed", () => {
  const past = new Date(Date.now() - 1_000).toISOString();
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "inbound_email", suppressed_until: past }),
  ]);
  assertEquals(moves.length, 1);
});

Deno.test("recommender respects severityAtLeast on stage_change (low severity filtered out)", () => {
  // stage_change rule requires severity >= high. A medium-severity stage_change
  // should produce no move.
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "stage_change", severity: "medium" }),
  ]);
  assertEquals(moves.length, 0);
});

Deno.test("recommender fires stage_change escalate when severity >= high", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "stage_change", severity: "high" }),
  ]);
  assertEquals(moves.length, 1);
  assertEquals(moves[0].kind, "escalate");
});

Deno.test("recommender stamps workspace, rule id, and source signal on every move", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "deposit_received", severity: "medium", id: "sig-42", workspace_id: "ws-42" }),
  ]);
  assertEquals(moves[0].workspaceId, "ws-42");
  assertEquals(moves[0].sourceSignalId, "sig-42");
  assertEquals(moves[0].ruleId, "deposit_received_schedule");
  assertEquals(moves[0].payload?.signal_kind, "deposit_received");
  assertEquals(moves[0].payload?.rule_id, "deposit_received_schedule");
});

Deno.test("recommender processes a batch and preserves input order", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ id: "a", kind: "inbound_email", severity: "high" }),
    makeSignal({ id: "b", kind: "quote_viewed", severity: "medium" }),
    makeSignal({ id: "c", kind: "credit_approved", severity: "high" }),
  ]);
  assertEquals(moves.length, 3);
  assertEquals(moves[0].sourceSignalId, "a");
  assertEquals(moves[1].sourceSignalId, "b");
  assertEquals(moves[2].sourceSignalId, "c");
});

Deno.test("recommender priority boosts: critical +10, high +5, low -10", () => {
  const base = 70; // sla_warning base
  const mediumMoves = recommendMovesFromSignals([
    makeSignal({ kind: "sla_warning", severity: "medium" }),
  ]);
  const highMoves = recommendMovesFromSignals([
    makeSignal({ kind: "sla_warning", severity: "high" }),
  ]);
  const lowMoves = recommendMovesFromSignals([
    makeSignal({ kind: "sla_warning", severity: "low" }),
  ]);
  assertEquals(mediumMoves[0].priority, base);
  assertEquals(highMoves[0].priority, base + 5);
  assertEquals(lowMoves[0].priority, base - 10);
});

Deno.test("recommender kinds not in ruleset produce zero moves", () => {
  const moves = recommendMovesFromSignals([
    makeSignal({ kind: "other", severity: "high" }),
  ]);
  assertEquals(moves.length, 0);
});

Deno.test("recommender ignores signals with future suppression using injected now", () => {
  // Pin "now" to a fixed time, use a suppressed_until just after it.
  const fakeNow = "2026-04-20T10:00:00Z";
  const stillSuppressed = "2026-04-20T11:00:00Z";
  const expired = "2026-04-20T09:00:00Z";

  const suppressed = recommendMovesFromSignals(
    [makeSignal({ kind: "inbound_email", suppressed_until: stillSuppressed })],
    { now: fakeNow },
  );
  assertEquals(suppressed.length, 0);

  const passed = recommendMovesFromSignals(
    [makeSignal({ kind: "inbound_email", suppressed_until: expired })],
    { now: fakeNow },
  );
  assertEquals(passed.length, 1);
});
