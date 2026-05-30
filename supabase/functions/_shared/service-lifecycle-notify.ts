/**
 * Shared lifecycle notification helpers for service_jobs stage changes
 * (used by service-job-router, service-quote-engine, service-haul-router).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  queueServiceCustomerNotification,
  type ServiceCustomerNotificationType,
} from "./service-customer-notification-queue.ts";

interface StageNotificationContext {
  blockerType?: string | null;
  blockerDescription?: string | null;
}

function notificationDedupeKey(
  jobId: string,
  notificationType: string,
  suffix?: string | null,
): string {
  return ["service", jobId, notificationType, suffix].filter(Boolean).join(":");
}

function stageEventSuffix(
  job: Record<string, unknown>,
  toStage: string,
): string {
  const enteredAt = typeof job.current_stage_entered_at === "string"
    ? job.current_stage_entered_at
    : null;
  return enteredAt ? `${toStage}:${safeDedupeDate(enteredAt)}` : toStage;
}

function safeDedupeDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

async function insertInApp(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    jobId: string;
    toStage: string;
    userId: string | null | undefined;
    kind: string;
    title: string;
    body: string;
  },
) {
  if (!params.userId) return;
  const { error } = await supabase.from("crm_in_app_notifications").insert({
    workspace_id: params.workspaceId,
    user_id: params.userId,
    kind: params.kind,
    title: params.title,
    body: params.body,
    metadata: { job_id: params.jobId, stage: params.toStage },
  });
  if (error) console.warn("notifyAfterStageChange in_app:", error.message);
}

export async function notifyAfterStageChange(
  supabase: SupabaseClient,
  job: Record<string, unknown>,
  toStage: string,
  context: StageNotificationContext = {},
) {
  const workspaceId = job.workspace_id as string;
  const jobId = job.id as string;
  const advisorId = job.advisor_id as string | null;
  const techId = job.technician_id as string | null;
  const smId = job.service_manager_id as string | null;
  const branchId = job.branch_id as string | null;

  /**
   * Queue customer-facing history + email/SMS delivery when possible.
   * Missing provider credentials are handled by service-customer-notify-dispatch;
   * missing recipients fall back to portal/history + advisor in-app warning.
   */
  const queueCustomerOutbound = async (
    notificationType: ServiceCustomerNotificationType,
    suffix = stageEventSuffix(job, toStage),
    metadata: Record<string, unknown> = {},
  ) => {
    await queueServiceCustomerNotification(supabase, {
      workspaceId,
      jobId,
      advisorId,
      notificationType,
      stage: toStage,
      dedupeKey: notificationDedupeKey(jobId, notificationType, suffix),
      metadata,
    });
  };

  try {
    switch (toStage) {
      case "quote_sent":
        await queueCustomerOutbound("awaiting_approval");
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
            await insertInApp(supabase, {
              workspaceId,
              jobId,
              toStage,
              userId: uid,
              kind: "service_parts_pending",
              title: "Parts needed",
              body: "Quote approved — plan fulfillment for this job",
            });
          }
        }
        await insertInApp(supabase, {
          workspaceId,
          jobId,
          toStage,
          userId: smId,
          kind: "service_parts_pending",
          title: "Quote approved",
          body: "Job approved — coordinate parts",
        });
        await insertInApp(supabase, {
          workspaceId,
          jobId,
          toStage,
          userId: advisorId,
          kind: "service_parts_pending",
          title: "Quote approved",
          body: "Job approved — parts workflow can start",
        });
        break;
      }
      case "parts_staged":
        await insertInApp(supabase, {
          workspaceId,
          jobId,
          toStage,
          userId: techId,
          kind: "service_parts_ready",
          title: "Parts staged",
          body: "All parts staged — schedule or continue work",
        });
        break;
      case "scheduled":
        await queueCustomerOutbound("schedule_confirmed");
        break;
      case "in_progress":
        await queueCustomerOutbound("job_started");
        break;
      case "blocked_waiting":
        if (context.blockerType === "waiting_on_parts_sublet") {
          await queueCustomerOutbound(
            "on_hold_parts",
            `${stageEventSuffix(job, toStage)}:waiting_on_parts_sublet`,
            {
              blocker_type: context.blockerType,
              blocker_description: context.blockerDescription ?? null,
            },
          );
        }
        break;
      case "quality_check":
        await insertInApp(supabase, {
          workspaceId,
          jobId,
          toStage,
          userId: advisorId,
          kind: "service_qc_needed",
          title: "Quality check",
          body: "Job in QC — review and close out",
        });
        break;
      case "ready_for_pickup":
        await queueCustomerOutbound("ready_for_pickup");
        break;
      case "invoice_ready":
        await queueCustomerOutbound("invoice_ready");
        break;
      default:
        break;
    }
  } catch (e) {
    console.warn("notifyAfterStageChange:", e);
  }
}

export async function notifyPromisedDateChanged(
  supabase: SupabaseClient,
  job: Record<string, unknown>,
  previousPromisedAt: unknown,
  newPromisedAt: unknown,
) {
  const workspaceId = job.workspace_id as string;
  const jobId = job.id as string;
  const advisorId = job.advisor_id as string | null;
  const newDate = typeof newPromisedAt === "string"
    ? newPromisedAt
    : String(newPromisedAt ?? "");
  if (!newDate.trim()) return;

  try {
    await queueServiceCustomerNotification(supabase, {
      workspaceId,
      jobId,
      advisorId,
      notificationType: "promised_date_changed",
      stage: typeof job.current_stage === "string" ? job.current_stage : null,
      dedupeKey: notificationDedupeKey(
        jobId,
        "promised_date_changed",
        `${safeDedupeDate(previousPromisedAt)}:${safeDedupeDate(newDate)}`,
      ),
      previousPromisedAt,
      newPromisedAt,
      metadata: {
        previous_promised_at: previousPromisedAt ?? null,
        new_promised_at: newPromisedAt ?? null,
      },
    });
  } catch (e) {
    console.warn("notifyPromisedDateChanged:", e);
  }
}
