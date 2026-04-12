import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  computeCampaignIneligibility,
  computeDirectCommunicationIneligibility,
  fetchCommunicationBinding,
  interpolateCommunicationTemplate,
  summarizeBodyPreview,
  type CommunicationBinding,
  type CommunicationContact,
} from "./crm-communication-helpers.ts";

const baseContact: CommunicationContact = {
  id: "contact_1",
  workspaceId: "default",
  firstName: "Rylee",
  lastName: "McKenzie",
  email: "rylee@example.com",
  phone: "+13865551212",
  title: "Sales Manager",
  smsOptIn: true,
  smsOptInAt: "2026-04-01T12:00:00.000Z",
  smsOptInSource: "trade_show",
  companyName: "QEP USA",
};

const twilioBinding: CommunicationBinding = {
  provider: "twilio",
  workspaceId: "default",
  endpointUrl: null,
  credentials: { account_sid: "AC123", auth_token: "secret" },
  accountId: "AC123",
  fromEmail: null,
  fromName: null,
  defaultFromNumber: "+13865550000",
  routeToken: "a".repeat(32),
  webhookVerificationKey: null,
};

function makeAdminClient(row: {
  workspace_id: string;
  endpoint_url: string | null;
  credentials_encrypted: string | null;
  config: Record<string, unknown> | null;
} | null): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };

  return {
    from: () => query,
  } as unknown as SupabaseClient;
}

Deno.test("interpolateCommunicationTemplate replaces supported merge tokens", () => {
  const result = interpolateCommunicationTemplate(
    "Hi {{ first_name }}, this is {{company_name}} calling your {{title}} line at {{phone}}.",
    baseContact,
  );
  assertEquals(
    result,
    "Hi Rylee, this is QEP USA calling your Sales Manager line at +13865551212.",
  );
});

Deno.test("computeCampaignIneligibility rejects SMS without full consent tuple", () => {
  assertEquals(
    computeCampaignIneligibility("sms", { ...baseContact, smsOptInSource: null }, twilioBinding),
    "sms_opt_in_source_required",
  );
});

Deno.test("computeCampaignIneligibility allows fully opted-in SMS recipients", () => {
  assertEquals(computeCampaignIneligibility("sms", baseContact, twilioBinding), null);
});

Deno.test("computeDirectCommunicationIneligibility allows one-to-one SMS without consent tuple metadata", () => {
  assertEquals(
    computeDirectCommunicationIneligibility(
      "sms",
      { ...baseContact, smsOptInAt: null, smsOptInSource: null },
      twilioBinding,
    ),
    null,
  );
});

Deno.test("computeDirectCommunicationIneligibility still requires one-to-one SMS opt-in", () => {
  assertEquals(
    computeDirectCommunicationIneligibility(
      "sms",
      { ...baseContact, smsOptIn: false },
      twilioBinding,
    ),
    "sms_opt_in_required",
  );
});

Deno.test("fetchCommunicationBinding returns null when connected Twilio credentials cannot be decrypted", async () => {
  const binding = await fetchCommunicationBinding({
    admin: makeAdminClient({
      workspace_id: "default",
      endpoint_url: "https://api.twilio.com",
      credentials_encrypted: "ciphertext",
      config: {
        communication_binding: {
          default_from_number: "+13865550000",
        },
      },
    }),
    workspaceId: "default",
    provider: "twilio",
    decryptCredential: async () => {
      throw new Error("missing integration encryption key");
    },
  });

  assertEquals(binding, null);
});

Deno.test("summarizeBodyPreview squashes whitespace and clips long bodies", () => {
  const preview = summarizeBodyPreview("Line one.\n\nLine two. ".repeat(20));
  assertEquals(preview?.includes("\n"), false);
  assertEquals((preview?.length ?? 0) <= 160, true);
});
