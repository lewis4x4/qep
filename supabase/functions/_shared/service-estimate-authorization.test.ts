import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateEstimateAuthorizationGate,
  evaluateScopeIncrease,
  normalizeEstimateApprovalKind,
} from "./service-estimate-authorization.ts";

Deno.test("H3 gate allows legacy jobs explicitly marked not required", () => {
  const result = evaluateEstimateAuthorizationGate({
    authorizationRequired: false,
    authorizationStatus: "not_required",
    approvedAmount: null,
  });

  assertEquals(result.ok, true);
  assertEquals(result.code, "estimate_authorization_not_required");
});

Deno.test("H3 gate blocks repair work without an approved estimate", () => {
  const result = evaluateEstimateAuthorizationGate({
    authorizationRequired: true,
    authorizationStatus: "pending",
    approvedAmount: null,
  });

  assertEquals(result.ok, false);
  assertEquals(result.code, "estimate_approval_required");
  assert(result.reason.includes("documented approved estimate"));
});

Deno.test("H3 gate allows repair work when approved estimate baseline exists", () => {
  const result = evaluateEstimateAuthorizationGate({
    authorizationRequired: true,
    authorizationStatus: "approved",
    approvedAmount: 1000,
    approvedQuoteId: "quote-1",
    approvedApprovalId: "approval-1",
    thresholdPct: 10,
    scopeEstimateAmount: 1099.99,
  });

  assertEquals(result.ok, true);
  assertEquals(result.code, "estimate_authorization_approved");
  assertEquals(result.approvedAmount, 1000);
  assertEquals(result.thresholdAmount, 1100);
});

Deno.test("H3 gate blocks approved state without documented approval ids", () => {
  const result = evaluateEstimateAuthorizationGate({
    authorizationRequired: true,
    authorizationStatus: "approved",
    approvedAmount: 1000,
    thresholdPct: 10,
    scopeEstimateAmount: 1000,
  });

  assertEquals(result.ok, false);
  assertEquals(result.code, "estimate_approval_required");
  assertEquals(result.documentedApproval, false);
});

Deno.test("H3 gate blocks work when scope estimate is more than 10% over baseline", () => {
  const result = evaluateEstimateAuthorizationGate({
    authorizationRequired: true,
    authorizationStatus: "approved",
    approvedAmount: 1000,
    approvedQuoteId: "quote-1",
    approvedApprovalId: "approval-1",
    thresholdPct: 10,
    scopeEstimateAmount: 1100.01,
  });

  assertEquals(result.ok, false);
  assertEquals(result.code, "estimate_reauthorization_required");
  assertEquals(result.thresholdAmount, 1100);
  assertEquals(result.scopeIncreasePct, 10.001);
});

Deno.test("H3 scope math treats exactly 10% as allowed and greater than 10% as re-auth", () => {
  const exactly = evaluateScopeIncrease({
    approvedAmount: 2500,
    proposedAmount: 2750,
    thresholdPct: 10,
  });
  const over = evaluateScopeIncrease({
    approvedAmount: 2500,
    proposedAmount: 2750.01,
    thresholdPct: 10,
  });

  assertEquals(exactly.requiresReauthorization, false);
  assertEquals(exactly.thresholdAmount, 2750);
  assertEquals(over.requiresReauthorization, true);
});

Deno.test("H3 approval kind accepts only initial estimate or scope reauthorization", () => {
  assertEquals(
    normalizeEstimateApprovalKind("initial_estimate"),
    "initial_estimate",
  );
  assertEquals(
    normalizeEstimateApprovalKind("scope_increase_reauthorization"),
    "scope_increase_reauthorization",
  );
  assertEquals(normalizeEstimateApprovalKind("portal_signature"), null);
});
