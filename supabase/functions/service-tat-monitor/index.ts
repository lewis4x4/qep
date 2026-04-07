/**
 * Service TAT Monitor (Cron: every 5 minutes)
 *
 * Checks elapsed time in current stage for every active service job.
 * Fires alerts to advisors/managers when TAT exceeds targets.
 * Machine-down jobs use compressed SLA targets.
 *
 * Auth: service_role (cron invocation)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const DEFAULT_TARGETS: Record<string, number> = {
  request_received: 2,
  triaging: 4,
  diagnosis_selected: 8,
  quote_drafted: 4,
  quote_sent: 24,
  approved: 2,
  parts_pending: 48,
  parts_staged: 4,
  haul_scheduled: 24,
  scheduled: 48,
  in_progress: 72,
  blocked_waiting: 24,
  quality_check: 4,
  ready_for_pickup: 8,
  invoice_ready: 24,
  invoiced: 168,
};

const MACHINE_DOWN_TARGETS: Record<string, number> = {
  request_received: 0.5,
  triaging: 1,
  diagnosis_selected: 2,
  quote_drafted: 1,
  quote_sent: 4,
  approved: 0.5,
  parts_pending: 8,
  parts_staged: 1,
  haul_scheduled: 4,
  scheduled: 8,
  in_progress: 24,
  blocked_waiting: 2,
  quality_check: 1,
  ready_for_pickup: 2,
  invoice_ready: 4,
  invoiced: 48,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    if (req.method === "GET") {
      return safeJsonOk({
        ok: true,
        function: "service-tat-monitor",
        ts: new Date().toISOString(),
      }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    const results = {
      jobs_checked: 0,
      warnings_created: 0,
      escalations_created: 0,
      customer_delay_notices: 0,
    };

    // Fetch all active (non-closed, non-terminal) service jobs
    const { data: jobs } = await supabase
      .from("service_jobs")
      .select(
        "id, workspace_id, current_stage, status_flags, advisor_id, service_manager_id, current_stage_entered_at, updated_at",
      )
      .is("closed_at", null)
      .is("deleted_at", null)
      .neq("current_stage", "paid_closed");

    if (!jobs || jobs.length === 0) {
      return safeJsonOk({ ok: true, results }, null);
    }

    const workspaceIds = [...new Set(jobs.map((j) => j.workspace_id as string))];
    const { data: tatRows } = await supabase
      .from("service_tat_targets")
      .select("workspace_id, current_stage, target_hours, machine_down_target_hours")
      .in("workspace_id", workspaceIds);

    const tatKey = (ws: string, stage: string) => `${ws}::${stage}`;
    const tatMap = new Map<
      string,
      { target_hours: number; machine_down_target_hours: number }
    >();
    for (const r of tatRows ?? []) {
      tatMap.set(tatKey(r.workspace_id as string, r.current_stage as string), {
        target_hours: Number(r.target_hours),
        machine_down_target_hours: Number(r.machine_down_target_hours),
      });
    }

    const targetHoursFor = (
      workspaceId: string,
      stage: string,
      isMachineDown: boolean,
    ): number | undefined => {
      const row = tatMap.get(tatKey(workspaceId, stage));
      if (row) {
        return isMachineDown
          ? row.machine_down_target_hours
          : row.target_hours;
      }
      const fallback = isMachineDown ? MACHINE_DOWN_TARGETS : DEFAULT_TARGETS;
      return fallback[stage];
    };

    // Fetch managers for escalation
    const { data: managers } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["manager", "owner"]);
    const managerIds = (managers ?? []).map((m) => m.id);

    const now = Date.now();

    for (const job of jobs) {
      results.jobs_checked++;
      const isMachineDown = Array.isArray(job.status_flags) &&
        job.status_flags.includes("machine_down");
      const targetHours = targetHoursFor(
        job.workspace_id as string,
        job.current_stage as string,
        isMachineDown,
      );
      if (targetHours == null || Number.isNaN(targetHours)) continue;

      const stageStart = job.current_stage_entered_at ?? job.updated_at;
      const elapsedHours = (now - new Date(stageStart as string).getTime()) / 3_600_000;
      if (elapsedHours <= targetHours) continue;

      // Check for existing recent warning
      const { data: existing } = await supabase
        .from("crm_in_app_notifications")
        .select("id")
        .eq("kind", "service_tat_warning")
        .eq("metadata->>job_id", job.id)
        .eq("metadata->>stage", job.current_stage)
        .gte("created_at", new Date(now - 3_600_000).toISOString())
        .maybeSingle();

      if (existing) continue;

      // Alert advisor
      if (job.advisor_id) {
        await supabase.from("crm_in_app_notifications").insert({
          workspace_id: job.workspace_id,
          user_id: job.advisor_id,
          kind: "service_tat_warning",
          title: `TAT Warning: Service Job`,
          body: `Stage "${job.current_stage}" has exceeded target by ${Math.round(elapsedHours - targetHours)}h${isMachineDown ? " (MACHINE DOWN)" : ""}`,
          metadata: {
            job_id: job.id,
            stage: job.current_stage,
            elapsed_hours: Math.round(elapsedHours * 10) / 10,
            target_hours: targetHours,
            is_machine_down: isMachineDown,
            type: "warning",
          },
        });
        results.warnings_created++;
      }

      // Customer-facing delay advisory at 1.5x target (portal notification log)
      if (elapsedHours > targetHours * 1.5) {
        const { data: dup } = await supabase
          .from("service_customer_notifications")
          .select("id")
          .eq("job_id", job.id)
          .eq("notification_type", "tat_delay_advisory")
          .gte("sent_at", new Date(now - 24 * 3_600_000).toISOString())
          .maybeSingle();
        if (!dup) {
          await supabase.from("service_customer_notifications").insert({
            workspace_id: job.workspace_id,
            job_id: job.id,
            notification_type: "tat_delay_advisory",
            channel: "portal",
            recipient: null,
            metadata: {
              stage: job.current_stage,
              elapsed_hours: Math.round(elapsedHours * 10) / 10,
              target_hours: targetHours,
              message:
                "Your service may be taking longer than expected. Our team is working on it.",
            },
          });
          results.customer_delay_notices++;
        }
      }

      // Escalate if critically over (2x target)
      if (elapsedHours > targetHours * 2) {
        const escalateIds = [
          ...(job.service_manager_id ? [job.service_manager_id] : []),
          ...managerIds,
        ];
        const uniqueIds = [...new Set(escalateIds)];

        for (const userId of uniqueIds) {
          await supabase.from("crm_in_app_notifications").insert({
            workspace_id: job.workspace_id,
            user_id: userId,
            kind: "service_tat_escalation",
            title: `TAT Escalation: Service Job`,
            body: `Stage "${job.current_stage}" is critically overdue (${Math.round(elapsedHours)}h vs ${targetHours}h target)${isMachineDown ? " — MACHINE DOWN" : ""}`,
            metadata: {
              job_id: job.id,
              stage: job.current_stage,
              elapsed_hours: Math.round(elapsedHours * 10) / 10,
              target_hours: targetHours,
              is_machine_down: isMachineDown,
              type: "escalation",
            },
          });
        }
        results.escalations_created++;
      }

      // Upsert TAT metrics row
      const { data: existingMetric } = await supabase
        .from("service_tat_metrics")
        .select("id")
        .eq("job_id", job.id)
        .eq("segment_name", job.current_stage)
        .is("completed_at", null)
        .maybeSingle();

      if (existingMetric) {
        await supabase
          .from("service_tat_metrics")
          .update({
            actual_duration_hours: Math.round(elapsedHours * 100) / 100,
          })
          .eq("id", existingMetric.id);
      } else {
        await supabase.from("service_tat_metrics").insert({
          workspace_id: job.workspace_id,
          job_id: job.id,
          segment_name: job.current_stage,
          started_at: job.current_stage_entered_at ?? job.updated_at,
          target_duration_hours: targetHours,
          actual_duration_hours: Math.round(elapsedHours * 100) / 100,
          is_machine_down: isMachineDown,
        });
      }
    }

    await logServiceCronRun(supabase, {
      jobName: "service-tat-monitor",
      ok: true,
      metadata: { results },
    });

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "service-tat-monitor", req });
    console.error("service-tat-monitor error:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "service-tat-monitor",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch {
      /* ignore secondary logging failures */
    }
    return safeJsonError("Internal server error", 500, null);
  }
});
