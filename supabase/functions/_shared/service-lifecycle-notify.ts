/**
 * Shared lifecycle notification helpers for service_jobs stage changes
 * (used by service-job-router, service-quote-engine, service-haul-router).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  insertPortalCustomerNotification,
  resolvePortalCustomerIdForJob,
} from "./portal-customer-notify.ts";
import { resolveCustomerRecipientForJob } from "./service-customer-recipient.ts";

const PORTAL_NOTIFICATION_TITLES: Record<string, string> = {
  quote_ready: "Quote available",
  schedule_confirmed: "Service scheduled",
  job_started: "Service started",
  job_completed: "Service completed",
  invoice_ready: "Invoice ready",
};

const PORTAL_NOTIFICATION_BODIES: Record<string, string> = {
  quote_ready: "A service quote is ready for review in your customer portal.",
  schedule_confirmed: "Your dealership confirmed the service appointment timing.",
  job_started: "Your machine is actively being worked on.",
  job_completed: "Your machine is ready for pickup or final handoff.",
  invoice_ready: "A customer-facing invoice is now available in the portal.",
};

export async function notifyAfterStageChange(
  supabase: SupabaseClient,
  job: Record<string, unknown>,
  toStage: string,
) {
  const workspaceId = job.workspace_id as string;
  const jobId = job.id as string;
  const advisorId = job.advisor_id as string | null;
  const techId = job.technician_id as string | null;
  const smId = job.service_manager_id as string | null;
  const branchId = job.branch_id as string | null;

  const insertInApp = async (
    userId: string | null,
    kind: string,
    title: string,
    body: string,
  ) => {
    if (!userId) return;
    const { error } = await supabase.from("crm_in_app_notifications").insert({
      workspace_id: workspaceId,
      user_id: userId,
      kind,
      title,
      body,
      metadata: { job_id: jobId, stage: toStage },
    });
    if (error) console.warn("notifyAfterStageChange in_app:", error.message);
  };

  /**
   * Queue email/SMS only when a recipient exists; otherwise notify advisor in-app.
   * Recipient resolution order: see service-customer-recipient.ts.
   */
  const insertCustomerOutbound = async (notificationType: string) => {
    const resolved = await resolveCustomerRecipientForJob(supabase, jobId);
    const portalCustomerId = await resolvePortalCustomerIdForJob(supabase, jobId);
    const meta = {
      stage: toStage,
      delivery: "queued",
      recipient_source: resolved.source,
    } as Record<string, unknown>;
    let channel: "portal" | "email" | "sms" = "portal";

    if (resolved.email) {
      const { error } = await supabase.from("service_customer_notifications").insert({
        workspace_id: workspaceId,
        job_id: jobId,
        notification_type: notificationType,
        channel: "email",
        recipient: resolved.email,
        metadata: meta,
      });
      if (error) console.warn("notifyAfterStageChange customer outbound:", error.message);
      channel = "email";
    }

    if (channel === "portal" && resolved.phone) {
      const { error } = await supabase.from("service_customer_notifications").insert({
        workspace_id: workspaceId,
        job_id: jobId,
        notification_type: notificationType,
        channel: "sms",
        recipient: resolved.phone,
        metadata: meta,
      });
      if (error) console.warn("notifyAfterStageChange customer sms:", error.message);
      channel = "sms";
    }

    if (channel === "portal") {
      await insertInApp(
        advisorId,
        "service_customer_contact_missing",
        "Customer contact missing",
        `Cannot send "${notificationType}" — no customer email or phone on file for this job (${toStage}).`,
      );
    }

    await insertPortalCustomerNotification(supabase, {
      workspace_id: workspaceId,
      portal_customer_id: portalCustomerId,
      category: "service",
      event_type: notificationType,
      channel,
      title: PORTAL_NOTIFICATION_TITLES[notificationType] ?? notificationType,
      body: PORTAL_NOTIFICATION_BODIES[notificationType] ?? `Service update: ${notificationType}`,
      related_entity_type: "service_job",
      related_entity_id: jobId,
      metadata: meta,
      dedupe_key: `service:${jobId}:${notificationType}:${toStage}`,
    });
  };

  try {
    switch (toStage) {
      case "quote_sent":
        await insertCustomerOutbound("quote_ready");
        break;
      case "approved": {
        if (branchId) {
          const { data: cfg } = await supabase
            .from("service_branch_config")
            .select("parts_team_notify_user_ids")
            .eq("branch_id", branchId)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          const raw = cfg?.parts_team_notify_user_ids;
          const ids = Array.isArray(raw) ? raw as string[] : [];
          for (const uid of ids) {
            await insertInApp(
              uid,
              "service_parts_pending",
              "Parts needed",
              "Quote approved — plan fulfillment for this job",
            );
          }
        }
        await insertInApp(
          smId,
          "service_parts_pending",
          "Quote approved",
          "Job approved — coordinate parts",
        );
        await insertInApp(
          advisorId,
          "service_parts_pending",
          "Quote approved",
          "Job approved — parts workflow can start",
        );
        break;
      }
      case "parts_staged":
        await insertInApp(
          techId,
          "service_parts_ready",
          "Parts staged",
          "All parts staged — schedule or continue work",
        );
        break;
      case "scheduled":
        await insertCustomerOutbound("schedule_confirmed");
        break;
      case "in_progress":
        await insertCustomerOutbound("job_started");
        break;
      case "quality_check":
        await insertInApp(advisorId, "service_qc_needed", "Quality check", "Job in QC — review and close out");
        break;
      case "ready_for_pickup":
        await insertCustomerOutbound("job_completed");
        break;
      case "invoice_ready":
        await insertCustomerOutbound("invoice_ready");
        break;
      default:
        break;
    }
  } catch (e) {
    console.warn("notifyAfterStageChange:", e);
  }
}
