/**
 * Quality Center Phase 1 — flare status update edge function.
 *
 * POST body:
 *   {
 *     flare_id: uuid,
 *     status: 'new'|'acknowledged'|'investigating'|'fixing'|'shipped'
 *           |'verified'|'wont_fix'|'duplicate'|'needs_info',
 *     eta_date?: 'YYYY-MM-DD',
 *     owner_summary?: string,
 *     priority?: 'low'|'medium'|'high'|'urgent',
 *     note?: string,
 *   }
 *
 * Behaviour:
 *   1. JWT auth, role gated to admin/manager/owner/support
 *   2. Validates `status` against the migration 583 check-constraint set
 *   3. Updates flare_reports with the new triage fields + status_updated_at/by
 *   4. Inserts a flare_status_history row capturing the transition
 *   5. When status moves to 'verified', fans out the legacy
 *      flare-notify-fixed close-the-loop email to the reporter
 *   6. Returns the updated row
 *
 * Fail-open on the notify fan-out — the row write is the source of truth.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const ALLOWED_STATUSES = new Set([
  "new",
  "acknowledged",
  "investigating",
  "fixing",
  "shipped",
  "verified",
  "wont_fix",
  "duplicate",
  "needs_info",
]);

const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

const RATE_LIMIT_PER_MINUTE = 30;

interface UpdateBody {
  flare_id?: string;
  status?: string;
  eta_date?: string | null;
  owner_summary?: string | null;
  priority?: string | null;
  note?: string | null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["admin", "manager", "owner", "support"].includes(auth.role)) {
      return safeJsonError("forbidden", 403, origin);
    }

    let body: UpdateBody;
    try {
      body = await req.json();
    } catch {
      return safeJsonError("invalid_payload", 400, origin);
    }

    const flareId = typeof body.flare_id === "string" ? body.flare_id.trim() : "";
    const nextStatus = typeof body.status === "string" ? body.status.trim() : "";

    if (!flareId) return safeJsonError("flare_id_required", 400, origin);
    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return safeJsonError("invalid_status", 400, origin);
    }

    if (body.priority != null && body.priority !== "" && !ALLOWED_PRIORITIES.has(body.priority)) {
      return safeJsonError("invalid_priority", 400, origin);
    }
    if (body.eta_date != null && body.eta_date !== "" && !isIsoDate(body.eta_date)) {
      return safeJsonError("invalid_eta_date", 400, origin);
    }
    if (typeof body.owner_summary === "string" && body.owner_summary.length > 4000) {
      return safeJsonError("owner_summary_too_long", 400, origin);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit per admin — protects against status flapping / accidental
    // mutation loops. Counts the caller's status-history rows in the last
    // minute; rejects with 429 above the threshold.
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount, error: rateErr } = await supabaseAdmin
      .from("flare_status_history")
      .select("id", { count: "exact", head: true })
      .eq("changed_by", auth.userId)
      .gte("created_at", oneMinuteAgo);
    if (rateErr) {
      console.warn("[flare-status-update] rate-limit read failed:", rateErr);
    } else if ((recentCount ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return safeJsonError(
        `rate_limited — ${RATE_LIMIT_PER_MINUTE} status changes per minute max`,
        429,
        origin,
      );
    }

    // Service-role read — caller's workspace gate is downstream on the update.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("flare_reports")
      .select("id, workspace_id, status, reporter_email, fix_deploy_sha, fixed_at, created_at")
      .eq("id", flareId)
      .maybeSingle();

    if (existingErr || !existing) {
      return safeJsonError("flare_not_found", 404, origin);
    }
    const existingRow = existing as Record<string, unknown>;

    // Tenant gate — admin can flip flares only inside their active workspace.
    if (existingRow.workspace_id !== auth.workspaceId) {
      return safeJsonError("forbidden", 403, origin);
    }

    const fromStatus = (existingRow.status as string | null) ?? null;
    const nowIso = new Date().toISOString();

    const patch: Record<string, unknown> = {
      status: nextStatus,
      status_updated_at: nowIso,
      status_updated_by: auth.userId,
    };
    if (body.eta_date != null) patch.eta_date = body.eta_date || null;
    if (body.owner_summary != null) patch.owner_summary = body.owner_summary || null;
    if (body.priority != null) patch.priority = body.priority || null;

    // Legacy compatibility: mirror the new vocabulary onto the older
    // timestamp columns so existing UI paths (fixed-at badge, close-the-
    // loop notifier) keep working without a parallel rewrite.
    if (nextStatus === "shipped" || nextStatus === "verified") {
      if (!existingRow.fixed_at) patch.fixed_at = nowIso;
    }
    if (
      nextStatus === "acknowledged"
      || nextStatus === "investigating"
      || nextStatus === "fixing"
    ) {
      patch.triaged_at = nowIso;
      patch.triaged_by = auth.userId;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("flare_reports")
      .update(patch)
      .eq("id", flareId)
      .select("*")
      .single();

    if (updateErr || !updated) {
      console.error("[flare-status-update] update failed:", updateErr);
      return safeJsonError("update_failed", 500, origin);
    }

    // Append-only transition audit.
    await supabaseAdmin.from("flare_status_history").insert({
      flare_id: flareId,
      workspace_id: existingRow.workspace_id,
      from_status: fromStatus,
      to_status: nextStatus,
      changed_by: auth.userId,
      note: typeof body.note === "string" && body.note.trim().length > 0 ? body.note.trim() : null,
    });

    // Close-the-loop notify when a flare is marked verified. Fail-open —
    // a webhook miss never blocks the status flip.
    if (nextStatus === "verified" && fromStatus !== "verified") {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        await fetch(`${supabaseUrl}/functions/v1/flare-notify-fixed`, {
          method: "POST",
          headers: {
            // re-use the caller's JWT so flare-notify-fixed's role gate passes
            Authorization: req.headers.get("Authorization") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ report_id: flareId }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (err) {
        console.warn("[flare-status-update] notify-fixed dispatch failed:", err);
      }
    }

    return safeJsonOk({ ok: true, report: updated, from_status: fromStatus, to_status: nextStatus }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "flare-status-update", req });
    console.error("[flare-status-update] error:", err);
    return safeJsonError("internal", 500, req.headers.get("origin"));
  }
});
