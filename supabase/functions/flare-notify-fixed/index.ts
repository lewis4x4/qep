/**
 * Wave 6.11 Flare — close-the-loop notify when a report is marked fixed.
 *
 * Triggered by the FlareDetailDrawer frontend when a manager flips
 * status to 'fixed'. NOT a DB trigger (avoids pg_net dependency).
 *
 * Sends:
 *   - Email to the original reporter via Resend
 *   - Threaded Slack reply to the original message (best-effort)
 *
 * All steps fail-open: any single side-channel that fails just logs.
 *
 * Auth: JWT required, manager+ role validated via profiles lookup.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    // Canonical JWT auth — ES256-safe. requireServiceUser handles rep/admin/
    // manager/owner; this endpoint tightens to manager+ (no reps marking
    // flares fixed).
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["manager", "owner", "admin"].includes(auth.role)) {
      return safeJsonError("forbidden", 403, origin);
    }

    // flare_reports cross-workspace reads + side-channel dispatch need
    // service-role to bypass RLS.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const reportId: string | undefined = body.report_id;
    if (!reportId) return safeJsonError("report_id_required", 400, origin);

    // Load the flare row + reporter profile
    const { data: report, error: reportErr } = await supabaseAdmin
      .from("flare_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (reportErr || !report) return safeJsonError("report_not_found", 404, origin);

    const reportRow = report as Record<string, unknown>;
    const reporterId = reportRow.reporter_id as string | null;
    const reporterEmail = reportRow.reporter_email as string | null;
    const userDescription = reportRow.user_description as string;
    const fixDeploySha = reportRow.fix_deploy_sha as string | null;
    const fixedAt = reportRow.fixed_at as string | null;
    const createdAt = reportRow.created_at as string;
    const linearIssueId = reportRow.linear_issue_id as string | null;
    const slackTs = reportRow.slack_ts as string | null;

    const sideChannelErrors: Record<string, string> = {};

    // ── 1. Email reporter ──────────────────────────────────────────
    if (reporterEmail) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          const fromEmail = Deno.env.get("FLARE_FROM_EMAIL") ?? "flare@qep.app";
          const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
          const reportedDate = new Date(createdAt).toLocaleDateString();
          const fixedDate = fixedAt ? new Date(fixedAt).toLocaleDateString() : "today";

          const subject = `Your bug report is fixed`;
          const text = [
            `Hi,`,
            ``,
            `The bug you reported on ${reportedDate} has been fixed in the deploy that went out ${fixedDate}.`,
            ``,
            `Original report:`,
            `> ${userDescription}`,
            ``,
            fixDeploySha ? `Deploy SHA: ${fixDeploySha}` : ``,
            ``,
            `Thanks for reporting this — closing the loop is how we keep getting better.`,
            ``,
            `View the report: ${appUrl}/admin/flare/${reportId}`,
          ].filter((l) => l !== "").join("\n");

          const html = `<p>Hi,</p>
<p>The bug you reported on <strong>${reportedDate}</strong> has been fixed in the deploy that went out <strong>${fixedDate}</strong>.</p>
<p><strong>Original report:</strong><br><blockquote>${userDescription}</blockquote></p>
${fixDeploySha ? `<p>Deploy SHA: <code>${fixDeploySha}</code></p>` : ""}
<p>Thanks for reporting this — closing the loop is how we keep getting better.</p>
<p><a href="${appUrl}/admin/flare/${reportId}">View the report</a></p>`;

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [reporterEmail],
              subject,
              text,
              html,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            sideChannelErrors.email = `resend_http_${res.status}`;
          }
        } catch (err) {
          sideChannelErrors.email = err instanceof Error ? err.message : "email failed";
        }
      } else {
        sideChannelErrors.email = "missing_credentials";
      }
    } else {
      sideChannelErrors.email = "no_reporter_email";
    }

    // ── 2. Threaded Slack reply ────────────────────────────────────
    if (slackTs) {
      const webhookUrl = Deno.env.get("SLACK_FLARE_WEBHOOK_URL");
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `:white_check_mark: Fixed${fixDeploySha ? ` in deploy \`${fixDeploySha}\`` : ""} — original report: "${userDescription.slice(0, 100)}"`,
              thread_ts: slackTs === "posted" ? undefined : slackTs,
            }),
            signal: AbortSignal.timeout(5_000),
          });
        } catch (err) {
          sideChannelErrors.slack = err instanceof Error ? err.message : "slack failed";
        }
      } else {
        sideChannelErrors.slack = "missing_credentials";
      }
    }

    // ── 3. Linear issue → done (best-effort) ──────────────────────
    if (linearIssueId) {
      const linearKey = Deno.env.get("LINEAR_API_KEY");
      if (linearKey) {
        try {
          // Linear has stable state IDs that vary per workspace; we'd need
          // a state lookup mutation here. For v1, just add a comment.
          const commentMutation = `
            mutation CommentCreate($input: CommentCreateInput!) {
              commentCreate(input: $input) { success }
            }
          `;
          await fetch("https://api.linear.app/graphql", {
            method: "POST",
            headers: {
              Authorization: linearKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: commentMutation,
              variables: {
                input: {
                  issueId: linearIssueId,
                  body: `✅ Marked fixed in QEP${fixDeploySha ? ` (deploy \`${fixDeploySha}\`)` : ""}.`,
                },
              },
            }),
            signal: AbortSignal.timeout(8_000),
          });
        } catch (err) {
          sideChannelErrors.linear = err instanceof Error ? err.message : "linear failed";
        }
      } else {
        sideChannelErrors.linear = "missing_credentials";
      }
    }
    void reporterId; // Reserved for future per-reporter customization

    return safeJsonOk({
      ok: true,
      report_id: reportId,
      side_channel_errors: sideChannelErrors,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "flare-notify-fixed", req });
    console.error("[flare-notify-fixed] error:", err);
    return safeJsonError("internal", 500, req.headers.get("origin"));
  }
});
