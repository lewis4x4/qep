/**
 * hub-changelog-from-commit — cron that transforms merged [QEP-*] commits into
 * plain-voice hub_changelog entries and closes the feedback loop when a commit
 * is tied to a hub_feedback row.
 *
 * Runs every 15 min (see migration-registered pg_cron job, TBD in Day 7-8).
 * Auth path: x-internal-service-secret header (verify_jwt=false at the gateway).
 *
 * Scan logic:
 *   1. Load recent commits on `main` since the newest commit_sha already in
 *      hub_changelog (fallback: last 24h).
 *   2. Filter to commits whose message starts with [QEP-*] OR whose associated
 *      PR body contains the `hub-fb-id:` marker that hub-feedback-draft-fix
 *      writes.
 *   3. For each eligible commit, ask Claude Sonnet 4.6 for a one-sentence
 *      plain-voice summary (enforcing Rylee's tone rules: no "thrilled", no
 *      jargon, numbers first if any).
 *   4. Insert a hub_changelog row. If the commit closes a feedback item
 *      (resolvable via PR body marker), also flip hub_feedback.status → 'shipped'
 *      and set resolved_at.
 *
 * Zero-blocking: if GITHUB_TOKEN is unset, returns 200 with
 * { skipped: true, reason: 'github_not_configured' } so the cron doesn't
 * thrash the logs. Same for ANTHROPIC_API_KEY.
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
  listCommitsOnBranch,
  listPrsForCommit,
  loadGithubConfig,
} from "../_shared/github-api.ts";

const TONE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 256;
const TEMPERATURE = 0.2;
const ANTHROPIC_TIMEOUT_MS = 20_000;
const DEFAULT_LOOKBACK_HOURS = 24;
const COMMIT_SCAN_PER_RUN = 50;

// QEP-HUB is the canonical marker for hub-feedback merges. QEP-* broadens the
// net to generic internal commits we also want in the changelog feed.
const QEP_TAG_RE = /^\[QEP(?:-[A-Z0-9]+)?\]/;
// Written by hub-feedback-draft-fix into PR bodies: `_hub-feedback-id: <uuid>_`
const FEEDBACK_ID_RE = /hub-feedback-id:\s*`?([0-9a-fA-F-]{36})`?/;

const SYSTEM_PROMPT = `You are writing a single-sentence changelog line for a dealership operator who has never read the code.

Rules:
- One sentence, max 25 words.
- Plain voice — no "thrilled to", no "excited to", no "proud to announce". Just the change.
- Lead with the outcome, not the mechanism. "Column headers now wrap on mobile" beats "Refactored FlexGrid layout".
- Include specific names/numbers from the commit message if present.
- If the commit only touches internal scaffolding (types, tests, lint), return the exact string SKIP.

Examples:
good: "Parts bulk import now accepts 5,000 rows without timing out."
good: "Fixed the duplicate-deal warning that was firing on every new company."
bad: "Exciting performance improvements to the parts import system!"
bad: "Refactored the deduplication logic."`;

interface CommitTouched {
  sha: string;
  commit_sha_full: string;
  message_first_line: string;
  summary: string;
  change_type: "shipped" | "updated" | "fixed" | "started";
  feedback_id: string | null;
  commit_url: string;
  committed_at: string;
  inserted: boolean;
  skipped_reason?: string;
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
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("SUPABASE_URL/SERVICE_ROLE_KEY missing", 500, origin);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const ghCfg = loadGithubConfig();
    if (!ghCfg) {
      return safeJsonOk(
        { skipped: true, reason: "github_not_configured", processed: 0 },
        origin,
      );
    }
    if (!anthropicKey) {
      return safeJsonOk(
        { skipped: true, reason: "anthropic_not_configured", processed: 0 },
        origin,
      );
    }

    // 1. Resolve `since` — newest changelog commit or fallback window.
    const since = await resolveSince(supabase);

    // 2. Pull commits from main.
    const commits = await listCommitsOnBranch(ghCfg, {
      branch: ghCfg.baseBranch,
      since,
      perPage: COMMIT_SCAN_PER_RUN,
    });

    // 3. Preload existing commit_sha set so we don't double-insert on overlap.
    const shas = commits.map((c) => c.sha);
    const { data: existingRows } = shas.length
      ? await supabase
          .from("hub_changelog")
          .select("commit_sha")
          .in("commit_sha", shas)
      : { data: [] as Array<{ commit_sha: string }> };
    const existingSet = new Set(
      (existingRows ?? []).map((r) => r.commit_sha).filter(Boolean) as string[],
    );

    const touched: CommitTouched[] = [];

    for (const c of commits) {
      if (existingSet.has(c.sha)) continue;

      const firstLine = c.message.split("\n")[0] ?? "";
      const isQepTag = QEP_TAG_RE.test(firstLine);

      // Resolve feedback link via PR body marker.
      let feedbackId: string | null = null;
      try {
        const prs = await listPrsForCommit(ghCfg, c.sha);
        for (const pr of prs) {
          const match = pr.body?.match(FEEDBACK_ID_RE);
          if (match) {
            feedbackId = match[1].toLowerCase();
            break;
          }
        }
      } catch (e) {
        // PR lookup is best-effort — continue without feedback linkage.
        console.warn(
          `[hub-changelog] listPrsForCommit failed for ${c.sha}:`,
          e instanceof Error ? e.message : e,
        );
      }

      // Neither a QEP-tag nor a feedback-id? skip silently.
      if (!isQepTag && !feedbackId) {
        touched.push({
          sha: c.sha.slice(0, 8),
          commit_sha_full: c.sha,
          message_first_line: firstLine,
          summary: "",
          change_type: "updated",
          feedback_id: null,
          commit_url: c.html_url,
          committed_at: c.committed_at,
          inserted: false,
          skipped_reason: "no_qep_tag_no_feedback_id",
        });
        continue;
      }

      // 4. Ask Claude for a one-liner.
      let summary: string;
      try {
        summary = await summarizeCommit(anthropicKey, c.message);
      } catch (e) {
        console.warn(
          `[hub-changelog] summarize failed for ${c.sha}:`,
          e instanceof Error ? e.message : e,
        );
        summary = firstLine.slice(0, 120);
      }

      if (summary.trim().toUpperCase() === "SKIP") {
        touched.push({
          sha: c.sha.slice(0, 8),
          commit_sha_full: c.sha,
          message_first_line: firstLine,
          summary: "",
          change_type: "updated",
          feedback_id: feedbackId,
          commit_url: c.html_url,
          committed_at: c.committed_at,
          inserted: false,
          skipped_reason: "claude_returned_skip",
        });
        continue;
      }

      const changeType = inferChangeType(firstLine);

      // 5. Resolve workspace via feedback row if available; fall back to 'default'.
      let workspaceId = "default";
      let buildItemId: string | null = null;
      if (feedbackId) {
        const { data: fb } = await supabase
          .from("hub_feedback")
          .select("workspace_id, build_item_id")
          .eq("id", feedbackId)
          .maybeSingle();
        if (fb?.workspace_id) workspaceId = fb.workspace_id;
        if (fb?.build_item_id) buildItemId = fb.build_item_id;
      }

      // 6. Insert changelog row.
      const { error: insErr } = await supabase.from("hub_changelog").insert({
        workspace_id: workspaceId,
        build_item_id: buildItemId,
        feedback_id: feedbackId,
        summary,
        details: firstLine,
        change_type: changeType,
        commit_sha: c.sha,
        demo_url: c.html_url,
      });

      if (insErr) {
        console.warn(
          `[hub-changelog] insert failed for ${c.sha}:`,
          insErr.message,
        );
        touched.push({
          sha: c.sha.slice(0, 8),
          commit_sha_full: c.sha,
          message_first_line: firstLine,
          summary,
          change_type: changeType,
          feedback_id: feedbackId,
          commit_url: c.html_url,
          committed_at: c.committed_at,
          inserted: false,
          skipped_reason: `insert_error: ${insErr.message.slice(0, 80)}`,
        });
        continue;
      }

      // 7. If feedback, mark it shipped.
      if (feedbackId) {
        await supabase
          .from("hub_feedback")
          .update({
            status: "shipped",
            resolved_at: new Date().toISOString(),
          })
          .eq("id", feedbackId)
          .in("status", ["awaiting_merge", "drafting", "triaged", "open"]);
      }

      touched.push({
        sha: c.sha.slice(0, 8),
        commit_sha_full: c.sha,
        message_first_line: firstLine,
        summary,
        change_type: changeType,
        feedback_id: feedbackId,
        commit_url: c.html_url,
        committed_at: c.committed_at,
        inserted: true,
      });
    }

    const inserted = touched.filter((t) => t.inserted).length;
    console.info(
      `[hub-changelog] scan complete: ${commits.length} commits, ${inserted} inserted, since=${since}`,
    );

    return safeJsonOk(
      {
        scanned: commits.length,
        inserted,
        since,
        touched,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-changelog-from-commit" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

async function resolveSince(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from("hub_changelog")
    .select("created_at")
    .is("deleted_at", null)
    .not("commit_sha", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.created_at) {
    // Step back a minute to be safe against clock skew on GitHub.
    return new Date(new Date(data.created_at).getTime() - 60_000).toISOString();
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 3_600_000).toISOString();
}

function inferChangeType(firstLine: string): "shipped" | "updated" | "fixed" | "started" {
  const lower = firstLine.toLowerCase();
  if (lower.startsWith("fix") || lower.includes("[qep-fix]")) return "fixed";
  if (lower.startsWith("feat") || lower.includes("[qep-feat]")) return "shipped";
  if (lower.startsWith("chore(hub)")) return "updated";
  if (lower.includes("[qep-hub]")) return "shipped";
  return "updated";
}

async function summarizeCommit(apiKey: string, fullMessage: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TONE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Commit message:\n\n${fullMessage.slice(0, 1500)}\n\nWrite the one-sentence changelog line. If internal-only scaffolding, return SKIP.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const textPart = ((data?.content ?? []) as Array<{ type: string; text?: string }>).find(
    (c) => c.type === "text",
  );
  return (textPart?.text ?? "").trim().replace(/^"|"$/g, "");
}
