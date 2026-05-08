import { assertEquals } from "jsr:@std/assert@1";
import { resolveVendorInboundAccess } from "./service-vendor-inbound-auth.ts";

Deno.test("resolveVendorInboundAccess: hosted URL rejects missing secret (503)", () => {
  const r = resolveVendorInboundAccess({
    supabaseUrl: "https://abc123.supabase.co",
    secretEnv: undefined,
    webhookHeader: null,
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 503);
  }
});

Deno.test("resolveVendorInboundAccess: hosted rejects wrong secret (401)", () => {
  const r = resolveVendorInboundAccess({
    supabaseUrl: "https://xyz.supabase.co",
    secretEnv: "expected-secret",
    webhookHeader: "wrong",
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 401);
  }
});

Deno.test("resolveVendorInboundAccess: hosted accepts matching secret (strict)", () => {
  const r = resolveVendorInboundAccess({
    supabaseUrl: "https://xyz.supabase.co",
    secretEnv: "expected-secret",
    webhookHeader: "expected-secret",
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.strictInbound, true);
  }
});

Deno.test("resolveVendorInboundAccess: local may omit secret (not strict)", () => {
  const r = resolveVendorInboundAccess({
    supabaseUrl: "http://127.0.0.1:54321",
    secretEnv: undefined,
    webhookHeader: null,
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.strictInbound, false);
  }
});

Deno.test("resolveVendorInboundAccess: local with secret requires header match", () => {
  const bad = resolveVendorInboundAccess({
    supabaseUrl: "http://localhost:54321",
    secretEnv: "s3cret",
    webhookHeader: "nope",
  });
  assertEquals(bad.ok, false);

  const good = resolveVendorInboundAccess({
    supabaseUrl: "http://localhost:54321",
    secretEnv: "s3cret",
    webhookHeader: "s3cret",
  });
  assertEquals(good.ok, true);
  if (good.ok) {
    assertEquals(good.strictInbound, true);
  }
});
