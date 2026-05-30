/**
 * H14 customer communication queueing.
 *
 * Records every customer-facing service notification in
 * service_customer_notifications, then lets service-customer-notify-dispatch
 * deliver email/SMS when credentials are configured. Missing providers or
 * missing recipients must never block the work-order workflow.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  insertPortalCustomerNotification,
  resolvePortalCustomerIdForJob,
} from "./portal-customer-notify.ts";
import { resolveCustomerRecipientForJob } from "./service-customer-recipient.ts";

export type ServiceCustomerNotificationType =
  | "quote_ready"
  | "awaiting_approval"
  | "schedule_confirmed"
  | "job_started"
  | "on_hold_parts"
  | "ready_for_pickup"
  | "job_completed"
  | "invoice_ready"
  | "promised_date_changed";

type QueueChannel = "portal" | "email" | "sms";

export interface QueueServiceCustomerNotificationInput {
  workspaceId: string;
  jobId: string;
  advisorId?: string | null;
  notificationType: ServiceCustomerNotificationType;
  stage?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
  previousPromisedAt?: unknown;
  newPromisedAt?: unknown;
}

const NOTIFICATION_COPY: Record<
  ServiceCustomerNotificationType,
  { title: string; body: string }
> = {
  quote_ready: {
    title: "Service quote available",
    body: "Your service quote is ready for review.",
  },
  awaiting_approval: {
    title: "Service estimate awaiting approval",
    body:
      "Your equipment is waiting on estimate approval before repair work can continue.",
  },
  schedule_confirmed: {
    title: "Service scheduled",
    body: "Your dealership confirmed the service appointment timing.",
  },
  job_started: {
    title: "Service work started",
    body: "Your machine is actively being worked on.",
  },
  on_hold_parts: {
    title: "Service on hold for parts",
    body: "Your service job is on hold while we wait on parts or sublet work.",
  },
  ready_for_pickup: {
    title: "Ready for pickup",
    body: "Your equipment is ready for pickup or final handoff.",
  },
  job_completed: {
    title: "Service completed",
    body: "Your machine is ready for pickup or final handoff.",
  },
  invoice_ready: {
    title: "Invoice ready",
    body: "A customer-facing invoice is now available.",
  },
  promised_date_changed: {
    title: "Promised service date updated",
    body: "The promised completion date for your service job has changed.",
  },
};

function formatPromisedDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value.trim();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
}

function renderCopy(
  input: QueueServiceCustomerNotificationInput,
): { title: string; body: string } {
  const fallback = NOTIFICATION_COPY[input.notificationType] ?? {
    title: "Service update",
    body: `Service update: ${input.notificationType}`,
  };

  if (input.notificationType !== "promised_date_changed") return fallback;

  const newDate = formatPromisedDate(input.newPromisedAt);
  const oldDate = formatPromisedDate(input.previousPromisedAt);
  return {
    title: fallback.title,
    body: newDate
      ? oldDate
        ? `The promised completion date changed from ${oldDate} to ${newDate}.`
        : `The promised completion date is now ${newDate}.`
      : fallback.body,
  };
}

async function insertAdvisorFallback(
  supabase: SupabaseClient,
  input: QueueServiceCustomerNotificationInput,
  copy: { title: string; body: string },
  reason: string,
) {
  if (!input.advisorId) return;
  const { error } = await supabase.from("crm_in_app_notifications").insert({
    workspace_id: input.workspaceId,
    user_id: input.advisorId,
    kind: "service_customer_contact_missing",
    title: "Customer notification fallback",
    body: `${copy.title}: ${reason}`,
    metadata: {
      job_id: input.jobId,
      notification_type: input.notificationType,
      stage: input.stage ?? null,
      h14_customer_communication: true,
    },
  });
  if (error) {
    console.warn(
      "queueServiceCustomerNotification advisor fallback:",
      error.message,
    );
  }
}

function isDuplicateError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

function isMissingDedupeColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42703";
}

export async function queueServiceCustomerNotification(
  supabase: SupabaseClient,
  input: QueueServiceCustomerNotificationInput,
): Promise<
  {
    status: "inserted" | "deduped" | "fallback_inserted";
    channel: QueueChannel;
  }
> {
  const resolved = await resolveCustomerRecipientForJob(supabase, input.jobId);
  const portalCustomerId = await resolvePortalCustomerIdForJob(
    supabase,
    input.jobId,
  );
  const copy = renderCopy(input);
  const channel: QueueChannel = resolved.email
    ? "email"
    : resolved.phone
    ? "sms"
    : "portal";
  const recipient = channel === "email"
    ? resolved.email
    : channel === "sms"
    ? resolved.phone
    : null;
  const metadata = {
    h14_customer_communication: true,
    delivery: channel === "portal"
      ? "recorded_no_external_recipient"
      : "queued",
    recipient_source: resolved.source,
    stage: input.stage ?? null,
    title: copy.title,
    body: copy.body,
    previous_promised_at: input.previousPromisedAt ?? null,
    new_promised_at: input.newPromisedAt ?? null,
    ...input.metadata,
  };
  const row = {
    workspace_id: input.workspaceId,
    job_id: input.jobId,
    notification_type: input.notificationType,
    channel,
    recipient,
    metadata,
    dedupe_key: input.dedupeKey,
  };

  const { error } = await supabase.from("service_customer_notifications")
    .insert(row);
  let status: "inserted" | "deduped" | "fallback_inserted" = "inserted";

  if (error) {
    if (isDuplicateError(error)) {
      status = "deduped";
    } else if (isMissingDedupeColumnError(error)) {
      const { dedupe_key: _dedupeKey, ...legacyRow } = row;
      const { error: fallbackError } = await supabase.from(
        "service_customer_notifications",
      ).insert(legacyRow);
      if (fallbackError && !isDuplicateError(fallbackError)) {
        throw fallbackError;
      }
      status = "fallback_inserted";
    } else {
      throw error;
    }
  }

  if (status === "deduped") return { status, channel };

  await insertPortalCustomerNotification(supabase, {
    workspace_id: input.workspaceId,
    portal_customer_id: portalCustomerId,
    category: "service",
    event_type: input.notificationType,
    channel,
    title: copy.title,
    body: copy.body,
    related_entity_type: "service_job",
    related_entity_id: input.jobId,
    metadata,
    dedupe_key: input.dedupeKey,
  });

  if (channel === "portal") {
    await insertAdvisorFallback(
      supabase,
      input,
      copy,
      "no customer email or phone is available; the update was recorded for portal/history instead.",
    );
  }

  return { status, channel };
}
