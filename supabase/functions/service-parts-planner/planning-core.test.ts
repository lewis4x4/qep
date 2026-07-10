import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import {
  decideDemandMutation,
  demandFingerprint,
  demandKeyForRequirement,
  includeOwnedReservations,
  isPlannableRequirementStatus,
  type PlanningInput,
  planServiceParts,
  toReconciliationRows,
} from "./planning-core.ts";

const REQUIREMENT_ID = "11111111-1111-4111-8111-111111111111";
const VENDOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseInput(overrides: Partial<PlanningInput> = {}): PlanningInput {
  return {
    requirements: [{
      id: REQUIREMENT_ID,
      partNumber: " RE123 ",
      quantity: 2,
      vendorId: VENDOR_A,
      unitCost: 12.34,
    }],
    stockByBranch: new Map(),
    edgeLeadHours: new Map(),
    vendorLeadHours: new Map([[VENDOR_A, 24]]),
    jobBranchId: "branch-a",
    scheduledStartAt: "2026-07-20T12:00:00.000Z",
    haulRequired: false,
    isMachineDown: false,
    plannerRules: {},
    legacyMode: false,
    planBatchId: "batch-1",
    now: new Date("2026-07-09T12:00:00.000Z"),
    ...overrides,
  };
}

Deno.test("unchanged order plans keep one stable demand identity", () => {
  const first = toReconciliationRows(planServiceParts(baseInput()))[0];
  const replay = toReconciliationRows(planServiceParts(baseInput({
    planBatchId: "batch-2",
    now: new Date("2026-07-09T12:05:00.000Z"),
  })))[0];

  assertEquals(first.action_type, "order");
  assertEquals(first.demand_key, replay.demand_key);
  assertEquals(first.demand_fingerprint, replay.demand_fingerprint);
  assertEquals(
    decideDemandMutation(
      {
        demandKey: first.demand_key,
        demandFingerprint: first.demand_fingerprint,
      },
      {
        demandKey: replay.demand_key,
        demandFingerprint: replay.demand_fingerprint,
      },
    ),
    "reuse",
  );
});

Deno.test("machine-down clock changes do not create new vendor demand", () => {
  const first = toReconciliationRows(planServiceParts(baseInput({
    isMachineDown: true,
  })))[0];
  const replay = toReconciliationRows(planServiceParts(baseInput({
    isMachineDown: true,
    now: new Date("2026-07-09T13:00:00.000Z"),
  })))[0];

  assertNotEquals(first.expected_date, replay.expected_date);
  assertEquals(first.demand_fingerprint, replay.demand_fingerprint);
});

Deno.test("quantity change replaces but does not rename the requirement demand", () => {
  const original = toReconciliationRows(planServiceParts(baseInput()))[0];
  const changed = toReconciliationRows(planServiceParts(baseInput({
    requirements: [{
      ...baseInput().requirements[0],
      quantity: 3,
    }],
  })))[0];

  assertEquals(original.demand_key, changed.demand_key);
  assertNotEquals(original.demand_fingerprint, changed.demand_fingerprint);
  assertEquals(
    decideDemandMutation(
      {
        demandKey: original.demand_key,
        demandFingerprint: original.demand_fingerprint,
      },
      {
        demandKey: changed.demand_key,
        demandFingerprint: changed.demand_fingerprint,
      },
    ),
    "replace",
  );
});

Deno.test("vendor change replaces the active commitment", () => {
  const original = demandFingerprint({
    actionType: "order",
    vendorId: VENDOR_A,
    partNumber: "RE123",
    quantity: 2,
    unitCostCents: 1234,
    fromBranch: null,
    toBranch: null,
  });
  const changed = demandFingerprint({
    actionType: "order",
    vendorId: VENDOR_B,
    partNumber: "RE123",
    quantity: 2,
    unitCostCents: 1234,
    fromBranch: null,
    toBranch: null,
  });
  assertNotEquals(original, changed);
});

Deno.test("stock planning is pure and reserves capacity only within its result", () => {
  const stock = new Map([["branch-a", new Map([["RE123", 2]])]]);
  const input = baseInput({
    requirements: [
      baseInput().requirements[0],
      {
        ...baseInput().requirements[0],
        id: "22222222-2222-4222-8222-222222222222",
      },
    ],
    stockByBranch: stock,
  });

  const planned = planServiceParts(input);
  assertEquals(planned.map((row) => row.actionType), ["pick", "order"]);
  assertEquals(stock.get("branch-a")?.get("RE123"), 2);
});

Deno.test("remote stock beats slower vendor ordering and records the route", () => {
  const planned = planServiceParts(baseInput({
    stockByBranch: new Map([
      ["branch-a", new Map([["RE123", 0]])],
      ["branch-b", new Map([["RE123", 4]])],
    ]),
    edgeLeadHours: new Map([["branch-b|branch-a", 4]]),
  }));

  assertEquals(planned[0].actionType, "transfer");
  assertEquals(planned[0].fromBranch, "branch-b");
  assertEquals(planned[0].toBranch, "branch-a");
});

Deno.test("demand keys are normalized and empty IDs are rejected", () => {
  assertEquals(
    demandKeyForRequirement(` ${REQUIREMENT_ID.toUpperCase()} `),
    `service-requirement:${REQUIREMENT_ID}`,
  );
  assertThrows(() => demandKeyForRequirement(""));
});

Deno.test("duplicate requirements cannot enter reconciliation", () => {
  const row = planServiceParts(baseInput())[0];
  assertThrows(
    () => toReconciliationRows([row, row]),
    Error,
    "duplicate requirement",
  );
});

Deno.test("a removed requirement is an explicit cancellation", () => {
  const demand = {
    demandKey: demandKeyForRequirement(REQUIREMENT_ID),
    demandFingerprint: "v1|order|vendor|RE123|2|1234|-|-",
  };
  assertEquals(decideDemandMutation(demand, null), "cancel");
  assertEquals(toReconciliationRows([]), []);
});

Deno.test("a job's own hold remains available to its unchanged pick plan", () => {
  const globallyAvailable = new Map([
    ["branch-a", new Map([["RE123", 0], ["OTHER", 5]])],
  ]);
  const effective = includeOwnedReservations(
    globallyAvailable,
    [
      {
        requirementId: REQUIREMENT_ID,
        branchId: "branch-a",
        partNumber: "RE123",
        quantity: 2,
      },
      {
        requirementId: "cancelled-requirement",
        branchId: "branch-a",
        partNumber: "OTHER",
        quantity: 3,
      },
    ],
    new Set([REQUIREMENT_ID]),
  );

  const planned = planServiceParts(baseInput({ stockByBranch: effective }));
  assertEquals(planned[0].actionType, "pick");
  assertEquals(globallyAvailable.get("branch-a")?.get("RE123"), 0);
  assertEquals(effective.get("branch-a")?.get("OTHER"), 5);
});

Deno.test("only active procurement states may enter a re-plan", () => {
  for (const status of ["pending", "picking", "transferring", "ordering"]) {
    assertEquals(isPlannableRequirementStatus(status), true, status);
  }
  for (
    const terminal of [
      "received",
      "staged",
      "consumed",
      "returned",
      "cancelled",
      null,
      undefined,
    ]
  ) {
    assertEquals(
      isPlannableRequirementStatus(terminal),
      false,
      String(terminal),
    );
  }
});
