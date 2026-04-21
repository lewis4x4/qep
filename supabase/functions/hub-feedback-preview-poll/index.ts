/**
 * hub-feedback-preview-poll — Build Hub v3.1 Netlify preview URL watcher.
 *
 * Scans hub_feedback rows that have a draft PR open but haven't yet found
 * a Netlify preview URL, hits the GitHub combined-status API on the PR's
 * head SHA, and stamps `claude_preview_url` + `claude_preview_ready_at`
 * the first time a `netlify/*` status goes `success` with a target_url.
 *
 * Emits a `preview_ready` hub_feedback_events row so hub-feedback-notify
 * can email the submitter: "Your fix is live at <url>. Poke at it — if it
 * misses, reply and we'll spin another take before merge."
 *
 * Scheduled every 2 minutes (see migration 327). 30 rows per tick is
 * plenty; the index on `claude_preview_checked_at nulls first` keeps
 * scans cheap and fair (never-checked rows surface first).
 *
 * Zero-blocking:
 *   - No GITHUB_TOKEN/OWNER/REPO → we still stamp checked_at so we don't
 *     loop forever, and return `skipped_no_github`. The row will be
 *     picked up later when credentials land.
 *   - PR has no netlify status yet → stamp checked_at and move on; the
 *     next tick will retry.
 *   - PR merged or closed out-of-band → skip it (can't preview a dead
 *     branch) and stamp checked_at to remove it from the scan set.
 *
 * Auth: service-role or x-internal-service-secret only.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  getCombinedStatus,
  getPullRequest,
  loadGithubConfig,
  parsePrNumberFromUrl,
  type GithubStatusEntry,
} from "../_shared/github-api.ts";

const MAX_ROWS_PER_RUN = 30;
const NETLIFY_CONTEXT_PREFIX = "netlify/";

interface CandidateRow {
  id: string;
  workspace_id: string;
  submitted_by: string | null;
  claude_pr_url: string | null;
  claude_branch_name: string | null;
  claude_preview_checked_at: string | null;
  status: string;
}

interface PollOutcome {
  feedback_id: string;
  action:
    | "preview_ready"
    | "still_pending"
    | "no_netlify_status"
    | "pr_closed"
    | "skipped_no_github"
    | "error";
  preview_url?: string | null;
  error?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST" && req.method !== "GET") {
    return safeJsonError("Method not allowed", 405, origin);
  }
  if (!isServiceRoleCaller(req)) {
    return safeJsonError("service-role or internal-service-secret required", 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Server misconfiguration (SUPABASE env missing)", 500, origin);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startMs = Date.now();

  try {
    // Oldest-checked-first (NULLS FIRST) so never-polled rows land first.
    const { data: rows, error } = await supabase
      .from("hub_feedback")
      .select(
        "id, workspace_id, submitted_by, claude_pr_url, claude_branch_name, claude_preview_checked_at, status",
      )
      .not("claude_pr_url", "is", null)
      .is("claude_preview_ready_at", null)
      .is("deleted_at", null)
      .in("status", ["drafting", "awaiting_merge"])
      .order("claude_preview_checked_at", { ascending: true, nullsFirst: true })
      .limit(MAX_ROWS_PER_RUN);

    if (error) throw new Error(`candidate scan: ${error.message}`);

    const candidates = (rows ?? []) as CandidateRow[];
    if (candidates.length === 0) {
      return safeJsonOk(
        { polled: 0, outcomes: [], elapsed_ms: Date.now() - startMs },
        origin,
      );
    }

    const ghCfg = loadGithubConfig();
    if (!ghCfg) {
      // Stamp checked_at so we don't thrash the table while credentials
      // are still unset; a future deploy with env populated will re-poll
      // naturally.
      const nowIso = new Date().toISOString();
      await supabase
        .from("hub_feedback")
        .update({ claude_preview_checked_at: nowIso })
        .in("id", candidates.map((c) => c.id));
      return safeJsonOk(
        {
          polled: candidates.length,
          outcomes: candidates.map((c) => ({
            feedback_id: c.id,
            action: "skipped_no_github" as const,
          })),
          elapsed_ms: Date.now() - startMs,
        },
        origin,
      );
    }

    const outcomes: PollOutcome[] = [];
    for (const row of candidates) {
      try {
        outcomes.push(await pollOne(supabase, ghCfg, row));
      } catch (err) {
        outcomes.push({
          feedback_id: row.id,
          action: "error",
          error: err instanceof Error ? err.message : "unknown",
        });
        // Still stamp checked_at so a permanently-broken row doesn't
        // monopolise every tick.
        await supabase
          .from("hub_feedback")
          .update({ claude_preview_checked_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }

    return safeJsonOk(
      {
        polled: outcomes.length,
        outcomes,
        elapsed_ms: Date.now() - startMs,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-feedback-preview-poll" });
    console.error("[hub-feedback-preview-poll]", err);
    return safeJsonError("Internal error", 500, origin);
  }
});

async function pollOne(
  supabase: SupabaseClient,
  ghCfg: NonNullable<ReturnType<typeof loadGithubConfig>>,
  row: CandidateRow,
): Promise<PollOutcome> {
  const prNumber = row.claude_pr_url ? parsePrNumberFromUrl(row.claude_pr_url) : null;
  if (!prNumber) {
    await stampChecked(supabase, row.id);
    return { feedback_id: row.id, action: "no_netlify_status" };
  }

  // 1. Resolve head SHA + liveness. A merged / closed PR has no live
  //    preview to show, so we stop polling it.
  const pr = await getPullRequest(ghCfg, prNumber);
  if (pr.merged || pr.state === "closed") {
    await stampChecked(supabase, row.id);
    return { feedback_id: row.id, action: "pr_closed" };
  }
  if (!pr.head_sha) {
    await stampChecked(supabase, row.id);
    return { feedback_id: row.id, action: "no_netlify_status" };
  }

  // 2. Pull combined statuses and hunt for the Netlify preview context.
  const statuses = await getCombinedStatus(ghCfg, pr.head_sha);
  const netlify = findNetlifyPreview(statuses);

  if (!netlify) {
    await stampChecked(supabase, row.id);
    return { feedback_id: row.id, action: "no_netlify_status" };
  }

  if (netlify.state !== "success" || !netlify.target_url) {
    await stampChecked(supabase, row.id);
    return { feedback_id: row.id, action: "still_pending" };
  }

  // Defense-in-depth: a compromised GitHub status could set target_url
  // to `javascript:` or a non-HTTPS phishing link. Plain-text email
  // clients won't execute JS, but Apple Mail / Outlook auto-link every
  // URL-like substring. Gate on https:// before anything reaches the
  // submitter's inbox.
  if (!/^https:\/\//i.test(netlify.target_url)) {
    console.warn(
      `preview_ready rejected non-https target_url for ${row.id}: ${netlify.target_url}`,
    );
    await stampChecked(supabase, row.id);
    return { feedback_id: row.id, action: "still_pending" };
  }

  // 3. First-time success: stamp URL + timestamps, emit timeline event.
  //    CRITICAL: the `.is("claude_preview_ready_at", null)` guard makes
  //    the UPDATE a no-op if another concurrent tick already stamped
  //    the row — but Supabase/PostgREST does NOT surface that as an
  //    error. We MUST read back the affected row count via .select()
  //    and skip the event insert when it's 0, otherwise both racing
  //    ticks emit a preview_ready event → duplicate email to Angela.
  const readyAt = new Date().toISOString();
  const { data: updRows, error: updErr } = await supabase
    .from("hub_feedback")
    .update({
      claude_preview_url: netlify.target_url,
      claude_preview_ready_at: readyAt,
      claude_preview_checked_at: readyAt,
    })
    .eq("id", row.id)
    .eq("workspace_id", row.workspace_id) // belt-and-braces workspace isolation
    .is("claude_preview_ready_at", null) // idempotent guard
    .select("id");

  if (updErr) throw new Error(`preview stamp: ${updErr.message}`);

  // Zero rows updated == another tick won the race (or the row was
  // re-stamped out-of-band). Skip the event insert; the winning tick
  // already emitted it.
  if (!updRows || updRows.length === 0) {
    return { feedback_id: row.id, action: "still_pending" };
  }

  const { error: evtErr } = await supabase.from("hub_feedback_events").insert({
    feedback_id: row.id,
    workspace_id: row.workspace_id,
    event_type: "preview_ready",
    from_status: row.status,
    to_status: row.status,
    actor_id: null,
    actor_role: "service",
    payload: {
      claude_preview_url: netlify.target_url,
      netlify_context: netlify.context,
    },
  });
  if (evtErr) {
    // Event failure is recoverable noise — URL already landed on the row.
    console.warn(`preview_ready event insert failed for ${row.id}: ${evtErr.message}`);
  }

  return {
    feedback_id: row.id,
    action: "preview_ready",
    preview_url: netlify.target_url,
  };
}

async function stampChecked(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from("hub_feedback")
    .update({ claude_preview_checked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.warn(`preview stamp_checked failed for ${id}: ${error.message}`);
  }
}

/**
 * Netlify posts one status per PR with context `netlify/<site-name>`.
 * Pick the most-recently-updated one that starts with the prefix — if a
 * repo has multiple Netlify sites (main + storybook, say) the freshest
 * success is the one the submitter wants to click.
 */
function findNetlifyPreview(statuses: GithubStatusEntry[]): GithubStatusEntry | null {
  const candidates = statuses.filter((s) =>
    s.context.toLowerCase().startsWith(NETLIFY_CONTEXT_PREFIX),
  );
  if (candidates.length === 0) return null;
  // Prefer success with target_url, else freshest of any state.
  const successWithUrl = candidates.filter((s) => s.state === "success" && s.target_url);
  const pool = successWithUrl.length > 0 ? successWithUrl : candidates;
  pool.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return pool[0] ?? null;
}
