import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  buildRepAbsence,
  type DealAbsenceRow,
} from "../_shared/qrm-command-center/knowledge-gaps-engine.ts";

type ProfileRow = {
  id: string;
  full_name: string | null;
  iron_role: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    if (!isServiceRole) {
      const caller = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error } = await caller.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);
      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile || !["manager", "owner"].includes(profile.role)) {
        return safeJsonError("Absence engine nightly requires manager or owner role", 403, origin);
      }
    }

    const snapshotDate = todayIso();
    const { data: workspaceRows, error: workspaceErr } = await admin
      .from("crm_deals")
      .select("workspace_id")
      .is("deleted_at", null)
      .limit(2000);

    if (workspaceErr) {
      return safeJsonError("Failed to load workspace scope", 500, origin);
    }

    const workspaceIds = [...new Set(((workspaceRows ?? []) as Array<{ workspace_id: string | null }>)
      .map((row) => row.workspace_id ?? "default")
      .filter(Boolean))];

    let workspacesProcessed = 0;
    for (const workspaceId of workspaceIds) {
      const { data: rawDeals, error: dealsErr } = await admin
        .from("crm_deals")
        .select("id, assigned_rep_id, amount, expected_close_on, primary_contact_id, company_id")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("closed_at", null)
        .limit(2000);

      if (dealsErr) continue;

      const repIds = [...new Set(((rawDeals ?? []) as Array<Record<string, unknown>>)
        .map((row) => typeof row.assigned_rep_id === "string" ? row.assigned_rep_id : null)
        .filter((value): value is string => Boolean(value)))];

      let profileById = new Map<string, ProfileRow>();
      if (repIds.length > 0) {
        const { data: profileRows } = await admin
          .from("profiles")
          .select("id, full_name, iron_role")
          .in("id", repIds);
        profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((row) => [row.id, row]));
      }

      const deals: DealAbsenceRow[] = ((rawDeals ?? []) as Array<Record<string, unknown>>).map((row) => {
        const repId = typeof row.assigned_rep_id === "string" ? row.assigned_rep_id : null;
        const profile = repId ? profileById.get(repId) ?? null : null;
        return {
          id: String(row.id),
          assigned_rep_id: repId,
          amount: typeof row.amount === "number" ? row.amount : null,
          expected_close_on: typeof row.expected_close_on === "string" ? row.expected_close_on : null,
          primary_contact_id: typeof row.primary_contact_id === "string" ? row.primary_contact_id : null,
          company_id: typeof row.company_id === "string" ? row.company_id : null,
          profiles: profile ? { full_name: profile.full_name, iron_role: profile.iron_role } : null,
        };
      });

      const { repAbsence, worstFields } = buildRepAbsence(deals);

      const { data: gapRows } = await admin
        .from("knowledge_gaps")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("resolved", false)
        .limit(1000);

      const { data: runRow, error: runErr } = await admin
        .from("qrm_absence_engine_runs")
        .upsert({
          workspace_id: workspaceId,
          snapshot_date: snapshotDate,
          generated_at: new Date().toISOString(),
          top_gap_count: (gapRows ?? []).length,
          worst_fields: worstFields,
        }, { onConflict: "workspace_id,snapshot_date" })
        .select("id")
        .maybeSingle();

      if (runErr || !runRow?.id) continue;

      await admin
        .from("qrm_absence_engine_rep_snapshots")
        .delete()
        .eq("run_id", runRow.id);

      if (repAbsence.length > 0) {
        await admin
          .from("qrm_absence_engine_rep_snapshots")
          .insert(
            repAbsence.map((row) => ({
              run_id: runRow.id,
              workspace_id: workspaceId,
              snapshot_date: snapshotDate,
              rep_id: row.repId,
              rep_name: row.repName,
              iron_role: row.ironRole,
              deal_count: row.dealCount,
              missing_amount: row.missingAmount,
              missing_close_date: row.missingCloseDate,
              missing_contact: row.missingContact,
              missing_company: row.missingCompany,
              absence_score: row.absenceScore,
            })),
          );
      }

      workspacesProcessed += 1;
    }

    return safeJsonOk({
      ok: true,
      snapshot_date: snapshotDate,
      workspaces_processed: workspacesProcessed,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "qrm-absence-engine-nightly", req });
    console.error("qrm-absence-engine-nightly error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});
