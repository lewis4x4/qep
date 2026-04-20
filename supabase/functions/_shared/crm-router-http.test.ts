import { assertEquals } from "jsr:@std/assert@1";
import { normalizeRouterPath } from "./crm-router-http.ts";

Deno.test("normalizeRouterPath strips the /crm-router prefix", () => {
  assertEquals(normalizeRouterPath("/crm-router/crm/search"), "/crm/search");
  assertEquals(normalizeRouterPath("/crm-router/crm/custom-fields"), "/crm/custom-fields");
});

Deno.test("normalizeRouterPath strips the /qrm-router prefix (Tier 4 rename)", () => {
  // The qrm-router edge function re-imports crm-router/index.ts, so the
  // shared normalizer must recognise both prefixes. This is the exact bug
  // that caused the "CRM route not found" error on the contact detail page:
  // Supabase routed requests through /functions/v1/qrm-router/qrm/...,
  // the normalizer left "/qrm-router" intact, segments[0] became
  // "qrm-router", and the route check rejected everything.
  assertEquals(normalizeRouterPath("/qrm-router/qrm/search"), "/qrm/search");
  assertEquals(
    normalizeRouterPath("/qrm-router/qrm/custom-fields"),
    "/qrm/custom-fields",
  );
  assertEquals(
    normalizeRouterPath("/qrm-router/qrm/duplicates/abc/dismiss"),
    "/qrm/duplicates/abc/dismiss",
  );
});

Deno.test("normalizeRouterPath returns '/' when prefix matches with no suffix", () => {
  assertEquals(normalizeRouterPath("/crm-router"), "/");
  assertEquals(normalizeRouterPath("/qrm-router"), "/");
});

Deno.test("normalizeRouterPath leaves unrelated paths untouched", () => {
  assertEquals(normalizeRouterPath("/functions/v1/other"), "/functions/v1/other");
  assertEquals(normalizeRouterPath("/crm/search"), "/crm/search");
  assertEquals(normalizeRouterPath("/qrm/search"), "/qrm/search");
});
