/**
 * Service Notifications — Dispatch lifecycle notifications for service jobs.
 *
 * Auth: user JWT only
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface NotifyRequest {
  job_id: string;
  notification_type: string;
  recipient_user_id?: string;
  recipient_contact?: string;
  channel?: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

const NOTIFICATION_TITLES: Record<string, string> = {
  quote_ready: "Service Quote Ready",
  quote_approved: "Quote Approved",
  parts_delayed: "Parts Delayed",
  job_started: "Service Work Started",
  job_completed: "Service Work Completed",
  invoice_ready: "Invoice Ready",
  machine_down_update: "Machine Down Update",
  parts_ready: "All Parts Staged",
  schedule_confirmed: "Service Scheduled",
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const body: NotifyRequest = await req.json();
    if (!body.job_id || !body.notification_type) {
      return safeJsonError("job_id and notification_type required", 400, origin);
    }

    const { data: job } = await supabase
      .from("service_jobs")
      .select("id, workspace_id, advisor_id, service_manager_id, technician_id")
      .eq("id", body.job_id)
      .single();

    if (!job) return safeJsonError("Job not found", 404, origin);

    const title = body.title ?? NOTIFICATION_TITLES[body.notification_type] ?? "Service Update";
    const notifBody = body.body ?? `Service job notification: ${body.notification_type}`;
    const channel = body.channel ?? "in_app";

    // In-app notification to specified user or advisor
    const recipientId = body.recipient_user_id ?? job.advisor_id;
    if (recipientId) {
      await supabase.from("crm_in_app_notifications").insert({
        workspace_id: job.workspace_id,
        user_id: recipientId,
        kind: `service_${body.notification_type}`,
        title,
        body: notifBody,
        metadata: { job_id: body.job_id, ...body.metadata },
      });
    }

    // Log customer notification
    await supabase.from("service_customer_notifications").insert({
      workspace_id: job.workspace_id,
      job_id: body.job_id,
      notification_type: body.notification_type,
      channel,
      recipient: body.recipient_contact ?? null,
      metadata: body.metadata ?? {},
    });

    return safeJsonOk({ sent: true, notification_type: body.notification_type }, origin);
  } catch (err) {
    console.error("service-notifications error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
