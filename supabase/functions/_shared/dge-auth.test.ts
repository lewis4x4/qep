import { assertEquals } from "jsr:@std/assert@1";

const originalUrl = Deno.env.get("SUPABASE_URL");
const originalAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set(
  "SUPABASE_ANON_KEY",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature",
);
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
);

const { shouldUseLocalClaimFallback } = await import("./dge-auth.ts");

Deno.test("shouldUseLocalClaimFallback accepts local claim identity when auth.getUser fails", () => {
  assertEquals(shouldUseLocalClaimFallback("user-1", true), true);
});

Deno.test("shouldUseLocalClaimFallback rejects missing local claim identity", () => {
  assertEquals(shouldUseLocalClaimFallback(null, true), false);
});

Deno.test("shouldUseLocalClaimFallback does not bypass successful auth.getUser calls", () => {
  assertEquals(shouldUseLocalClaimFallback("user-1", false), false);
});

Deno.test({
  name: "dge-auth env cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    if (originalUrl === undefined) {
      Deno.env.delete("SUPABASE_URL");
    } else {
      Deno.env.set("SUPABASE_URL", originalUrl);
    }

    if (originalAnonKey === undefined) {
      Deno.env.delete("SUPABASE_ANON_KEY");
    } else {
      Deno.env.set("SUPABASE_ANON_KEY", originalAnonKey);
    }

    if (originalServiceRoleKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
    }
  },
});
