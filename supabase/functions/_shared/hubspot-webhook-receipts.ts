import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface HubSpotWebhookReceiptEvent {
  portalId: number;
  objectId: number;
  subscriptionType: string;
  propertyName: string;
  propertyValue: string;
  occurredAt: number;
}

export interface ReceiptClaim {
  kind: "claimed" | "duplicate";
  receiptId: string | null;
  receiptKey: string;
}

function normalizeReceiptPart(value: string | number): string {
  return String(value).trim().toLowerCase();
}

function buildReceiptKey(event: HubSpotWebhookReceiptEvent): string {
  return [
    normalizeReceiptPart(event.portalId),
    normalizeReceiptPart(event.objectId),
    normalizeReceiptPart(event.subscriptionType),
    normalizeReceiptPart(event.propertyName),
    normalizeReceiptPart(event.propertyValue),
    normalizeReceiptPart(event.occurredAt),
  ].join(":");
}

async function sha256Hex(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function claimWebhookReceipt(
  supabase: SupabaseClient,
  event: HubSpotWebhookReceiptEvent,
): Promise<ReceiptClaim> {
  const receiptKey = buildReceiptKey(event);
  const payloadHash = await sha256Hex(JSON.stringify(event));

  const { data, error } = await supabase
    .from("hubspot_webhook_receipts")
    .insert({
      receipt_key: receiptKey,
      hub_id: String(event.portalId),
      payload_hash: payloadHash,
      processing_status: "received",
    })
    .select("id")
    .limit(1);

  if (error) {
    if (error.code === "23505") {
      const { data: reclaimRows, error: reclaimError } = await supabase
        .from("hubspot_webhook_receipts")
        .update({
          // Reclaim previously failed receipts for safe retry processing.
          processing_status: "received",
          error: null,
        })
        .eq("receipt_key", receiptKey)
        .in("processing_status", ["received", "skipped_duplicate"])
        .not("error", "is", null)
        .select("id")
        .limit(1);

      if (reclaimError) {
        throw new Error(
          `Failed to reclaim webhook receipt for retry: ${reclaimError.message}`,
        );
      }

      if (reclaimRows?.[0]?.id) {
        return {
          kind: "claimed",
          receiptId: reclaimRows[0].id,
          receiptKey,
        };
      }

      return { kind: "duplicate", receiptId: null, receiptKey };
    }

    throw new Error(`Failed to claim webhook receipt: ${error.message}`);
  }

  return {
    kind: "claimed",
    receiptId: data?.[0]?.id ?? null,
    receiptKey,
  };
}

export async function markReceiptProcessed(
  supabase: SupabaseClient,
  receiptId: string | null,
): Promise<void> {
  if (!receiptId) return;
  await supabase
    .from("hubspot_webhook_receipts")
    .update({ processing_status: "processed", error: null })
    .eq("id", receiptId);
}

export async function markReceiptSkippedDuplicate(
  supabase: SupabaseClient,
  receiptKey: string,
): Promise<void> {
  await supabase
    .from("hubspot_webhook_receipts")
    .update({ processing_status: "skipped_duplicate" })
    .eq("receipt_key", receiptKey)
    .eq("processing_status", "processed");
}

export async function markReceiptError(
  supabase: SupabaseClient,
  receiptId: string | null,
  reason: string,
): Promise<void> {
  if (!receiptId) return;
  await supabase
    .from("hubspot_webhook_receipts")
    .update({ processing_status: "received", error: reason })
    .eq("id", receiptId);
}
