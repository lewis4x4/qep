import { assertEquals } from "jsr:@std/assert@1";
import {
  getDateInTimeZone,
  getHourInTimeZone,
  shouldRunEtScheduledBatch,
} from "./briefing-time.ts";

Deno.test("getDateInTimeZone returns the America/New_York sales day", () => {
  assertEquals(getDateInTimeZone(new Date("2026-05-21T01:30:00Z")), "2026-05-20");
});

Deno.test("shouldRunEtScheduledBatch allows the EDT 6 AM tick", () => {
  assertEquals(
    shouldRunEtScheduledBatch(
      { batch: true, enforce_et_hour: 6 },
      new Date("2026-07-01T10:00:00Z"),
    ),
    true,
  );
  assertEquals(getHourInTimeZone(new Date("2026-07-01T10:00:00Z")), 6);
});

Deno.test("shouldRunEtScheduledBatch allows the EST 6 AM tick", () => {
  assertEquals(
    shouldRunEtScheduledBatch(
      { batch: true, enforce_et_hour: 6 },
      new Date("2026-01-15T11:00:00Z"),
    ),
    true,
  );
  assertEquals(getHourInTimeZone(new Date("2026-01-15T11:00:00Z")), 6);
});

Deno.test("shouldRunEtScheduledBatch skips the non-6 AM paired DST tick", () => {
  assertEquals(
    shouldRunEtScheduledBatch(
      { batch: true, enforce_et_hour: 6 },
      new Date("2026-07-01T11:00:00Z"),
    ),
    false,
  );
  assertEquals(
    shouldRunEtScheduledBatch(
      { batch: true, enforce_et_hour: 6 },
      new Date("2026-01-15T10:00:00Z"),
    ),
    false,
  );
});

Deno.test("shouldRunEtScheduledBatch does not gate manual or regenerate calls", () => {
  assertEquals(shouldRunEtScheduledBatch({ batch: true }, new Date("2026-07-01T11:00:00Z")), true);
  assertEquals(
    shouldRunEtScheduledBatch(
      { batch: true, regenerate: true, enforce_et_hour: 6 },
      new Date("2026-07-01T11:00:00Z"),
    ),
    true,
  );
});
