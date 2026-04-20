/**
 * deno test --no-check supabase/functions/qb-price-sheet-watchdog/poll-logic.test.ts
 *
 * Pure-logic coverage for the watchdog. Doesn't hit network or Supabase;
 * that's left to integration QA once the function is live.
 */

import { assertEquals, assert } from "jsr:@std/assert@1";
import {
  buildAutoFilename,
  buildStoragePath,
  detectHashChange,
  isOverdue,
  resolveContentType,
  sha256Hex,
} from "./poll-logic.ts";

Deno.test("sha256Hex → hex string", async () => {
  const bytes = new TextEncoder().encode("hello world");
  const hex = await sha256Hex(bytes);
  assertEquals(hex, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

Deno.test("detectHashChange — first_seen / unchanged / changed", () => {
  assertEquals(detectHashChange(null, "abc"), "first_seen");
  assertEquals(detectHashChange(undefined, "abc"), "first_seen");
  assertEquals(detectHashChange("", "abc"), "first_seen");
  assertEquals(detectHashChange("abc", "abc"), "unchanged");
  assertEquals(detectHashChange("abc", "def"), "changed");
});

Deno.test("isOverdue — inactive never overdue", () => {
  const s = { active: false, last_checked_at: null, check_freq_hours: 24 };
  assertEquals(isOverdue(s, new Date("2026-04-20T12:00:00Z")), false);
});

Deno.test("isOverdue — null last_checked_at → overdue", () => {
  const s = { active: true, last_checked_at: null, check_freq_hours: 24 };
  assertEquals(isOverdue(s, new Date("2026-04-20T12:00:00Z")), true);
});

Deno.test("isOverdue — within cadence → false", () => {
  const s = { active: true, last_checked_at: "2026-04-20T06:00:00Z", check_freq_hours: 24 };
  assertEquals(isOverdue(s, new Date("2026-04-20T12:00:00Z")), false);
});

Deno.test("isOverdue — past cadence → true", () => {
  const s = { active: true, last_checked_at: "2026-04-19T06:00:00Z", check_freq_hours: 24 };
  assertEquals(isOverdue(s, new Date("2026-04-20T12:00:00Z")), true);
});

Deno.test("resolveContentType — PDF via server header", () => {
  const r = resolveContentType("application/pdf", "https://ex.com/book");
  assertEquals(r.fileType, "pdf");
  assertEquals(r.contentType, "application/pdf");
});

Deno.test("resolveContentType — XLSX via server header", () => {
  const r = resolveContentType(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "https://ex.com/prices",
  );
  assertEquals(r.fileType, "xlsx");
});

Deno.test("resolveContentType — CSV via extension fallback", () => {
  const r = resolveContentType("application/octet-stream", "https://ex.com/prices.csv");
  assertEquals(r.fileType, "csv");
  assertEquals(r.contentType, "text/csv");
});

Deno.test("resolveContentType — unknown when no signal", () => {
  const r = resolveContentType(null, "https://ex.com/data");
  assertEquals(r.fileType, "unknown");
});

Deno.test("buildStoragePath — shape matches spec", () => {
  const path = buildStoragePath({
    brandCode: "ASV",
    hashHex: "abcdef1234567890",
    fileType: "pdf",
    now: new Date("2026-04-20T12:00:00Z"),
  });
  assertEquals(path, "asv/watchdog/2026-04-20/abcdef12.pdf");
});

Deno.test("buildStoragePath — sanitises brandCode", () => {
  const path = buildStoragePath({
    brandCode: "Weird Brand!!",
    hashHex: "0123abcd",
    fileType: "xlsx",
    now: new Date("2026-01-05T00:00:00Z"),
  });
  assertEquals(path, "weird-brand-/watchdog/2026-01-05/0123abcd.xlsx");
});

Deno.test("buildStoragePath — unknown fileType falls back to bin", () => {
  const path = buildStoragePath({
    brandCode: "asv",
    hashHex: "abcd1234",
    fileType: "unknown",
    now: new Date("2026-04-20T00:00:00Z"),
  });
  assert(path.endsWith(".bin"));
});

Deno.test("buildAutoFilename — human-readable format", () => {
  const f = buildAutoFilename({
    brandName: "ASV",
    sourceLabel: "Public price book page",
    now: new Date("2026-04-20T00:00:00Z"),
  });
  assertEquals(f, "[Auto] ASV — Public price book page (2026-04-20)");
});
