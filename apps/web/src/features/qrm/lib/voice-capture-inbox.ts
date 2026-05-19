import { crmSupabase } from "./qrm-supabase";
import type { Json } from "@/lib/database.types";
import type { QrmActivityFeedItem } from "./types";

export type VoiceCaptureInboxTarget =
  | { type: "company"; id: string }
  | { type: "contact"; id: string }
  | { type: "deal"; id: string };

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readVoiceCaptureMatchConfidence(activity: QrmActivityFeedItem): number | null {
  return asNumber(activity.metadata.matchConfidence);
}

export function isVoiceCaptureInboxActivity(activity: QrmActivityFeedItem): boolean {
  if (activity.metadata.source !== "voice_capture") return false;
  const targetSource = asString(activity.metadata.targetSource);
  const reviewedAt = asString(activity.metadata.voiceCaptureReviewedAt);
  if (reviewedAt) return false;
  if (targetSource === "inbox") return true;
  const confidence = readVoiceCaptureMatchConfidence(activity);
  return confidence != null && confidence < 0.7;
}

export async function assignVoiceCaptureInboxActivity(
  activity: QrmActivityFeedItem,
  target: VoiceCaptureInboxTarget,
  reviewerId: string,
): Promise<void> {
  const metadata = asRecord(activity.metadata);
  const previousTarget = {
    targetSource: asString(metadata.targetSource),
    dealId: activity.dealId,
    companyId: activity.companyId,
    contactId: activity.contactId,
  };

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    targetSource: target.type,
    resolvedDealId: target.type === "deal" ? target.id : null,
    resolvedCompanyId: target.type === "company" ? target.id : null,
    resolvedContactId: target.type === "contact" ? target.id : null,
    voiceCaptureInboxAudit: {
      reviewedBy: reviewerId,
      reviewedAt: new Date().toISOString(),
      previousTarget,
      nextTarget: {
        type: target.type,
        id: target.id,
      },
    },
    voiceCaptureReviewedAt: null,
  };

  const patch = {
    metadata: nextMetadata as Json,
    deal_id: target.type === "deal" ? target.id : null,
    company_id: target.type === "company" ? target.id : null,
    contact_id: target.type === "contact" ? target.id : null,
  };

  const { error } = await crmSupabase
    .from("crm_activities")
    .update(patch)
    .eq("id", activity.id)
    .eq("updated_at", activity.updatedAt)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  const voiceCaptureId = asString(metadata.voiceCaptureId);
  if (!voiceCaptureId) return;

  const { error: captureError } = await crmSupabase
    .from("voice_captures")
    .update({
      linked_deal_id: target.type === "deal" ? target.id : null,
      linked_company_id: target.type === "company" ? target.id : null,
      linked_contact_id: target.type === "contact" ? target.id : null,
    })
    .eq("id", voiceCaptureId);

  if (captureError) {
    throw new Error(captureError.message);
  }
}

export async function markVoiceCaptureInboxReviewed(
  activity: QrmActivityFeedItem,
  reviewerId: string,
): Promise<void> {
  const metadata = asRecord(activity.metadata);
  const { error } = await crmSupabase
    .from("crm_activities")
    .update({
      metadata: {
        ...metadata,
        voiceCaptureReviewedAt: new Date().toISOString(),
        voiceCaptureReviewedBy: reviewerId,
      } as Json,
    })
    .eq("id", activity.id)
    .eq("updated_at", activity.updatedAt)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }
}
