import { assertEquals } from "jsr:@std/assert@1";
import { buildDgeRefreshDedupeKey } from "./dge-refresh-jobs.ts";

Deno.test("buildDgeRefreshDedupeKey normalizes whitespace and case", () => {
  assertEquals(
    buildDgeRefreshDedupeKey("market_valuation_refresh", "  CAT 289D  "),
    "market_valuation_refresh:cat 289d",
  );
});
