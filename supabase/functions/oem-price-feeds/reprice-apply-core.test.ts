// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertInstanceOf } from "jsr:@std/assert@1";
import approvedFixture from "./fixtures/reprice-apply-approved.json" with {
  type: "json",
};
import {
  type ApplyMutationPlan,
  type ApplyRepriceInput,
  computeCanonicalQuoteTotals,
  isCustomerPriceLockActive,
  type PersistedQuoteTotals,
  planRepriceApply,
  planRepriceReversal,
  REPRICE_REVERSAL_WINDOW_MS,
  RepricePolicyError,
  type RepricePolicyErrorCode,
  type ReversalMutationPlan,
  type ReverseRepriceInput,
  type StoredApplyAudit,
  type StoredReversalAudit,
} from "./reprice-apply-core.ts";

function inputFixture(): ApplyRepriceInput {
  return structuredClone(approvedFixture) as unknown as ApplyRepriceInput;
}

function expectPolicyError(
  code: RepricePolicyErrorCode,
  fn: () => unknown,
): RepricePolicyError {
  try {
    fn();
  } catch (error) {
    assertInstanceOf(error, RepricePolicyError);
    assertEquals(error.code, code);
    return error;
  }
  throw new Error(`Expected RepricePolicyError(${code})`);
}

function requireApplyPlan(input = inputFixture()): ApplyMutationPlan {
  const result = planRepriceApply(input);
  assertEquals(result.kind, "apply");
  return result as ApplyMutationPlan;
}

function persistedFromPlan(plan: ApplyMutationPlan): PersistedQuoteTotals {
  const { dealerCostCents: _dealerCostCents, ...persisted } = plan.nextTotals;
  return persisted;
}

function storedApplication(
  plan: ApplyMutationPlan,
  overrides: Partial<StoredApplyAudit> = {},
): StoredApplyAudit {
  return {
    id: "apply-audit-1",
    workspaceId: plan.audit.workspaceId,
    quotePackageId: plan.audit.quotePackageId,
    draftId: plan.audit.source.draftId,
    idempotencyKey: plan.idempotencyKey,
    appliedAt: plan.audit.occurredAt,
    reversedAt: null,
    payload: plan.audit,
    ...overrides,
  };
}

function reversalInput(
  applyInput = inputFixture(),
): { input: ReverseRepriceInput; application: StoredApplyAudit } {
  const plan = requireApplyPlan(applyInput);
  const changedById = new Map(
    plan.lineMutations.map((
      line,
    ) => [line.quoteLineId, line.nextUnitPriceCents]),
  );
  const application = storedApplication(plan);
  return {
    application,
    input: {
      now: "2026-07-10T12:00:00.000Z",
      actor: structuredClone(applyInput.actor),
      quote: {
        ...structuredClone(applyInput.quote),
        updatedAt: plan.audit.after.quoteVersion.updatedAt,
        versionId: plan.audit.after.quoteVersion.id,
        versionNumber: plan.audit.after.quoteVersion.versionNumber,
        lines: applyInput.quote.lines.map((line) => ({
          ...structuredClone(line),
          unitPriceCents: changedById.get(line.id) ?? line.unitPriceCents,
        })),
        persistedTotals: persistedFromPlan(plan),
      },
      application,
      resultQuoteVersion: {
        id: "quote-version-9",
        versionNumber: 9,
      },
    },
  };
}

Deno.test("canonical financials mirror quote totals in cents", () => {
  const input = inputFixture();
  const totals = computeCanonicalQuoteTotals(
    input.quote.lines,
    input.quote.pricing,
  );
  assertEquals(totals, {
    equipmentTotalCents: 3_000_000,
    attachmentTotalCents: 100_000,
    subtotalCents: 3_100_000,
    discountTotalCents: 205_000,
    tradeCreditCents: 100_000,
    netTotalCents: 2_795_000,
    taxTotalCents: 200_000,
    customerTotalCents: 2_995_000,
    cashDownCents: 500_000,
    amountFinancedCents: 2_495_000,
    dealerCostCents: 2_385_000,
    marginAmountCents: 410_000,
    marginPct: 14.67,
  });
});

Deno.test("approved current draft applies only eligible factory lines", () => {
  const plan = requireApplyPlan();
  assertEquals(plan.lineMutations, [{
    quoteLineId: "line-factory",
    expectedUnitPriceCents: 1_000_000,
    expectedQuantity: 1,
    expectedSourceLocation: "factory_order",
    expectedIsYardStock: false,
    nextUnitPriceCents: 1_100_000,
    nextExtendedPriceCents: 1_100_000,
  }]);
  assertEquals(plan.nextTotals.netTotalCents, 2_890_000);
  assertEquals(plan.nextTotals.marginAmountCents, 505_000);
  assertEquals(plan.nextTotals.marginPct, 17.47);
  assertEquals(plan.audit.lines.map((line) => line.decision), [
    "applied",
    "preserved",
  ]);
  assertEquals(
    plan.audit.lines[1].preservationReason,
    "yard_stock_price_locked",
  );
  assertEquals(plan.customerCommunication, "none");
  assertEquals(plan.stateTransitions, {
    draftStatus: "applied",
    impactState: "applied",
    quoteRequiresRequote: "recompute_from_active_impacts",
  });
  assertEquals(plan.audit.sideEffects, {
    customerCommunication: "none",
    emailDraftId: null,
  });
});

Deno.test("apply audit is immutable and reconstructs dollars plus DP10 projection", () => {
  const plan = requireApplyPlan();
  assert(Object.isFrozen(plan.audit));
  assert(Object.isFrozen(plan.audit.before.totals));
  assert(Object.isFrozen(plan.audit.lines));
  assertEquals(plan.audit.before.totals.netTotalCents, 2_795_000);
  assertEquals(plan.audit.after.totals.netTotalCents, 2_890_000);
  assertEquals(plan.audit.commissionProjection, {
    policy: "OEM-DP10",
    rateOfGrossMargin: 0.15,
    grossMarginBeforeCents: 410_000,
    grossMarginAfterCents: 505_000,
    commissionBeforeCents: 61_500,
    commissionAfterCents: 75_750,
    commissionDeltaCents: 14_250,
    splitAllocation: null,
  });
  const factory = plan.audit.lines[0];
  assertEquals(factory.beforeExtendedPriceCents, 1_000_000);
  assertEquals(factory.afterExtendedPriceCents, 1_100_000);
});

Deno.test("unapproved and conditionally approved drafts fail closed", () => {
  const draftPending = inputFixture();
  draftPending.draft.status = "approval_pending";
  expectPolicyError("draft_not_approved", () => planRepriceApply(draftPending));

  const conditions = inputFixture();
  conditions.approval.status = "approved_with_conditions";
  expectPolicyError(
    "approval_not_approved",
    () => planRepriceApply(conditions),
  );
});

Deno.test("approval must be current and decided by elevated authority", () => {
  const wrongCase = inputFixture();
  wrongCase.draft.approvalCaseId = "older-approval";
  expectPolicyError("approval_not_current", () => planRepriceApply(wrongCase));

  const editedDraft = inputFixture();
  editedDraft.draft.updatedAt = "2026-07-09T11:00:00.001Z";
  expectPolicyError(
    "approval_not_current",
    () => planRepriceApply(editedDraft),
  );

  const repApproval = inputFixture();
  repApproval.approval.decidedByRole = "rep";
  expectPolicyError(
    "approval_authority_invalid",
    () => planRepriceApply(repApproval),
  );
});

Deno.test("cross-workspace and wrong-rep attempts fail before mutation", () => {
  const crossWorkspace = inputFixture();
  crossWorkspace.quote.workspaceId = "workspace-b";
  expectPolicyError(
    "cross_workspace",
    () => planRepriceApply(crossWorkspace),
  );

  const wrongRep = inputFixture();
  wrongRep.actor.userId = "rep-2";
  expectPolicyError("wrong_rep", () => planRepriceApply(wrongRep));
});

Deno.test("active customer lock includes expiry date and expired lock releases", () => {
  const input = inputFixture();
  input.customerPriceLock = {
    active: true,
    expiresAt: "2026-07-09",
    reason: "annual agreement",
  };
  expectPolicyError("customer_price_locked", () => planRepriceApply(input));

  const expired = inputFixture();
  expired.customerPriceLock = {
    active: true,
    expiresAt: "2026-07-08",
    reason: "expired agreement",
  };
  assertEquals(planRepriceApply(expired).kind, "apply");
  assertEquals(
    isCustomerPriceLockActive(
      { active: true, expiresAt: "2026-07-09T12:00:00.000Z", reason: null },
      "2026-07-09T12:00:00.000Z",
    ),
    true,
  );
});

Deno.test("stale quote versions, timestamps, and line snapshots fail closed", () => {
  const staleVersion = inputFixture();
  staleVersion.quote.versionNumber = 8;
  expectPolicyError(
    "quote_version_conflict",
    () => planRepriceApply(staleVersion),
  );

  const staleTimestamp = inputFixture();
  staleTimestamp.quote.updatedAt = "2026-07-09T10:00:00.001Z";
  expectPolicyError(
    "quote_snapshot_conflict",
    () => planRepriceApply(staleTimestamp),
  );

  const staleLine = inputFixture();
  staleLine.quote.lines[0].quantity = 2;
  expectPolicyError(
    "canonical_totals_conflict",
    () => planRepriceApply(staleLine),
  );

  const staleSource = inputFixture();
  staleSource.quote.lines[0].sourceLocation = "yard_stock";
  expectPolicyError(
    "line_snapshot_conflict",
    () => planRepriceApply(staleSource),
  );
});

Deno.test("persisted or client-shaped totals never override canonical totals", () => {
  const input = inputFixture();
  input.quote.persistedTotals.netTotalCents += 1;
  expectPolicyError(
    "canonical_totals_conflict",
    () => planRepriceApply(input),
  );
});

Deno.test("below-floor repricing requires an authorized auditable exception", () => {
  const blocked = inputFixture();
  blocked.marginFloorPct = 20;
  expectPolicyError(
    "margin_override_required",
    () => planRepriceApply(blocked),
  );

  const authorized = inputFixture();
  authorized.marginFloorPct = 20;
  authorized.approval.marginOverride = {
    authorized: true,
    policyId: "margin-policy-1",
    reason: "Sales manager approved strategic account exception",
  };
  const plan = requireApplyPlan(authorized);
  assertEquals(
    plan.audit.approval.marginOverride?.policyId,
    "margin-policy-1",
  );
});

Deno.test("all-preserved impacts cannot produce a no-op apply", () => {
  const input = inputFixture();
  input.serverImpactLines[0].suppressedByStockLock = true;
  expectPolicyError("no_eligible_lines", () => planRepriceApply(input));
});

Deno.test("double apply returns the original audit without another mutation", () => {
  const input = inputFixture();
  const plan = requireApplyPlan(input);
  input.draft.status = "applied";
  input.existingApplication = storedApplication(plan);
  const second = planRepriceApply(input);
  assertEquals(second.kind, "idempotent");
  assertEquals(second.audit, plan.audit);
  assertEquals(second.customerCommunication, "none");
});

Deno.test("applied draft without matching audit fails safe", () => {
  const input = inputFixture();
  input.draft.status = "applied";
  expectPolicyError(
    "already_applied_conflict",
    () => planRepriceApply(input),
  );
});

Deno.test("reversal restores every applied cent and preserves no-send policy", () => {
  const { input, application } = reversalInput();
  const reversal = planRepriceReversal(input);
  assertEquals(reversal.kind, "reverse");
  const plan = reversal as ReversalMutationPlan;
  assertEquals(plan.lineMutations, [{
    quoteLineId: "line-factory",
    expectedUnitPriceCents: 1_100_000,
    expectedQuantity: 1,
    nextUnitPriceCents: 1_000_000,
    nextExtendedPriceCents: 1_000_000,
  }]);
  assertEquals(plan.nextTotals, application.payload.before.totals);
  assertEquals(plan.audit.before.totals, application.payload.after.totals);
  assertEquals(plan.audit.after.totals, application.payload.before.totals);
  assertEquals(plan.audit.reversesApplyAuditId, application.id);
  assertEquals(plan.stateTransitions, {
    draftStatus: "reversed",
    impactState: "visible",
    quoteRequiresRequote: "recompute_from_active_impacts",
  });
  assertEquals(plan.audit.sideEffects.customerCommunication, "none");
});

Deno.test("seven-day reversal boundary is inclusive and one millisecond after fails", () => {
  const before = reversalInput().input;
  const deadlineMs = Date.parse(before.application.appliedAt) +
    REPRICE_REVERSAL_WINDOW_MS;
  before.now = new Date(deadlineMs - 1).toISOString();
  assertEquals(planRepriceReversal(before).kind, "reverse");

  const exact = reversalInput().input;
  exact.now = new Date(deadlineMs).toISOString();
  assertEquals(planRepriceReversal(exact).kind, "reverse");

  const after = reversalInput().input;
  after.now = new Date(deadlineMs + 1).toISOString();
  expectPolicyError(
    "reversal_window_expired",
    () => planRepriceReversal(after),
  );
});

Deno.test("reversal refuses later versions and irreversible customer state", () => {
  const laterEdit = reversalInput().input;
  laterEdit.quote.versionId = "quote-version-9-unrelated";
  laterEdit.quote.versionNumber = 9;
  laterEdit.resultQuoteVersion = { id: "quote-version-10", versionNumber: 10 };
  expectPolicyError(
    "quote_version_conflict",
    () => planRepriceReversal(laterEdit),
  );

  const accepted = reversalInput().input;
  accepted.quote.status = "accepted";
  expectPolicyError(
    "quote_state_irreversible",
    () => planRepriceReversal(accepted),
  );
});

Deno.test("double reversal returns the original reversal audit without mutation", () => {
  const { input, application } = reversalInput();
  const first = planRepriceReversal(input) as ReversalMutationPlan;
  const existing: StoredReversalAudit = {
    id: "reversal-audit-1",
    workspaceId: input.actor.workspaceId,
    quotePackageId: input.quote.id,
    applyAuditId: application.id,
    idempotencyKey: first.idempotencyKey,
    payload: first.audit,
  };
  input.application = { ...application, reversedAt: first.audit.occurredAt };
  input.existingReversal = existing;
  const second = planRepriceReversal(input);
  assertEquals(second.kind, "idempotent");
  assertEquals(second.audit, first.audit);
  assertEquals(second.customerCommunication, "none");
});

Deno.test("reversed marker without matching audit fails safe", () => {
  const { input } = reversalInput();
  input.application = {
    ...input.application,
    reversedAt: "2026-07-10T12:00:00.000Z",
  };
  expectPolicyError(
    "already_reversed_conflict",
    () => planRepriceReversal(input),
  );
});
