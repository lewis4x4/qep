import { beforeEach, describe, expect, mock, test } from "bun:test";

const inserts: Array<Record<string, unknown>> = [];
let authUser: { id: string } | null = { id: "rep-1" };

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.select = mock(() => chain);
  chain.eq = mock(() => chain);
  chain.maybeSingle = mock(async () => ({ data: { active_workspace_id: "ws-1" }, error: null }));
  chain.insert = mock(async (payload: Record<string, unknown>) => {
    inserts.push(payload);
    return { error: null };
  });
  return chain;
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: mock(async () => ({ data: { user: authUser } })) },
    from: mock(() => makeChain()),
  },
}));

const { logSalesActivity } = await import("../sales-api");

describe("logSalesActivity insert payloads", () => {
  beforeEach(() => {
    inserts.length = 0;
    authUser = { id: "rep-1" };
  });

  test("deal tap inserts deal_id subject and clears company_id", async () => {
    await logSalesActivity({ activityType: "call", dealId: "deal-1", companyId: "company-1" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      created_by: "rep-1",
      activity_type: "call",
      deal_id: "deal-1",
      company_id: null,
      contact_id: null,
    });
  });

  test("customer tap inserts company_id subject with no deal_id", async () => {
    await logSalesActivity({ activityType: "email", companyId: "company-9" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      created_by: "rep-1",
      activity_type: "email",
      company_id: "company-9",
      deal_id: null,
      contact_id: null,
    });
  });

  test("throws before insert when the rep is not authenticated", async () => {
    authUser = null;

    await expect(
      logSalesActivity({ activityType: "call", companyId: "company-1" }),
    ).rejects.toThrow("Not authenticated");

    expect(inserts).toHaveLength(0);
  });

  test("throws before insert when no deal or customer subject is supplied", async () => {
    await expect(logSalesActivity({ activityType: "call" })).rejects.toThrow(
      "A company, deal, or contact subject is required",
    );

    expect(inserts).toHaveLength(0);
  });

  test("visit quick action inserts the DB meeting activity type", async () => {
    await logSalesActivity({ activityType: "visit", companyId: "company-1" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      created_by: "rep-1",
      activity_type: "meeting",
      company_id: "company-1",
      deal_id: null,
      contact_id: null,
    });
  });
});
