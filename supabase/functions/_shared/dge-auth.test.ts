import { assertEquals } from "jsr:@std/assert@1";

const originalUrl = Deno.env.get("SUPABASE_URL");
const originalAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
const originalDgeInternalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set(
  "SUPABASE_ANON_KEY",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature",
);
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
);

const { resolveCallerContext, shouldUseLocalClaimFallback } = await import(
  "./dge-auth.ts"
);

const MODERN_SERVICE_KEY = "sb_secret_dge_auth_test_only";
const TEST_WORKSPACE_ID = "workspace-dge-test";

async function withServiceEnv(
  values: {
    serviceKey?: string;
    internalSecret?: string;
    dgeInternalSecret?: string;
  },
  fn: () => Promise<void>,
): Promise<void> {
  const previous = {
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    internalSecret: Deno.env.get("INTERNAL_SERVICE_SECRET"),
    dgeInternalSecret: Deno.env.get("DGE_INTERNAL_SERVICE_SECRET"),
  };
  const assign = (name: string, value: string | undefined) => {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  };
  assign("SUPABASE_SERVICE_ROLE_KEY", values.serviceKey);
  assign("INTERNAL_SERVICE_SECRET", values.internalSecret);
  assign("DGE_INTERNAL_SERVICE_SECRET", values.dgeInternalSecret);
  try {
    await fn();
  } finally {
    assign("SUPABASE_SERVICE_ROLE_KEY", previous.serviceKey);
    assign("INTERNAL_SERVICE_SECRET", previous.internalSecret);
    assign("DGE_INTERNAL_SERVICE_SECRET", previous.dgeInternalSecret);
  }
}

Deno.test("shouldUseLocalClaimFallback accepts local claim identity when auth.getUser fails", () => {
  assertEquals(shouldUseLocalClaimFallback("user-1", true), true);
});

Deno.test("shouldUseLocalClaimFallback rejects missing local claim identity", () => {
  assertEquals(shouldUseLocalClaimFallback(null, true), false);
});

Deno.test("shouldUseLocalClaimFallback does not bypass successful auth.getUser calls", () => {
  assertEquals(shouldUseLocalClaimFallback("user-1", false), false);
});

Deno.test("resolveCallerContext accepts modern sb_secret bearer service callers", async () => {
  await withServiceEnv({ serviceKey: MODERN_SERVICE_KEY }, async () => {
    const req = new Request("https://example.test/customer-dna-update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODERN_SERVICE_KEY}`,
        "x-workspace-id": TEST_WORKSPACE_ID,
      },
    });
    const caller = await resolveCallerContext(req, undefined as never);
    assertEquals(caller.isServiceRole, true);
    assertEquals(caller.workspaceId, TEST_WORKSPACE_ID);
    assertEquals(caller.userId, null);
  });
});

Deno.test("resolveCallerContext accepts modern sb_secret apikey service callers", async () => {
  await withServiceEnv({ serviceKey: MODERN_SERVICE_KEY }, async () => {
    const req = new Request("https://example.test/customer-dna-update", {
      method: "POST",
      headers: {
        apikey: MODERN_SERVICE_KEY,
        "x-workspace-id": TEST_WORKSPACE_ID,
      },
    });
    const caller = await resolveCallerContext(req, undefined as never);
    assertEquals(caller.isServiceRole, true);
    assertEquals(caller.workspaceId, TEST_WORKSPACE_ID);
  });
});

Deno.test("resolveCallerContext keeps the DGE internal service-secret path", async () => {
  await withServiceEnv(
    { dgeInternalSecret: "dge-internal-test-only" },
    async () => {
      const req = new Request("https://example.test/customer-dna-update", {
        method: "POST",
        headers: {
          "x-internal-service-secret": "dge-internal-test-only",
          "x-workspace-id": TEST_WORKSPACE_ID,
        },
      });
      const caller = await resolveCallerContext(req, undefined as never);
      assertEquals(caller.isServiceRole, true);
      assertEquals(caller.workspaceId, TEST_WORKSPACE_ID);
    },
  );
});

Deno.test("resolveCallerContext does not infer a tenant from an opaque service key", async () => {
  await withServiceEnv({ serviceKey: MODERN_SERVICE_KEY }, async () => {
    const req = new Request("https://example.test/customer-dna-update", {
      method: "POST",
      headers: { Authorization: `Bearer ${MODERN_SERVICE_KEY}` },
    });
    const caller = await resolveCallerContext(req, undefined as never);
    assertEquals(caller.isServiceRole, true);
    assertEquals(caller.workspaceId, null);
  });
});

Deno.test("resolveCallerContext ignores unsigned workspace claims inside an exact service key", async () => {
  const encode = (value: Record<string, unknown>) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", "");
  const claimedServiceKey = `${encode({ alg: "none", typ: "JWT" })}.${
    encode({ role: "service_role", workspace_id: "workspace-forged" })
  }.signature`;
  await withServiceEnv({ serviceKey: claimedServiceKey }, async () => {
    const caller = await resolveCallerContext(
      new Request("https://example.test/customer-dna-update", {
        headers: { Authorization: `Bearer ${claimedServiceKey}` },
      }),
      undefined as never,
    );
    assertEquals(caller.isServiceRole, true);
    assertEquals(caller.workspaceId, null);
  });
});

Deno.test("resolveCallerContext ignores user-editable role and workspace metadata", async () => {
  const encode = (value: Record<string, unknown>) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", "");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${
    encode({
      sub: "user-1",
      user_metadata: {
        role: "owner",
        workspace_id: "workspace-attacker-selected",
      },
    })
  }.signature`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: {
          id: "user-1",
          role: "rep",
          active_workspace_id: "workspace-authoritative",
        },
        error: null,
      });
    },
  };

  try {
    const caller = await resolveCallerContext(
      new Request("https://example.test/customer-dna-update", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { from: () => query } as never,
    );
    assertEquals(caller.userId, "user-1");
    assertEquals(caller.role, "rep");
    assertEquals(caller.workspaceId, "workspace-authoritative");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

    if (originalInternalSecret === undefined) {
      Deno.env.delete("INTERNAL_SERVICE_SECRET");
    } else {
      Deno.env.set("INTERNAL_SERVICE_SECRET", originalInternalSecret);
    }

    if (originalDgeInternalSecret === undefined) {
      Deno.env.delete("DGE_INTERNAL_SERVICE_SECRET");
    } else {
      Deno.env.set("DGE_INTERNAL_SERVICE_SECRET", originalDgeInternalSecret);
    }
  },
});
