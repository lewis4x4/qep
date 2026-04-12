import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

interface ReceiptRow {
  id: string;
  processed_at: string | null;
}

export async function claimCommunicationWebhookReceipt(params: {
  admin: SupabaseClient;
  workspaceId: string;
  provider: "sendgrid" | "twilio";
  eventId: string;
  payloadHash: string | null;
  routeBindingKey: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; alreadyProcessed: boolean }> {
  const { data, error } = await params.admin
    .from("crm_communication_webhook_receipts")
    .upsert({
      workspace_id: params.workspaceId,
      provider: params.provider,
      event_id: params.eventId,
      payload_hash: params.payloadHash,
      route_binding_key: params.routeBindingKey,
      metadata: params.metadata ?? {},
    }, {
      onConflict: "workspace_id,provider,event_id",
      ignoreDuplicates: false,
    })
    .select("id, processed_at")
    .single<ReceiptRow>();

  if (error || !data) {
    throw new Error(`Failed to claim communication webhook receipt: ${error?.message ?? "unknown error"}`);
  }

  return {
    id: data.id,
    alreadyProcessed: Boolean(data.processed_at),
  };
}

export async function completeCommunicationWebhookReceipt(
  admin: SupabaseClient,
  receiptId: string,
): Promise<void> {
  const { error } = await admin
    .from("crm_communication_webhook_receipts")
    .update({
      processed_at: new Date().toISOString(),
    })
    .eq("id", receiptId);

  if (error) {
    throw new Error(`Failed to complete communication webhook receipt: ${error.message}`);
  }
}
