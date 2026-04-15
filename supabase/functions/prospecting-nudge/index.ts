/**
 * Prospecting Nudge Edge Function — Track 2 Slice 2.5.
 *
 * Fires once per day (2 PM local, scheduled via migration 255) to notify
 * managers about reps who are behind on prospecting KPIs. Gets called by
 * pg_cron with `x-internal-service-secret`; managers can also call it on
 * demand with a user JWT to regenerate for their own workspace.
 *
 * For each workspace:
 *   1. Read today's `prospecting_kpis` rows
 *   2. Find reps below target (computeProspectingNudges)
 *   3. Fan out one `crm_in_app_notifications` row per (manager × under-target rep),
 *      deduped by (workspace, manager, rep, kpi_date) via a stable metadata key
 *
 * Response: `{ workspaces: N, notifications_created: M, by_workspace: [...] }`
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  buildNudgeNotificationBody,
  buildNudgeNotificationTitle,
  computeProspectingNudges,
  type ProspectingNudgeDecision,
} from "../_shared/prospecting-nudge-logic.ts";

// ─── Auth helpers ──────────────────────────────────────────────────────────

function isPrivilegedRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecretHeader = req.headers.get("x-internal-service-secret") ?? "";
  const internalServiceSecret =
    Deno.env.get("INTERNAL_SERVICE_SECRET") ??
    Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
    "";

  return (
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`)
    || (internalServiceSecret.length > 0 && internalSecretHeader === internalServiceSecret)
  );
}

// ─── Workspace scan ────────────────────────────────────────────────────────

interface WorkspaceSummary {
  workspace_id: string;
  reps_scanned: number;
  managers: number;
  notifications_created: number;
}

// deno-lint-ignore no-explicit-any
type AdminClient = SupabaseClient<any, "public", any>;

async function scanWorkspace(
  adminClient: AdminClient,
  workspaceId: string,
  today: string,
): Promise<WorkspaceSummary> {
  // Today's KPI rows, with rep name join
  const { data: kpiRows } = await adminClient
    .from("prospecting_kpis")
    .select("rep_id, positive_visits, target, profiles:rep_id ( full_name )")
    .eq("workspace_id", workspaceId)
    .eq("kpi_date", today);

  // Resolve managers for this workspace. We use the SQL-facing `role` column
  // (admin/manager/owner) rather than iron_role because the prospecting nudge
  // is an operational signal, not an iron-role-scoped one — we want every
  // elevated viewer in the workspace to see it.
  const { data: managerRows } = await adminClient
    .from("profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("role", ["manager", "admin", "owner"]);

  const managers = (managerRows ?? []).map((row) => ({ user_id: String((row as Record<string, unknown>).id) }));

  const reps = (kpiRows ?? []).map((row: Record<string, unknown>) => {
    const profiles = row.profiles as { full_name?: string | null } | { full_name?: string | null }[] | null | undefined;
    const profile = Array.isArray(profiles) ? profiles[0] : profiles;
    return {
      rep_id: String(row.rep_id),
      rep_name: profile?.full_name ?? null,
      positive_visits: Number(row.positive_visits ?? 0),
      target: Number(row.target ?? 0),
    };
  });

  const decisions = computeProspectingNudges({
    workspace_id: workspaceId,
    reps,
    managers,
  });

  if (decisions.length === 0) {
    return {
      workspace_id: workspaceId,
      reps_scanned: reps.length,
      managers: managers.length,
      notifications_created: 0,
    };
  }

  // Idempotency: fetch existing nudge notifications for today so we do not
  // double-notify if the cron runs twice (or a manager hits the manual endpoint).
  const metadataKey = `prospecting_nudge:${today}`;
  const { data: existing } = await adminClient
    .from("crm_in_app_notifications")
    .select("user_id, metadata")
    .eq("workspace_id", workspaceId)
    .eq("kind", "prospecting_nudge")
    .gte("created_at", `${today}T00:00:00.000Z`);

  const existingKeys = new Set<string>();
  for (const row of (existing ?? []) as Array<{ user_id: string; metadata: Record<string, unknown> }>) {
    const meta = row.metadata ?? {};
    const key = typeof meta.nudge_key === "string" ? meta.nudge_key : null;
    if (key) existingKeys.add(`${row.user_id}::${key}`);
  }

  const toInsert = decisions
    .filter((d) => !existingKeys.has(`${d.manager_user_id}::${metadataKey}:${d.rep_id}`))
    .map((d: ProspectingNudgeDecision) => ({
      workspace_id: workspaceId,
      user_id: d.manager_user_id,
      kind: "prospecting_nudge",
      title: buildNudgeNotificationTitle(d),
      body: buildNudgeNotificationBody(d),
      metadata: {
        nudge_key: `${metadataKey}:${d.rep_id}`,
        rep_id: d.rep_id,
        rep_name: d.rep_name,
        positive_visits: d.positive_visits,
        target: d.target,
        short_by: d.short_by,
        severity: d.severity,
        kpi_date: today,
      },
    }));

  if (toInsert.length === 0) {
    return {
      workspace_id: workspaceId,
      reps_scanned: reps.length,
      managers: managers.length,
      notifications_created: 0,
    };
  }

  const { error } = await adminClient.from("crm_in_app_notifications").insert(toInsert);
  if (error) {
    throw new Error(`Failed to insert notifications for ${workspaceId}: ${error.message}`);
  }

  return {
    workspace_id: workspaceId,
    reps_scanned: reps.length,
    managers: managers.length,
    notifications_created: toInsert.length,
  };
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const today = typeof body.date === "string"
      ? body.date
      : new Date().toISOString().split("T")[0];

    const workspaceIds: string[] = [];

    if (isPrivilegedRequest(req)) {
      // Cron / service-role: scan every active workspace.
      if (Array.isArray(body.workspace_ids)) {
        for (const w of body.workspace_ids) {
          if (typeof w === "string") workspaceIds.push(w);
        }
      } else {
        const { data } = await adminClient
          .from("profiles")
          .select("workspace_id")
          .in("role", ["rep", "manager", "admin", "owner"]);
        const uniq = new Set<string>();
        for (const row of (data ?? []) as Array<{ workspace_id: string }>) {
          if (row.workspace_id) uniq.add(row.workspace_id);
        }
        workspaceIds.push(...uniq);
      }
    } else {
      // Per-user call: verify the caller is a manager-or-above and scope to
      // their workspace.
      const authHeader = req.headers.get("Authorization")?.trim();
      if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );

      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: { user }, error: authError } = await userClient.auth.getUser(token);
      if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

      const { data: profile } = await adminClient
        .from("profiles")
        .select("workspace_id, role")
        .eq("id", user.id)
        .maybeSingle();

      const profileRecord = profile as { workspace_id?: string; role?: string } | null;
      if (!profileRecord?.workspace_id || !["manager", "admin", "owner"].includes(profileRecord.role ?? "")) {
        return safeJsonError("Manager role required", 403, origin);
      }
      workspaceIds.push(profileRecord.workspace_id);
    }

    const summaries: WorkspaceSummary[] = [];
    for (const workspaceId of workspaceIds) {
      try {
        summaries.push(await scanWorkspace(adminClient, workspaceId, today));
      } catch (err) {
        console.error(`[prospecting-nudge] ${workspaceId} failed:`, err);
        captureEdgeException(err, { fn: "prospecting-nudge", extra: { workspace_id: workspaceId } });
        summaries.push({
          workspace_id: workspaceId,
          reps_scanned: 0,
          managers: 0,
          notifications_created: -1,
        });
      }
    }

    const totalCreated = summaries.reduce((sum, s) => sum + Math.max(0, s.notifications_created), 0);

    return safeJsonOk({
      date: today,
      workspaces: summaries.length,
      notifications_created: totalCreated,
      by_workspace: summaries,
    }, origin);
  } catch (err) {
    console.error("[prospecting-nudge] fatal:", err);
    captureEdgeException(err, { fn: "prospecting-nudge", req });
    return safeJsonError(err instanceof Error ? err.message : "Internal error", 500, origin);
  }
});
