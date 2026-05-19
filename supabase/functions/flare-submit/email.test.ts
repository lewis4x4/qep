import { flareEmailSubject } from "./email.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("flareEmailSubject prefixes blocker severity", () => {
  const got = flareEmailSubject("blocker", "Dispatch board is showing stale prices for all reps");
  assertEquals(got.startsWith("🚨 BLOCKER · "), true);
  assertEquals(got.includes("Dispatch board"), true);
});

Deno.test("flareEmailSubject prefixes bug severity", () => {
  const got = flareEmailSubject("bug", "Quote pdf wraps the customer name");
  assertEquals(got.startsWith("🐛 Bug · "), true);
});

Deno.test("flareEmailSubject prefixes annoyance severity", () => {
  const got = flareEmailSubject("annoyance", "Slow filter on parts page");
  assertEquals(got.startsWith("⚠️ Annoyance · "), true);
});

Deno.test("flareEmailSubject prefixes idea severity", () => {
  const got = flareEmailSubject("idea", "Bulk re-assign deals from the pipeline view");
  assertEquals(got.startsWith("✨ Idea · "), true);
});

Deno.test("flareEmailSubject truncates long descriptions to 80 chars", () => {
  const long = "A".repeat(200);
  const got = flareEmailSubject("bug", long);
  // prefix "🐛 Bug · " then 80 chars of A
  const aChars = got.split("· ")[1] ?? "";
  assertEquals(aChars.length, 80);
});

Deno.test("flareEmailSubject collapses whitespace", () => {
  const got = flareEmailSubject("bug", "  hello\n\n   world  ");
  assertEquals(got, "🐛 Bug · hello world");
});
