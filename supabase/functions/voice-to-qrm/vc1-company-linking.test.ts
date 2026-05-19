import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  assertCallerCanAccessLinkedCompany,
  buildVoiceCaptureInsertPayload,
  insertVoiceCaptureWithVc1Links,
  insertKnownCompanyOrDealActivity,
} from "./vc1-company-linking.ts";

Deno.test("assertCallerCanAccessLinkedCompany allows known accessible company", async () => {
  const id = await assertCallerCanAccessLinkedCompany(
    {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "company-1" }, error: null }),
          }),
        }),
      }),
    },
    "company-1",
  );

  assertEquals(id, "company-1");
});

Deno.test("assertCallerCanAccessLinkedCompany rejects inaccessible company with forbidden sentinel", async () => {
  await assertRejects(
    () =>
      assertCallerCanAccessLinkedCompany(
        {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        },
        "company-2",
      ),
    Error,
    "FORBIDDEN_LINKED_COMPANY",
  );
});

Deno.test("buildVoiceCaptureInsertPayload persists linked_company_id and related links", () => {
  const payload = buildVoiceCaptureInsertPayload({
    userId: "user-1",
    workspaceId: "ws-1",
    audioUrl: "u/1.webm",
    transcript: "hello",
    extractedData: { company: { name: "Acme" } },
    dealId: "deal-1",
    companyId: "company-1",
    contactId: "contact-1",
  });

  assertEquals(payload.linked_company_id, "company-1");
  assertEquals(payload.linked_deal_id, "deal-1");
  assertEquals(payload.linked_contact_id, "contact-1");
});

Deno.test("insertVoiceCaptureWithVc1Links succeeds and returns capture id", async () => {
  const payload = buildVoiceCaptureInsertPayload({
    userId: "user-1",
    workspaceId: "ws-1",
    audioUrl: "u/1.webm",
    transcript: "hello",
    extractedData: {},
    dealId: null,
    companyId: "company-1",
    contactId: null,
  });

  const inserted = await insertVoiceCaptureWithVc1Links(
    {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: "capture-1" }, error: null }),
          }),
        }),
      }),
    },
    payload,
  );

  assertEquals(inserted.id, "capture-1");
  assertEquals(payload.linked_company_id, "company-1");
});

Deno.test("insertVoiceCaptureWithVc1Links throws blocking error when insert fails", async () => {
  await assertRejects(
    () =>
      insertVoiceCaptureWithVc1Links(
        {
          from: () => ({
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        },
        {},
      ),
    Error,
    "Failed to persist voice capture.",
  );
});

Deno.test("insertKnownCompanyOrDealActivity inserts company_id and null deal_id for known-company notes", async () => {
  let inserted: any = null;
  await insertKnownCompanyOrDealActivity(
    {
      from: () => ({
        insert: async (payload) => {
          inserted = payload;
          return { error: null };
        },
      }),
    },
    {
      workspaceId: "ws-1",
      createdBy: "user-1",
      body: "note",
      companyId: "company-1",
      dealId: "deal-1",
      metadata: { source: "voice_to_qrm" },
    },
  );

  assertEquals(inserted?.company_id, "company-1");
  assertEquals(inserted?.deal_id, null);
});

Deno.test("insertKnownCompanyOrDealActivity throws blocking error when activity insert fails", async () => {
  await assertRejects(
    () =>
      insertKnownCompanyOrDealActivity(
        {
          from: () => ({
            insert: async () => ({ error: { message: "insert failed" } }),
          }),
        },
        {
          workspaceId: "ws-1",
          createdBy: "user-1",
          body: "note",
          companyId: "company-1",
          dealId: null,
          metadata: {},
        },
      ),
    Error,
    "Unable to create company activity timeline entry.",
  );
});
