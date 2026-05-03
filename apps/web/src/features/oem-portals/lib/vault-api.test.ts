import { describe, expect, mock, test, beforeEach } from "bun:test";

type InvokeCall = { name: string; options: { body: unknown } };
const invokeCalls: InvokeCall[] = [];
let nextInvokeResponse: { data: unknown; error: unknown } = { data: null, error: null };

mock.module("@/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, options: { body: unknown }) => {
        invokeCalls.push({ name, options });
        return nextInvokeResponse;
      },
    },
  },
}));

const { vaultApi, oemVaultQueryKeys } = await import("./vault-api");

const credential = {
  id: "c1",
  workspace_id: "workspace-1",
  oem_portal_profile_id: "p1",
  kind: "shared_login",
  label: "A",
  has_username: true,
  has_secret: true,
  has_totp: false,
  totp_issuer: null,
  totp_account: null,
  encryption_version: "2",
  expires_at: null,
  rotation_interval_days: null,
  last_rotated_at: null,
  last_rotated_by: null,
  last_revealed_at: null,
  last_revealed_by: null,
  reveal_count: "3",
  reveal_allowed_for_reps: true,
  notes: null,
  created_by: null,
  created_at: "2026-05-03T12:00:00Z",
  updated_at: "2026-05-03T12:30:00Z",
};

beforeEach(() => {
  invokeCalls.length = 0;
  nextInvokeResponse = { data: null, error: null };
});

describe("vaultApi.list", () => {
  test("invokes oem-portal-vault with list action and unwraps credentials", async () => {
    nextInvokeResponse = {
      data: {
        credentials: [credential, { id: "bad", kind: "bad" }],
      },
      error: null,
    };
    const rows = await vaultApi.list("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("c1");
    expect(rows[0].encryption_version).toBe(2);
    expect(rows[0].reveal_count).toBe(3);
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].name).toBe("oem-portal-vault");
    expect(invokeCalls[0].options.body).toEqual({ action: "list", portal_id: "p1" });
  });

  test("returns [] when server returns no credentials", async () => {
    nextInvokeResponse = { data: { credentials: null }, error: null };
    const rows = await vaultApi.list("p1");
    expect(rows).toEqual([]);
  });
});

describe("vaultApi.reveal", () => {
  test("forwards reason and returns payload", async () => {
    nextInvokeResponse = {
      data: { username: "ops", secret: "Tr0ub4dor!", expires_in_ms: 30000 },
      error: null,
    };
    const out = await vaultApi.reveal("cred-1", "Customer call in 30s");
    expect(out.username).toBe("ops");
    expect(out.secret).toBe("Tr0ub4dor!");
    expect(out.expires_in_ms).toBe(30000);
    expect(invokeCalls[0].options.body).toEqual({
      action: "reveal",
      credential_id: "cred-1",
      reason: "Customer call in 30s",
    });
  });

  test("rejects malformed reveal payloads", async () => {
    nextInvokeResponse = { data: { username: "ops" }, error: null };
    await expect(vaultApi.reveal("cred-1", null)).rejects.toThrow("Malformed reveal response");
  });

  test("throws with server error body when non-2xx", async () => {
    nextInvokeResponse = {
      data: { error: "Rate limited — too many reveals" },
      error: { message: "Edge Function returned a non-2xx status code" },
    };
    await expect(vaultApi.reveal("cred-2", null)).rejects.toThrow(
      "Rate limited — too many reveals",
    );
  });
});

describe("vaultApi.create", () => {
  test("passes kind and body through", async () => {
    nextInvokeResponse = { data: { credential_id: "new-1" }, error: null };
    const out = await vaultApi.create({
      portal_id: "p1",
      kind: "api_key",
      label: "Parts API",
      secret: "pk_live_abc",
      reveal_allowed_for_reps: false,
    });
    expect(out.credential_id).toBe("new-1");
    expect(invokeCalls[0].options.body).toMatchObject({
      action: "create",
      portal_id: "p1",
      kind: "api_key",
      label: "Parts API",
    });
  });
});

describe("vaultApi.audit", () => {
  test("normalizes audit events and filters malformed rows", async () => {
    nextInvokeResponse = {
      data: {
        events: [
          {
            id: "event-1",
            event_type: "revealed",
            actor_user_id: "user-1",
            actor_role: "manager",
            reason: "Customer call",
            changed_fields: ["last_revealed_at"],
            metadata: { request_id: "req-1" },
            request_id: "req-1",
            ip: "127.0.0.1",
            user_agent: "bun-test",
            occurred_at: "2026-05-03T12:00:00Z",
            credential_id: "cred-1",
          },
          { id: "event-2", event_type: "bad", occurred_at: "2026-05-03T12:00:00Z" },
        ],
      },
      error: null,
    };

    const rows = await vaultApi.audit("p1");
    expect(rows).toEqual([{
      id: "event-1",
      event_type: "revealed",
      actor_user_id: "user-1",
      actor_role: "manager",
      reason: "Customer call",
      changed_fields: ["last_revealed_at"],
      metadata: { request_id: "req-1" },
      request_id: "req-1",
      ip: "127.0.0.1",
      user_agent: "bun-test",
      occurred_at: "2026-05-03T12:00:00Z",
      credential_id: "cred-1",
    }]);
  });
});

describe("vaultApi.totpCode", () => {
  test("returns {code, remaining_seconds}", async () => {
    nextInvokeResponse = {
      data: { code: "287082", remaining_seconds: 14, period_seconds: 30, issuer: null, account: null },
      error: null,
    };
    const out = await vaultApi.totpCode("cred-1");
    expect(out.code).toBe("287082");
    expect(out.remaining_seconds).toBe(14);
  });

  test("rejects malformed TOTP payloads", async () => {
    nextInvokeResponse = {
      data: { code: "", remaining_seconds: 14, period_seconds: 30 },
      error: null,
    };
    await expect(vaultApi.totpCode("cred-1")).rejects.toThrow("Malformed TOTP response");
  });
});

describe("oemVaultQueryKeys", () => {
  test("produces stable keys", () => {
    expect(oemVaultQueryKeys.list("p1")).toEqual(["oem-portal-credentials", "p1"]);
    expect(oemVaultQueryKeys.audit("p1")).toEqual(["oem-portal-credential-audit", "p1"]);
    expect(oemVaultQueryKeys.totp("c1")).toEqual(["oem-portal-totp", "c1"]);
  });
});
