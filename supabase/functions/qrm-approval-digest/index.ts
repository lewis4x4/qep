/**
 * QRM Approval Digest — Phase 3C
 *
 * One email per manager/owner/admin per day summarizing the pending approval
 * queue assigned to them (direct or by role+workspace). Triggered by pg_cron
 * once per day (default 13:00 UTC ≈ 9am ET). The function falls back gracefully
 * when RESEND_API_KEY is unset — it still logs the digest row so the per-day
 * idempotency guard remains accurate.
 *
 * Run modes:
 *   - Cron / empty body / GET                → iterates over every eligible
 *                                              manager-tier user in `profiles`.
 *   - POST `{ "user_id": "<uuid>" }`         → runs for that one user (test
 *                                              mode). Idempotency still applies
 *                                              unless `force: true` is set.
 *
 * Idempotency:
 *   `qrm_approval_digest_log (user_id, sent_on date)` with a UNIQUE constraint
 *   on `(user_id, sent_on)`. We insert FIRST. If the insert hits 23505 we skip
 *   without sending. Date is computed in UTC because `profiles.timezone` does
 *   not exist on this project (see CLAUDE.md note — confirmed against
 *   database.types.ts on 2026-05-18). UTC keeps every manager on the same day
 *   boundary, which matches what the cron tick gives us anyway.
 *
 * Auth: service-role only via _shared/cron-auth.ts (`isServiceRoleCaller`).
 * Deploy with `verify_jwt = false` so the cron's bearer/internal-secret call
 * reaches the handler. See `_shared/cron-auth.ts` for the full rationale.
 *
 * Failure isolation: every manager is processed inside its own try/catch.
 * A single bad row never blocks the rest of the run.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { safeCorsHeaders as corsHeaders, optionsResponse } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

const MANAGER_ROLES = ["manager", "owner", "admin"] as const;
const QUEUE_LIMIT = 10;
const ACTIVE_STATUSES = ["pending", "escalated"] as const;

interface ManagerProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active_workspace_id: string | null;
}

interface ApprovalRow {
  id: string;
  quote_package_id: string;
  quote_number: string | null;
  customer_name: string | null;
  customer_company: string | null;
  net_total: number | null;
  margin_pct: number | null;
  submitted_by_name: string | null;
  created_at: string;
}

interface ManagerResult {
  user_id: string;
  queue_size: number;
  sent: boolean;
  skipped_reason?: string;
}

function getAppBaseUrl(): string {
  const base =
    Deno.env.get("APP_BASE_URL") ??
    Deno.env.get("PUBLIC_APP_URL") ??
    Deno.env.get("SITE_URL") ??
    "https://qualityequipmentparts.netlify.app";
  return base.replace(/\/+$/, "");
}

function hoursSince(iso: string, now: number): number {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((now - ts) / 3_600_000));
}

function formatAge(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function formatAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${Math.round(value).toLocaleString()}`;
}

function formatMargin(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function customerLabel(row: ApprovalRow): string {
  return (
    (row.customer_name && row.customer_name.trim()) ||
    (row.customer_company && row.customer_company.trim()) ||
    "Unknown customer"
  );
}

function quoteLabel(row: ApprovalRow): string {
  return row.quote_number ? `#${row.quote_number}` : `(no number)`;
}

function buildDigestEmail(input: {
  managerFirstName: string;
  rows: ApprovalRow[];
  olderThan24h: number;
  appBaseUrl: string;
  now: number;
}): { subject: string; text: string } {
  const total = input.rows.length;
  const subject = `Your approval queue — ${total} pending${
    input.olderThan24h > 0 ? ` (${input.olderThan24h} older than 24h)` : ""
  }`;

  const lines: string[] = [];
  lines.push(`Good morning, ${input.managerFirstName}.`);
  lines.push("");
  lines.push(
    `You have ${total} quote${total === 1 ? "" : "s"} waiting on your approval. ` +
      `Oldest first — knock these out before they age out:`,
  );
  lines.push("");

  input.rows.forEach((row, idx) => {
    const age = hoursSince(row.created_at, input.now);
    const submittedBy = row.submitted_by_name ? ` by ${row.submitted_by_name}` : "";
    const flag = age >= 24 ? " [>24h]" : "";
    lines.push(
      `${idx + 1}. ${customerLabel(row)} — Quote ${quoteLabel(row)}${flag}`,
    );
    lines.push(
      `   ${formatAmount(row.net_total)} · ${formatMargin(row.margin_pct)} margin · submitted ${formatAge(age)}${submittedBy}`,
    );
    lines.push("");
  });

  lines.push(`View full queue: ${input.appBaseUrl}/qrm/command/approvals`);
  lines.push("");
  lines.push("— Iron, your QEP approval assistant");

  return { subject, text: lines.join("\n") };
}

// deno-lint-ignore no-explicit-any
type AdminClient = ReturnType<typeof createClient<any>>;

function createAdminClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchEligibleManagers(admin: AdminClient): Promise<ManagerProfile[]> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, active_workspace_id, is_active")
    .in("role", MANAGER_ROLES as unknown as string[])
    .eq("is_active", true);

  if (error) {
    console.error("[qrm-approval-digest] fetch managers failed:", error);
    return [];
  }
  return (data ?? [])
    .filter((row: Record<string, unknown>) => {
      const email = typeof row.email === "string" ? row.email : "";
      return email.includes("@");
    })
    .map((row: Record<string, unknown>) => ({
      id: row.id as string,
      email: row.email as string,
      full_name: typeof row.full_name === "string" ? row.full_name : null,
      role: row.role as string,
      active_workspace_id:
        typeof row.active_workspace_id === "string" ? row.active_workspace_id : null,
    }));
}

async function fetchManagerQueue(
  admin: AdminClient,
  manager: ManagerProfile,
): Promise<ApprovalRow[]> {
  const orFilter = manager.active_workspace_id
    ? `assigned_to.eq.${manager.id},and(assigned_role.eq.${manager.role},workspace_id.eq.${manager.active_workspace_id})`
    : `assigned_to.eq.${manager.id},assigned_role.eq.${manager.role}`;

  const { data, error } = await admin
    .from("quote_approval_cases")
    .select(
      "id, quote_package_id, quote_number, customer_name, customer_company, net_total, margin_pct, submitted_by_name, created_at",
    )
    .or(orFilter)
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("created_at", { ascending: true })
    .limit(QUEUE_LIMIT);

  if (error) {
    console.error(
      `[qrm-approval-digest] queue fetch failed for manager ${manager.id}:`,
      error,
    );
    throw error;
  }

  return (data ?? []) as ApprovalRow[];
}

/**
 * Try to claim the (user_id, sent_on) row. Returns:
 *   - "claimed" if we own the digest slot for today (caller should send),
 *   - "duplicate" if another invocation already claimed it today,
 *   - "error" if the database threw something unexpected.
 *
 * We claim BEFORE sending so a Resend hiccup can't produce double-deliveries.
 * The trade-off — if Resend fails after the claim, the user simply doesn't
 * get an email that day — is intentional. Better one missed digest than two
 * duplicate ones; the next day's run picks the queue back up.
 */
async function claimDigestSlot(
  admin: AdminClient,
  userId: string,
  todayUtc: string,
): Promise<"claimed" | "duplicate" | "error"> {
  try {
    const { error } = await admin
      .from("qrm_approval_digest_log")
      .insert({ user_id: userId, sent_on: todayUtc });
    if (!error) return "claimed";
    if (error.code === "23505") return "duplicate";
    console.error("[qrm-approval-digest] claim failed:", error);
    return "error";
  } catch (err) {
    console.error("[qrm-approval-digest] claim threw:", err);
    return "error";
  }
}

async function processManager(
  admin: AdminClient,
  manager: ManagerProfile,
  todayUtc: string,
  appBaseUrl: string,
  force: boolean,
): Promise<ManagerResult> {
  const rows = await fetchManagerQueue(admin, manager);
  const queueSize = rows.length;

  if (queueSize === 0) {
    return { user_id: manager.id, queue_size: 0, sent: false, skipped_reason: "queue_empty" };
  }

  if (!force) {
    const claim = await claimDigestSlot(admin, manager.id, todayUtc);
    if (claim === "duplicate") {
      return {
        user_id: manager.id,
        queue_size: queueSize,
        sent: false,
        skipped_reason: "already_sent_today",
      };
    }
    if (claim === "error") {
      return {
        user_id: manager.id,
        queue_size: queueSize,
        sent: false,
        skipped_reason: "claim_log_error",
      };
    }
  }

  const now = Date.now();
  const olderThan24h = rows.filter((r) => hoursSince(r.created_at, now) >= 24).length;
  const firstName = (manager.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const { subject, text } = buildDigestEmail({
    managerFirstName: firstName,
    rows,
    olderThan24h,
    appBaseUrl,
    now,
  });

  const result = await sendResendEmail({
    to: manager.email,
    subject,
    text,
    timeoutMs: 6000,
  });

  if (result.skipped) {
    return {
      user_id: manager.id,
      queue_size: queueSize,
      sent: false,
      skipped_reason: "resend_not_configured",
    };
  }
  if (!result.ok) {
    return {
      user_id: manager.id,
      queue_size: queueSize,
      sent: false,
      skipped_reason: "resend_error",
    };
  }

  return { user_id: manager.id, queue_size: queueSize, sent: true };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (!isServiceRoleCaller(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  // Body is optional. POST `{ user_id, force? }` triggers single-user test
  // mode; anything else (GET, empty POST) runs the full cron pass.
  let body: Record<string, unknown> = {};
  if (req.method !== "GET") {
    const parsed = await parseJsonBody(req, origin);
    if (!parsed.ok) return parsed.response;
    if (parsed.body && typeof parsed.body === "object") {
      body = parsed.body as Record<string, unknown>;
    }
  }

  const singleUserId = typeof body.user_id === "string" && body.user_id.trim().length > 0
    ? body.user_id.trim()
    : null;
  const force = body.force === true;

  const admin = createAdminClient();
  const appBaseUrl = getAppBaseUrl();
  const runAt = new Date().toISOString();
  const todayUtc = runAt.slice(0, 10);

  let managers: ManagerProfile[];
  if (singleUserId) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, active_workspace_id")
      .eq("id", singleUserId)
      .maybeSingle();
    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "profile_not_found", user_id: singleUserId }),
        { status: 404, headers: { ...ch, "Content-Type": "application/json" } },
      );
    }
    const row = data as Record<string, unknown>;
    const email = typeof row.email === "string" ? row.email : "";
    const role = typeof row.role === "string" ? row.role : "";
    if (!email.includes("@") || !MANAGER_ROLES.includes(role as typeof MANAGER_ROLES[number])) {
      return new Response(
        JSON.stringify({ error: "not_an_eligible_manager", user_id: singleUserId, role }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
      );
    }
    managers = [
      {
        id: row.id as string,
        email,
        full_name: typeof row.full_name === "string" ? row.full_name : null,
        role,
        active_workspace_id:
          typeof row.active_workspace_id === "string" ? row.active_workspace_id : null,
      },
    ];
  } else {
    managers = await fetchEligibleManagers(admin);
  }

  const results: ManagerResult[] = [];
  for (const manager of managers) {
    try {
      const result = await processManager(admin, manager, todayUtc, appBaseUrl, force);
      results.push(result);
    } catch (err) {
      console.error(
        `[qrm-approval-digest] manager ${manager.id} failed:`,
        err,
      );
      results.push({
        user_id: manager.id,
        queue_size: 0,
        sent: false,
        skipped_reason: `error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  const emailsSent = results.filter((r) => r.sent).length;
  const emailsSkipped = results.length - emailsSent;

  return new Response(
    JSON.stringify({
      run_at: runAt,
      total_managers_checked: results.length,
      emails_sent: emailsSent,
      emails_skipped: emailsSkipped,
      results,
    }),
    { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
  );
});
