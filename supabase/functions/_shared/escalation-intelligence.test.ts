/**
 * Escalation intelligence — unit tests.
 *
 * Run with: deno test supabase/functions/_shared/escalation-intelligence.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveEscalationManager,
  scoreEscalationSeverity,
  suggestResolution,
} from "./escalation-intelligence.ts";

// ─── scoreEscalationSeverity ───────────────────────────────────────────────

Deno.test("severity: explicit high always wins", () => {
  const result = scoreEscalationSeverity({
    deal_amount: 500,
    issue_description: "minor cosmetic scratch",
    explicit: "high",
  });
  assertEquals(result, "high");
});

Deno.test("severity: high keyword lifts to high even for cheap deals", () => {
  const result = scoreEscalationSeverity({
    deal_amount: 5000,
    issue_description: "Machine has been down since yesterday",
  });
  assertEquals(result, "high");
});

Deno.test("severity: LTV threshold (>= $250k) = high", () => {
  const result = scoreEscalationSeverity({
    deal_amount: 300_000,
    issue_description: "running slow",
  });
  assertEquals(result, "high");
});

Deno.test("severity: medium keyword with mid-range deal = medium", () => {
  const result = scoreEscalationSeverity({
    deal_amount: 80_000,
    issue_description: "hydraulic leak showing up intermittently",
  });
  assertEquals(result, "medium");
});

Deno.test("severity: negative sentiment without keywords lifts to medium", () => {
  const result = scoreEscalationSeverity({
    deal_amount: 10_000,
    issue_description: "feedback from customer",
    sentiment: "negative",
  });
  assertEquals(result, "medium");
});

Deno.test("severity: small deal with neutral text defaults low", () => {
  const result = scoreEscalationSeverity({
    deal_amount: 5_000,
    issue_description: "General feedback",
  });
  assertEquals(result, "low");
});

Deno.test("severity: safety keyword always escalates", () => {
  const result = scoreEscalationSeverity({
    deal_amount: null,
    issue_description: "Operator said safety issue with the cab",
  });
  assertEquals(result, "high");
});

// ─── resolveEscalationManager ──────────────────────────────────────────────

const CANDIDATES = [
  { id: "u1", full_name: "Alex Admin", email: "alex@x.com", role: "admin" },
  { id: "u2", full_name: "Mia Manager", email: "mia@x.com", role: "manager", iron_role: "iron_manager" },
  { id: "u3", full_name: "Sam Service", email: "sam@x.com", role: "manager", department_match: true },
];

Deno.test("manager: explicit wins", () => {
  const result = resolveEscalationManager({
    explicit_name: "Pat Explicit",
    explicit_email: "pat@x.com",
    candidates: CANDIDATES,
  });
  assertEquals(result.reason, "explicit");
  assertEquals(result.name, "Pat Explicit");
});

Deno.test("manager: department match beats iron_manager", () => {
  const result = resolveEscalationManager({
    department: "Service",
    candidates: CANDIDATES,
  });
  assertEquals(result.reason, "department_match");
  assertEquals(result.user_id, "u3");
});

Deno.test("manager: iron_manager beats generic admin", () => {
  const result = resolveEscalationManager({
    department: "Service",
    candidates: CANDIDATES.filter((c) => !c.department_match),
  });
  assertEquals(result.reason, "iron_manager");
  assertEquals(result.user_id, "u2");
});

Deno.test("manager: admin fallback when no iron_manager exists", () => {
  const result = resolveEscalationManager({
    candidates: [CANDIDATES[0]],
  });
  assertEquals(result.reason, "workspace_admin");
  assertEquals(result.user_id, "u1");
});

Deno.test("manager: unknown when pool is empty", () => {
  const result = resolveEscalationManager({ candidates: [] });
  assertEquals(result.reason, "unknown");
  assertEquals(result.name, null);
});

// ─── suggestResolution ─────────────────────────────────────────────────────

Deno.test("resolution: machine-down triggers service dispatch template", () => {
  const r = suggestResolution({ issue_description: "Machine is down since morning", severity: "high" });
  assertEquals(r.includes("service technician"), true);
});

Deno.test("resolution: hydraulic leak gets hydraulic template", () => {
  const r = suggestResolution({ issue_description: "Slow hydraulic leak on boom", severity: "medium" });
  assertEquals(r.includes("hydraulic-system"), true);
});

Deno.test("resolution: parts backorder gets parts template", () => {
  const r = suggestResolution({ issue_description: "Waiting on parts for 10 days", severity: "medium" });
  assertEquals(r.includes("parts order"), true);
});

Deno.test("resolution: billing dispute gets A/R template", () => {
  const r = suggestResolution({ issue_description: "Invoice charge is wrong", severity: "medium" });
  assertEquals(r.includes("A/R"), true);
});

Deno.test("resolution: high severity without a pattern still gives a sharp default", () => {
  const r = suggestResolution({ issue_description: "Customer upset about attitude of mechanic", severity: "high" });
  assertEquals(r.includes("4 hours"), true);
});

Deno.test("resolution: low severity default", () => {
  const r = suggestResolution({ issue_description: "Asked about future model", severity: "low" });
  assertEquals(r.includes("1 business day"), true);
});
