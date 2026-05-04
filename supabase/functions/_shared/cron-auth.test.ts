/**
 * Deno tests for the shared cron-caller auth helper.
 *
 * Run with:
 *   deno test --allow-env supabase/functions/_shared/cron-auth.test.ts
 *
 * Pure-function tests using the Request constructor — no DB, no network.
 * Each test sets the relevant Deno env vars before running and clears
 * them after, so test order is irrelevant and parallel execution is safe.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { isServiceRoleCaller } from "./cron-auth.ts";

const TEST_URL = "https://example.test/functions/v1/test-fn";

const TEST_SERVICE_KEY = "fake-service-role-key-for-testing-only";
const TEST_INTERNAL_SECRET = "fake-internal-secret-for-testing-only";
const TEST_DGE_INTERNAL_SECRET = "fake-dge-internal-secret-for-testing-only";

/**
 * Save and restore env vars around a test body so tests don't leak state.
 * Deno.env.set / delete operate on the actual process env, not a sandbox.
 */
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = Deno.env.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

// ─── Path 1: legacy Authorization: Bearer service_role_key ───────────────

Deno.test("isServiceRoleCaller: accepts legacy Bearer service_role_key match", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_SERVICE_KEY}` },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

Deno.test("isServiceRoleCaller: accepts Bearer service_role_key with surrounding whitespace", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: `  ${TEST_SERVICE_KEY}  `,
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { Authorization: `  Bearer ${TEST_SERVICE_KEY}  ` },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

Deno.test("isServiceRoleCaller: rejects wrong Bearer token", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-key" },
      });
      assertEquals(isServiceRoleCaller(req), false);
    },
  );
});

// ─── Path 2: apikey service_role_key ────────────────────────────────────

Deno.test("isServiceRoleCaller: accepts apikey service_role_key match", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { apikey: TEST_SERVICE_KEY },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

Deno.test("isServiceRoleCaller: rejects wrong apikey", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { apikey: "wrong-key" },
      });
      assertEquals(isServiceRoleCaller(req), false);
    },
  );
});

// ─── Path 3: modern x-internal-service-secret ────────────────────────────

Deno.test("isServiceRoleCaller: accepts INTERNAL_SERVICE_SECRET header match", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      INTERNAL_SERVICE_SECRET: TEST_INTERNAL_SECRET,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { "x-internal-service-secret": TEST_INTERNAL_SECRET },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

Deno.test("isServiceRoleCaller: accepts INTERNAL_SERVICE_SECRET with surrounding whitespace", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      INTERNAL_SERVICE_SECRET: `  ${TEST_INTERNAL_SECRET}  `,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { "x-internal-service-secret": `  ${TEST_INTERNAL_SECRET}  ` },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

Deno.test("isServiceRoleCaller: accepts DGE_INTERNAL_SERVICE_SECRET fallback", () => {
  // When INTERNAL_SERVICE_SECRET is unset but DGE_INTERNAL_SERVICE_SECRET
  // is set, the helper falls through to the DGE name. This mirrors the
  // morning-briefing pattern at lines 239-242.
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: TEST_DGE_INTERNAL_SECRET,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { "x-internal-service-secret": TEST_DGE_INTERNAL_SECRET },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

Deno.test("isServiceRoleCaller: rejects wrong x-internal-service-secret", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      INTERNAL_SERVICE_SECRET: TEST_INTERNAL_SECRET,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { "x-internal-service-secret": "wrong-secret" },
      });
      assertEquals(isServiceRoleCaller(req), false);
    },
  );
});

// ─── Empty / missing headers ─────────────────────────────────────────────

Deno.test("isServiceRoleCaller: rejects request with no auth headers", () => {
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      INTERNAL_SERVICE_SECRET: TEST_INTERNAL_SECRET,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, { method: "POST" });
      assertEquals(isServiceRoleCaller(req), false);
    },
  );
});

// ─── Both headers present (modern wins) ──────────────────────────────────

Deno.test("isServiceRoleCaller: accepts request with both headers when either matches", () => {
  // If a caller sends both, the helper should accept the request as long
  // as ONE of them validates. This is permissive but correct: both paths
  // are equally trusted.
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      INTERNAL_SERVICE_SECRET: TEST_INTERNAL_SECRET,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_SERVICE_KEY}`,
          "x-internal-service-secret": TEST_INTERNAL_SECRET,
        },
      });
      assertEquals(isServiceRoleCaller(req), true);
    },
  );
});

// ─── Defensive: empty env vars ───────────────────────────────────────────

Deno.test("isServiceRoleCaller: empty SERVICE_ROLE_KEY env does NOT accept empty Bearer", () => {
  // Defensive against an env-misconfig side-channel: if the env var is
  // empty/unset, an attacker who sends "Bearer " (with empty token) must
  // NOT be elevated. The helper requires the env var to have non-zero
  // length before evaluating the bearer match.
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: "",
      INTERNAL_SERVICE_SECRET: undefined,
      DGE_INTERNAL_SERVICE_SECRET: undefined,
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " },
      });
      assertEquals(isServiceRoleCaller(req), false);
    },
  );
});

Deno.test("isServiceRoleCaller: empty internal-secret env does NOT accept empty header", () => {
  // Same defense as above for the modern path. An attacker who knows
  // both env vars are empty cannot send an empty x-internal-service-secret
  // header and bypass.
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      INTERNAL_SERVICE_SECRET: "",
      DGE_INTERNAL_SERVICE_SECRET: "",
    },
    () => {
      const req = new Request(TEST_URL, {
        method: "POST",
        headers: { "x-internal-service-secret": "" },
      });
      assertEquals(isServiceRoleCaller(req), false);
    },
  );
});
