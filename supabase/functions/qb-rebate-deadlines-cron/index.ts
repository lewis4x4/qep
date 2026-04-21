/**
 * qb-rebate-deadlines-cron — Daily Rebate Deadline Alert
 *
 * Runs at 11:00 UTC (7 AM ET) via pg_cron (registered in migration 293).
 * Can also be triggered manually from the Supabase dashboard.
 *
 * What it does:
 *   1. Queries qb_deals for unfiled rebates due within the next 14 days.
 *   2. Inserts qb_notifications rows for Angela (admin/manager) and the
 *      owning salesman for each deal.
 *   3. Returns a summary JSON response (for cron audit logging).
 *
 * Auth: isServiceRoleCaller() — requires SUPABASE_SERVICE_ROLE_KEY or
 *   INTERNAL_SERVICE_SECRET header. NOT a user-JWT endpoint.
 *
 * Why 14 days: urgency levels are green (14+ days), yellow (7–13), red (1–6),
 * overdue (past due). At 14 days we start notifying so Angela has time to act.
 *
 * Notification format:
 *   type:  'rebate_deadline_warning'
 *   title: "Rebate deadline: [Deal#] — [N] days left"
 *   body:  Human-readable sentence suitable for display in the app.
 *
 * .ts extensions required on all relative imports (Deno).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  optionsResponse,
  safeJsonOk,
  safeJsonError,
} from "../_shared/safe-cors.ts";
import {
  getUpcomingRebateDeadlines,
  enrichWithProgramDetails,
} from "../../../apps/web/src/lib/programs/rebate-tracker.ts";
import type { RebateDeadline } from "../../../apps/web/src/lib/programs/types.ts";

/** Alert window: notify when the deadline is within this many days */
const ALERT_DAYS_AHEAD = 14;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  // ── Auth: cron/service-role only ────────────────────────────────────────────
  if (!isServiceRoleCaller(req)) {
    return safeJsonError("Unauthorized — service role required", 401, origin);
  }

  const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    return safeJsonError("Server misconfiguration: SUPABASE_URL or SERVICE_ROLE_KEY missing", 500, origin);
  }

  // Service-role client — bypasses RLS so the cron can see all workspaces
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Fetch deadlines ──────────────────────────────────────────────────────────
  let deadlines: RebateDeadline[];
  try {
    const raw = await getUpcomingRebateDeadlines({ daysAhead: ALERT_DAYS_AHEAD }, supabase as any);
    deadlines = await enrichWithProgramDetails(raw, supabase as any);
  } catch (err: any) {
    console.error("[qb-rebate-deadlines-cron] fetch error:", err);
    return safeJsonError("Failed to load deadlines", 500, origin);
  }

  if (deadlines.length === 0) {
    console.log("[qb-rebate-deadlines-cron] No rebate deadlines in the next", ALERT_DAYS_AHEAD, "days.");
    return safeJsonOk({ notified: 0, deadlines: [] }, origin);
  }

  // ── Admin fan-out, scoped per workspace (SECURITY) ─────────────────────────
  // Prior behavior fetched every admin profile globally and pushed every deal's
  // notification to every admin — leaking deal numbers, company names, and
  // rebate amounts across tenants. Now: resolve admins per the deal's own
  // workspace_id (denormalized onto RebateDeadline by getUpcomingRebateDeadlines).
  const workspaceAdminCache = new Map<string, string[]>();
  async function adminsForWorkspace(workspaceId: string): Promise<string[]> {
    const cached = workspaceAdminCache.get(workspaceId);
    if (cached) return cached;
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("active_workspace_id", workspaceId)
      .in("role", ["admin", "manager", "owner"]);
    const ids = (data ?? []).map((u: { id: string }) => u.id);
    workspaceAdminCache.set(workspaceId, ids);
    return ids;
  }

  // ── Insert notifications ─────────────────────────────────────────────────────
  const notifications: Array<{
    user_id: string;
    type: string;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const d of deadlines) {
    const urgencyLabel =
      d.urgency === "overdue"  ? "OVERDUE — past the filing deadline!"
      : d.urgency === "red"    ? `${d.daysRemaining} days left — act now`
      : d.urgency === "yellow" ? `${d.daysRemaining} days left`
      : `${d.daysRemaining} days left`;

    const title = `Rebate deadline: ${d.dealNumber} — ${urgencyLabel}`;
    const body  = d.urgency === "overdue"
      ? `The rebate filing deadline for deal ${d.dealNumber} (${d.companyName}) has passed. File with the manufacturer immediately or the rebate may be lost.`
      : `Deal ${d.dealNumber} for ${d.companyName} has a rebate filing deadline on ${d.filingDueDate}. ` +
        `${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"} remaining — ` +
        `${d.programs.map((p) => p.name).join(", ")}.`;

    const metadata = {
      dealId: d.dealId,
      dealNumber: d.dealNumber,
      workspaceId: d.workspaceId,
      companyName: d.companyName,
      filingDueDate: d.filingDueDate,
      daysRemaining: d.daysRemaining,
      urgency: d.urgency,
      programs: d.programs,
    };

    // Notify admins in *this deal's* workspace only.
    const adminIds = await adminsForWorkspace(d.workspaceId);
    for (const adminId of adminIds) {
      notifications.push({ user_id: adminId, type: "rebate_deadline_warning", title, body, metadata });
    }

    // Also notify the owning salesman if not already in admin list
    // (salesman_id is on the deal but not surfaced by rebate-tracker — look it up)
    // For simplicity: angela gets the notification; salesman gets one too via separate lookup.
    // Full salesman-level notification requires the salesman_id column on RebateDeadline,
    // which we'll add in a follow-up. TODO(slice-07): add salesman_id to RebateDeadline and notify rep.
  }

  if (notifications.length === 0) {
    return safeJsonOk({ notified: 0, message: "No admin users found to notify." }, origin);
  }

  const { error: insertError } = await supabase
    .from("qb_notifications")
    .insert(notifications);

  if (insertError) {
    console.error("[qb-rebate-deadlines-cron] insert error:", insertError);
    return safeJsonError("Failed to insert notifications", 500, origin);
  }

  console.log(
    `[qb-rebate-deadlines-cron] Inserted ${notifications.length} notifications for ${deadlines.length} deals.`,
  );

  return safeJsonOk(
    {
      notified: notifications.length,
      deals: deadlines.length,
      deadlines: deadlines.map((d) => ({
        dealNumber: d.dealNumber,
        companyName: d.companyName,
        urgency: d.urgency,
        daysRemaining: d.daysRemaining,
        filingDueDate: d.filingDueDate,
      })),
    },
    origin,
  );
});
