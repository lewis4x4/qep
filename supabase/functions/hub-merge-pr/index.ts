/**
 * hub-merge-pr — merge the draft PR attached to a hub_feedback row.
 *
 * Admin/owner only. Expects `claude_pr_url` to already be populated by
 * hub-feedback-draft-fix. Calls GitHub's merge endpoint (squash by
 * default), then flips the feedback row to 'shipped' with resolved_at.
 *
 * Zero-blocking: returns a clear 424 with machine-readable reason when
 * GITHUB_TOKEN isn't set, so the UI can surface "configure GitHub first".
 *
 * The changelog-from-commit cron (Day 7-8) picks up the merge commit and
 * materializes the "your feedback shipped" row in hub_changelog. We
 * don't duplicate that work here.
 */

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireHubUser } from "../_shared/hub-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  loadGithubConfig,
  mergePr,
  parsePrNumberFromUrl,
} from "../_shared/github-api.ts";

interface RequestBody {
  feedback_id?: unknown;
  merge_method?: unknown;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const auth = await requireHubUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (auth.audience !== "internal" || !["admin", "owner"].includes(auth.role)) {
      return safeJsonError("admin/owner only", 403, origin);
    }

    const raw = (await req.json().catch(() => null)) as RequestBody | null;
    const feedbackId = typeof raw?.feedback_id === "string" ? raw.feedback_id : "";
    if (!feedbackId) return safeJsonError("feedback_id required", 400, origin);

    const mergeMethod: "merge" | "squash" | "rebase" =
      raw?.merge_method === "merge" || raw?.merge_method === "rebase" ? raw.merge_method : "squash";

    const { data: feedback, error: fetchErr } = await auth.supabase
      .from("hub_feedback")
      .select("id, status, claude_pr_url, ai_summary, body")
      .eq("id", feedbackId)
      .is("deleted_at", null)
      .single();
    if (fetchErr || !feedback) {
      return safeJsonError("feedback not found", 404, origin);
    }

    const prUrl = feedback.claude_pr_url as string | null;
    if (!prUrl) {
      return safeJsonError("no draft PR attached — run hub-feedback-draft-fix first", 409, origin);
    }
    const prNumber = parsePrNumberFromUrl(prUrl);
    if (!prNumber) {
      return safeJsonError("could not parse PR number from url", 500, origin);
    }

    const ghCfg = loadGithubConfig();
    if (!ghCfg) {
      return safeJsonError(
        "GITHUB_TOKEN/OWNER/REPO not configured — cannot merge from edge function",
        424,
        origin,
      );
    }

    const summary = (feedback.ai_summary as string | null) ?? (feedback.body as string | null) ?? "hub feedback";
    const mergeResult = await mergePr(ghCfg, prNumber, {
      commit_title: `[QEP-HUB] ${summary.slice(0, 80)}`,
      merge_method: mergeMethod,
    });

    if (!mergeResult.merged) {
      return safeJsonError("github reported merge not completed", 500, origin);
    }

    const { data: updated, error: updErr } = await auth.supabase
      .from("hub_feedback")
      .update({
        status: "shipped",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", feedbackId)
      .select("*")
      .single();

    if (updErr || !updated) {
      throw new Error(`feedback update failed: ${updErr?.message ?? "unknown"}`);
    }

    return safeJsonOk(
      {
        feedback: updated,
        pr_number: prNumber,
        merge_sha: mergeResult.sha,
        merge_method: mergeMethod,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-merge-pr" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});
