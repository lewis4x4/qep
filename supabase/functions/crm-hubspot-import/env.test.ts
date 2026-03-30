import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { loadCrmHubspotImportEnv } from "./env.ts";

class MockEnv {
  constructor(private readonly values: Record<string, string | undefined>) {}

  get(key: string): string | undefined {
    return this.values[key];
  }
}

Deno.test("loadCrmHubspotImportEnv returns required Supabase keys", () => {
  const loaded = loadCrmHubspotImportEnv(
    new MockEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_ANON_KEY: "anon-key",
    }),
  );

  assertEquals(loaded.supabaseUrl, "https://example.supabase.co");
  assertEquals(loaded.supabaseServiceRoleKey, "service-role");
  assertEquals(loaded.supabaseAnonKey, "anon-key");
});

Deno.test("loadCrmHubspotImportEnv rejects missing SUPABASE_ANON_KEY", () => {
  assertThrows(
    () =>
      loadCrmHubspotImportEnv(
        new MockEnv({
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role",
        }),
      ),
    Error,
    "SUPABASE_ANON_KEY is required for caller auth client in crm-hubspot-import.",
  );
});
