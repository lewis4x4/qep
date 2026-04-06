/**
 * Vendor escalation worker — seeds escalations from late/missing PO lines, then
 * advances vendor_escalations when next_action_at is due (policy step actions).
 * Cron: service_role every 15 minutes (or GitHub Actions).
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { mirrorToFulfillmentRun } from "../_shared/parts-fulfillment-mirror.ts";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";
import { sendVendorEscalationEmail } from "../_shared/vendor-escalation-resend.ts";

type EscalationRow = {
  id: string;
  workspace_id: string;
  vendor_id: string;
  job_id: string | null;
  policy_id: string | null;
  current_step: number | null;
  next_action_at: string | null;
};

function hoursFromStep(s: Record<string, unknown>): number {
  return Number(s.hours ?? s.after_hours ?? 24);
}

function stepAction(step: Record<string, unknown> | undefined): string {
  const a = step?.action ?? step?.type ?? step?.step_action;
  return typeof a === "string" && a.length > 0 ? a : "notify_advisor";
}

/** Create vendor_escalations for open order actions that are late or missing PO past grace. */
async function seedEscalationsFromLateOrders(supabase: SupabaseClient): Promise<number> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const missingPoGraceMs = 72 * 3600_000;

  const { data: actions, error } = await supabase
    .from("service_parts_actions")
    .select(
      "id, workspace_id, job_id, requirement_id, vendor_id, po_reference, expected_date, created_at",
    )
    .eq("action_type", "order")
    .is("completed_at", null)
    .is("superseded_at", null);

  if (error || !actions?.length) return 0;

  let seeded = 0;
  for (const a of actions) {
    const jobId = a.job_id as string;
    const expected = a.expected_date ? new Date(a.expected_date as string).getTime() : null;
    const created = new Date(a.created_at as string).getTime();
    const late = expected != null && expected < now;
    const missingPo =
      !(a.po_reference as string | null)?.trim() &&
      now - created > missingPoGraceMs;
    if (!late && !missingPo) continue;

    let vendorId = a.vendor_id as string | null;
    if (!vendorId && a.requirement_id) {
      const { data: req } = await supabase
        .from("service_parts_requirements")
        .select("vendor_id")
        .eq("id", a.requirement_id as string)
        .maybeSingle();
      vendorId = req?.vendor_id ?? null;
    }
    if (!vendorId) continue;

    const { data: open } = await supabase
      .from("vendor_escalations")
      .select("id")
      .eq("job_id", jobId)
      .eq("vendor_id", vendorId)
      .is("resolved_at", null)
      .maybeSingle();
    if (open) continue;

    const { data: job } = await supabase
      .from("service_jobs")
      .select("workspace_id, status_flags")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) continue;

    const flags = job.status_flags as string[] | null;
    const machineDown = Array.isArray(flags) && flags.includes("machine_down");

    let { data: pol } = await supabase
      .from("vendor_escalation_policies")
      .select("id")
      .eq("workspace_id", job.workspace_id as string)
      .eq("is_machine_down", machineDown)
      .limit(1)
      .maybeSingle();

    if (!pol) {
      const { data: anyP } = await supabase
        .from("vendor_escalation_policies")
        .select("id")
        .eq("workspace_id", job.workspace_id as string)
        .limit(1)
        .maybeSingle();
      pol = anyP ?? null;
    }
    if (!pol?.id) continue;

    const { data: insertedEsc, error: insErr } = await supabase
      .from("vendor_escalations")
      .insert({
        workspace_id: job.workspace_id as string,
        vendor_id: vendorId,
        job_id: jobId,
        policy_id: pol.id,
        po_reference: (a.po_reference as string | null) ?? null,
        current_step: 1,
        next_action_at: nowIso,
        resolution_notes: late
          ? "Opened — order past expected date"
          : "Opened — PO missing past grace period",
      })
      .select("id")
      .maybeSingle();
    if (!insErr && insertedEsc?.id) {
      seeded++;
      await mirrorToFulfillmentRun(supabase, {
        jobId: jobId,
        workspaceId: job.workspace_id as string,
        eventType: "shop_vendor_escalation_seeded",
        auditChannel: "vendor",
        idempotencyKey:
          `escalation_seed:${job.workspace_id as string}:${insertedEsc.id}`,
        payload: {
          vendor_escalation_id: insertedEsc.id,
          vendor_id: vendorId,
          source: "service-vendor-escalator",
        },
      });
    }
  }
  return seeded;
}

async function runStepActions(
  supabase: SupabaseClient,
  row: EscalationRow,
  policyName: string | null,
  step: Record<string, unknown> | undefined,
  stepIndex1: number,
) {
  const action = stepAction(step);
  const workspaceId = row.workspace_id;

  if (row.job_id) {
    const { data: job } = await supabase
      .from("service_jobs")
      .select("advisor_id, workspace_id")
      .eq("id", row.job_id)
      .maybeSingle();

    if (action === "notify_advisor" || action === "notify_vendor" || !action) {
      if (job?.advisor_id) {
        await supabase.from("crm_in_app_notifications").insert({
          workspace_id: job.workspace_id,
          user_id: job.advisor_id,
          kind: "service_vendor_escalation",
          title: action === "notify_vendor" ? "Vendor follow-up (escalation)" : "Vendor escalation step",
          body:
            `Policy ${policyName ?? "escalation"} — step ${stepIndex1} (${action}) for job`,
          metadata: {
            job_id: row.job_id,
            vendor_escalation_id: row.id,
            step_action: action,
          },
        });
      }
    }

    if (action === "notify_vendor") {
      const { data: contacts } = await supabase
        .from("vendor_contacts")
        .select("id, email, contact_name")
        .eq("vendor_id", row.vendor_id)
        .eq("workspace_id", workspaceId)
        .limit(3);
      for (const c of contacts ?? []) {
        const email = typeof c.email === "string" ? c.email.trim() : "";
        if (!email || !email.includes("@")) {
          await supabase.from("service_job_events").insert({
            workspace_id: workspaceId,
            job_id: row.job_id,
            event_type: "vendor_escalation_logged",
            metadata: {
              vendor_escalation_id: row.id,
              vendor_contact_id: c.id,
              reason: "no_vendor_contact_email",
              name: c.contact_name,
            },
          });
          continue;
        }
        const subject =
          `Vendor escalation — ${policyName ?? "follow-up"} (job ${row.job_id})`;
        const text =
          `Escalation step ${stepIndex1} for job ${row.job_id}. Policy: ${policyName ?? "n/a"}. Contact: ${c.contact_name ?? "n/a"}.`;
        const sent = await sendVendorEscalationEmail({ to: email, subject, text });
        await supabase.from("service_job_events").insert({
          workspace_id: workspaceId,
          job_id: row.job_id,
          event_type: sent ? "vendor_escalation_email_sent" : "vendor_escalation_logged",
          metadata: {
            vendor_escalation_id: row.id,
            vendor_contact_id: c.id,
            email,
            name: c.contact_name,
            ...(sent
              ? { channel: "resend" }
              : { channel: "manual_follow_up", reason: "resend_failed_or_unconfigured" }),
          },
        });
      }
    }

    if (action === "switch_alt_vendor") {
      const altId = step?.alt_vendor_id ?? step?.alternate_vendor_id;
      if (typeof altId === "string" && row.job_id) {
        const { data: reqs } = await supabase
          .from("service_parts_requirements")
          .select("id")
          .eq("job_id", row.job_id)
          .eq("vendor_id", row.vendor_id);
        for (const r of reqs ?? []) {
          await supabase
            .from("service_parts_requirements")
            .update({ vendor_id: altId, updated_at: new Date().toISOString() })
            .eq("id", r.id);
        }
        await supabase.from("service_job_events").insert({
          workspace_id: workspaceId,
          job_id: row.job_id,
          event_type: "vendor_escalation_alt_vendor",
          metadata: { vendor_escalation_id: row.id, new_vendor_id: altId },
        });
      }
    }

    await mirrorToFulfillmentRun(supabase, {
      jobId: row.job_id,
      workspaceId: row.workspace_id,
      eventType: "shop_vendor_escalation_step",
      auditChannel: "vendor",
      idempotencyKey:
        `escalation_step:${row.workspace_id}:${row.id}:${stepIndex1}`,
      payload: {
        vendor_escalation_id: row.id,
        step_index: stepIndex1,
        action,
        policy_name: policyName,
        source: "service-vendor-escalator",
      },
    });
  }
}

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
        function: "service-vendor-escalator",
        ts: new Date().toISOString(),
      }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);
    const results = { processed: 0, notifications: 0, seeded: 0 };

    results.seeded = await seedEscalationsFromLateOrders(supabase);

    const { data: due } = await supabase
      .from("vendor_escalations")
      .select("id, workspace_id, vendor_id, job_id, policy_id, current_step, next_action_at")
      .is("resolved_at", null)
      .lte("next_action_at", new Date().toISOString());

    for (const row of (due ?? []) as EscalationRow[]) {
      if (!row.policy_id) {
        await supabase
          .from("vendor_escalations")
          .update({
            resolved_at: new Date().toISOString(),
            resolution_notes: "No policy linked — close manually",
          })
          .eq("id", row.id);
        results.processed++;
        continue;
      }

      const { data: policy } = await supabase
        .from("vendor_escalation_policies")
        .select("steps, name")
        .eq("id", row.policy_id)
        .maybeSingle();

      const steps = (policy?.steps as unknown[]) ?? [];
      const cur = Math.max(1, row.current_step ?? 1);
      const currentStepDef = steps[cur - 1] as Record<string, unknown> | undefined;

      await runStepActions(
        supabase,
        row,
        policy?.name ?? null,
        currentStepDef,
        cur,
      );
      if (row.job_id) {
        const { data: job } = await supabase
          .from("service_jobs")
          .select("advisor_id, workspace_id")
          .eq("id", row.job_id)
          .maybeSingle();
        if (job?.advisor_id) results.notifications++;
      }

      const nextStep = cur + 1;
      let nextAt: Date | null = null;
      if (nextStep <= steps.length) {
        const step = steps[nextStep - 1] as Record<string, unknown> | undefined;
        const h = step ? hoursFromStep(step) : 48;
        nextAt = new Date(Date.now() + h * 3600_000);
      }

      await supabase
        .from("vendor_escalations")
        .update({
          current_step: nextStep,
          next_action_at: nextAt?.toISOString() ?? null,
          resolution_notes: nextAt
            ? `Escalation step ${nextStep} (${policy?.name ?? "policy"})`
            : "Escalation ladder complete — manual follow-up",
          resolved_at: nextAt ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.processed++;
    }

    await logServiceCronRun(supabase, {
      jobName: "service-vendor-escalator",
      ok: true,
      metadata: { results },
    });
    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    console.error("service-vendor-escalator:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "service-vendor-escalator",
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
