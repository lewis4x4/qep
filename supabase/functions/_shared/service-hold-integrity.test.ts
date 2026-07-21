import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateHoldDurationHours,
  excludeHoldHoursFromActual,
  normalizeServiceHoldState,
  SERVICE_HOLD_STATES,
} from "./service-hold-integrity.ts";

Deno.test("H4 exposes exactly five named service hold states", () => {
  assertEquals(SERVICE_HOLD_STATES, [
    "waiting_on_parts",
    "waiting_on_customer_approval",
    "waiting_on_warranty_authorization",
    "waiting_on_sublet",
    "waiting_on_payment_deposit",
  ]);
});

Deno.test("H4 normalizes legacy blocker text into named hold states", () => {
  assertEquals(
    normalizeServiceHoldState("parts_shortage"),
    "waiting_on_parts",
  );
  assertEquals(
    normalizeServiceHoldState("waiting vendor PO"),
    "waiting_on_sublet",
  );
  assertEquals(
    normalizeServiceHoldState("customer approval"),
    "waiting_on_customer_approval",
  );
  assertEquals(
    normalizeServiceHoldState("waiting_customer"),
    "waiting_on_customer_approval",
  );
  assertEquals(
    normalizeServiceHoldState("OEM warranty auth"),
    "waiting_on_warranty_authorization",
  );
  assertEquals(
    normalizeServiceHoldState("waiting_on_warranty_authorization"),
    "waiting_on_warranty_authorization",
  );
  assertEquals(
    normalizeServiceHoldState("warranty_authorization"),
    "waiting_on_warranty_authorization",
  );
  assertEquals(
    normalizeServiceHoldState("oem_authorization"),
    "waiting_on_warranty_authorization",
  );
  assertEquals(
    normalizeServiceHoldState("manufacturer_authorization"),
    "waiting_on_warranty_authorization",
  );
  assertEquals(
    normalizeServiceHoldState("waiting warranty authorization"),
    "waiting_on_warranty_authorization",
  );
  assertEquals(
    normalizeServiceHoldState("invoice payment"),
    "waiting_on_payment_deposit",
  );
});

Deno.test("H4 rejects unrelated free-text blocker reasons", () => {
  assertEquals(normalizeServiceHoldState("needs supervisor eyes"), null);
  assertEquals(normalizeServiceHoldState("support needed"), null);
});

Deno.test("H4 hold duration uses created_at to resolved_at or now", () => {
  assertEquals(
    calculateHoldDurationHours({
      createdAt: "2026-05-29T08:00:00.000Z",
      resolvedAt: "2026-05-29T10:30:00.000Z",
    }),
    2.5,
  );
  assertEquals(
    calculateHoldDurationHours({
      createdAt: "2026-05-29T08:00:00.000Z",
      now: "2026-05-29T09:15:00.000Z",
    }),
    1.25,
  );
});

Deno.test("H4 efficiency denominator excludes hold hours without going negative", () => {
  assertEquals(
    excludeHoldHoursFromActual({ actualHours: 8, holdHours: 2.5 }),
    {
      actualHoursBeforeHold: 8,
      holdHoursExcluded: 2.5,
      actualHours: 5.5,
    },
  );

  const capped = excludeHoldHoursFromActual({ actualHours: 3, holdHours: 10 });
  assertEquals(capped.holdHoursExcluded, 3);
  assertEquals(capped.actualHours, 0);
  assert(capped.actualHours >= 0);
});
