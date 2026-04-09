import { assertEquals } from "jsr:@std/assert@1";
import { timeBalance } from "./time-primitive.ts";

Deno.test("timeBalance — under budget returns correct remaining", () => {
  const result = timeBalance({ days_in_stage: 3 }, { max_days: 10 });
  assertEquals(result, {
    remaining: 7,
    pct_used: 0.3,
    is_over: false,
  });
});

Deno.test("timeBalance — exactly at budget is not over", () => {
  const result = timeBalance({ days_in_stage: 10 }, { max_days: 10 });
  assertEquals(result.remaining, 0);
  assertEquals(result.pct_used, 1.0);
  assertEquals(result.is_over, false);
});

Deno.test("timeBalance — over budget returns is_over true", () => {
  const result = timeBalance({ days_in_stage: 15 }, { max_days: 10 });
  assertEquals(result.remaining, 0);
  assertEquals(result.pct_used, 1.5);
  assertEquals(result.is_over, true);
});

Deno.test("timeBalance — zero budget treats everything as over", () => {
  const result = timeBalance({ days_in_stage: 0 }, { max_days: 0 });
  assertEquals(result.remaining, 0);
  assertEquals(result.pct_used, 1.0);
  assertEquals(result.is_over, false); // 0 > 0 is false
});

Deno.test("timeBalance — pct_used rounded to 2 decimal places", () => {
  const result = timeBalance({ days_in_stage: 1 }, { max_days: 3 });
  assertEquals(result.pct_used, 0.33);
});

Deno.test("timeBalance — negative remaining clamped to 0", () => {
  const result = timeBalance({ days_in_stage: 100 }, { max_days: 10 });
  assertEquals(result.remaining, 0);
  assertEquals(result.pct_used, 10.0);
  assertEquals(result.is_over, true);
});
