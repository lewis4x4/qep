/**
 * hub-knowledge-sync — mirror hub_changelog / hub_decisions / hub_build_items
 * into hub_knowledge_source + embedded chunks. Also pushes markdown to a
 * Google Drive folder (the NotebookLM side) when GOOGLE_SERVICE_ACCOUNT_KEY
 * is set.
 *
 * Scheduled every 4h (see migration 317). Runs the Supabase-mirror step
 * unconditionally (that's what Ask-the-Brain actually reads) and the Drive
 * step when credentials are present.
 *
 * Design notes:
 *   * Idempotency key: content_hash (sha256 of body_markdown). If the hash
 *     hasn't changed since last sync, we skip re-chunking/re-embedding.
 *   * Chunk strategy: paragraph-aware, max 900 tokens per chunk (≈ 3000 chars).
 *   * Embedding provider: text-embedding-3-small via _shared/openai-embeddings.ts,
 *     matching migrations 268/269 for parts and 053 for CRM. Do NOT introduce
 *     a second provider — dimension resilience depends on single-source.
 *   * Zero-blocking: OpenAI key missing → skip embedding but still upsert the
 *     source row (chunks will be backfilled on the next run). Drive missing →
 *     skip push but keep mirror.
 *
 * Auth: service-role-only (x-internal-service-secret or Bearer service_role).
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
  embedTexts,
  formatVectorLiteral,
  OPENAI_EMBEDDING_MODEL,
} from "../_shared/openai-embeddings.ts";
import {
  issueAccessToken,
  listFolderMarkdown,
  loadDriveConfig,
  upsertMarkdownFile,
} from "../_shared/google-drive.ts";

const MAX_CHUNK_CHARS = 3000;
const CHUNK_OVERLAP_CHARS = 200;
const MAX_SOURCES_PER_RUN = 200;

interface SyncCandidate {
  key: string; // stable identifier for idempotency (e.g., "changelog:<uuid>")
  source_type: "changelog" | "decision" | "spec" | "feedback";
  title: string;
  body: string;
  workspace_id: string;
  related_build_item_id: string | null;
  related_decision_id: string | null;
  related_feedback_id: string | null;
  drive_filename: string;
}

interface RunResult {
  key: string;
  action: "inserted" | "updated" | "unchanged" | "embed_skipped" | "error";
  chunks?: number;
  drive_file_id?: string | null;
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
    return safeJsonError("SUPABASE_URL/SERVICE_ROLE_KEY missing", 500, origin);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const candidates = await gatherCandidates(supabase);

    // Drive setup (best-effort).
    const driveCfg = loadDriveConfig();
    let driveToken: string | null = null;
    let driveIndex = new Map<string, string>();
    if (driveCfg) {
      try {
        driveToken = await issueAccessToken(driveCfg);
        const files = await listFolderMarkdown(driveCfg, driveToken);
        driveIndex = new Map(files.map((f) => [f.name, f.id]));
      } catch (e) {
        console.warn(
          "[hub-knowledge-sync] drive setup failed (push disabled):",
          e instanceof Error ? e.message : e,
        );
        driveToken = null;
      }
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const results: RunResult[] = [];

    for (const cand of candidates) {
      try {
        const result = await syncOne(supabase, cand, {
          driveCfg,
          driveToken,
          driveIndex,
          embeddingEnabled: Boolean(openaiKey),
        });
        results.push(result);
      } catch (err) {
        console.error(
          `[hub-knowledge-sync] sync failed for ${cand.key}:`,
          err instanceof Error ? err.message : err,
        );
        results.push({
          key: cand.key,
          action: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const inserted = results.filter((r) => r.action === "inserted").length;
    const updated = results.filter((r) => r.action === "updated").length;
    const unchanged = results.filter((r) => r.action === "unchanged").length;

    console.info(
      `[hub-knowledge-sync] ${candidates.length} candidates: +${inserted} ~${updated} =${unchanged}`,
    );

    return safeJsonOk(
      {
        processed: candidates.length,
        inserted,
        updated,
        unchanged,
        drive_enabled: Boolean(driveToken),
        embedding_enabled: Boolean(openaiKey),
        results,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-knowledge-sync" });
    console.error("[hub-knowledge-sync]", err);
    return safeJsonError("Internal error", 500, origin);
  }
});

async function gatherCandidates(supabase: SupabaseClient): Promise<SyncCandidate[]> {
  const out: SyncCandidate[] = [];

  // ── changelog ──
  {
    const { data, error } = await supabase
      .from("hub_changelog")
      .select(
        "id, workspace_id, build_item_id, summary, details, change_type, commit_sha, demo_url, created_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_SOURCES_PER_RUN);
    if (error) throw new Error(`changelog query: ${error.message}`);
    for (const r of data ?? []) {
      const body = renderChangelogMarkdown(r as Record<string, unknown>);
      out.push({
        key: `changelog:${r.id}`,
        source_type: "changelog",
        title: `Changelog — ${String(r.summary).slice(0, 80)}`,
        body,
        workspace_id: String(r.workspace_id ?? "default"),
        related_build_item_id: (r.build_item_id as string | null) ?? null,
        related_decision_id: null,
        related_feedback_id: null,
        drive_filename: `changelog/${String(r.id).slice(0, 8)}-${slugify(String(r.summary))}.md`,
      });
    }
  }

  // ── decisions ──
  {
    const { data, error } = await supabase
      .from("hub_decisions")
      .select(
        "id, workspace_id, title, context, decision, decided_by, affects_modules, related_build_item_ids, created_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_SOURCES_PER_RUN);
    if (error) throw new Error(`decisions query: ${error.message}`);
    for (const r of data ?? []) {
      const body = renderDecisionMarkdown(r as Record<string, unknown>);
      out.push({
        key: `decision:${r.id}`,
        source_type: "decision",
        title: String(r.title),
        body,
        workspace_id: String(r.workspace_id ?? "default"),
        related_build_item_id: null,
        related_decision_id: r.id as string,
        related_feedback_id: null,
        drive_filename: `decisions/${String(r.id).slice(0, 8)}-${slugify(String(r.title))}.md`,
      });
    }
  }

  // ── shipped build items (spec snapshots) ──
  {
    const { data, error } = await supabase
      .from("hub_build_items")
      .select(
        "id, workspace_id, module, title, description, status, sprint_number, demo_url, source_commit_sha, shipped_at, created_at, updated_at",
      )
      .is("deleted_at", null)
      .eq("status", "shipped")
      .order("shipped_at", { ascending: false })
      .limit(MAX_SOURCES_PER_RUN);
    if (error) throw new Error(`build_items query: ${error.message}`);
    for (const r of data ?? []) {
      const body = renderBuildItemMarkdown(r as Record<string, unknown>);
      out.push({
        key: `spec:${r.id}`,
        source_type: "spec",
        title: `Spec — ${String(r.title)}`,
        body,
        workspace_id: String(r.workspace_id ?? "default"),
        related_build_item_id: r.id as string,
        related_decision_id: null,
        related_feedback_id: null,
        drive_filename: `specs/${String(r.id).slice(0, 8)}-${slugify(String(r.title))}.md`,
      });
    }
  }

  // ── shipped + wont_fix feedback ──
  //
  // v2.3 "Remembered" tenet: pulls every feedback row that reached a
  // terminal state (shipped or wont_fix) so Ask-the-Brain can cite the
  // original submitter story. We include wont_fix because "we considered
  // X and decided against it because Y" is equally important institutional
  // memory — and the triage summary + body is where the reasoning lives.
  {
    const { data, error } = await supabase
      .from("hub_feedback")
      .select(
        "id, workspace_id, build_item_id, submitted_by, feedback_type, body, voice_transcript, submission_context, priority, status, ai_summary, ai_suggested_action, claude_pr_url, created_at, resolved_at",
      )
      .is("deleted_at", null)
      .in("status", ["shipped", "wont_fix"])
      .order("resolved_at", { ascending: false, nullsFirst: false })
      .limit(MAX_SOURCES_PER_RUN);
    if (error) throw new Error(`feedback query: ${error.message}`);
    for (const r of data ?? []) {
      const body = renderFeedbackMarkdown(r as Record<string, unknown>);
      const summary = typeof r.ai_summary === "string" && r.ai_summary.length > 0
        ? r.ai_summary
        : String(r.body ?? "").slice(0, 80);
      out.push({
        key: `feedback:${r.id}`,
        source_type: "feedback",
        title: `Feedback — ${summary.slice(0, 80)}`,
        body,
        workspace_id: String(r.workspace_id ?? "default"),
        related_build_item_id: (r.build_item_id as string | null) ?? null,
        related_decision_id: null,
        related_feedback_id: r.id as string,
        drive_filename: `feedback/${String(r.id).slice(0, 8)}-${slugify(summary)}.md`,
      });
    }
  }

  return out;
}

async function syncOne(
  supabase: SupabaseClient,
  cand: SyncCandidate,
  opts: {
    driveCfg: ReturnType<typeof loadDriveConfig>;
    driveToken: string | null;
    driveIndex: Map<string, string>;
    embeddingEnabled: boolean;
  },
): Promise<RunResult> {
  const contentHash = await sha256Hex(cand.body);

  // Lookup existing row by (workspace_id, drive_file_id). We use the cand.key
  // as a stable drive_file_id surrogate even when Drive is disabled — this
  // guarantees one row per candidate regardless of real Drive availability.
  const { data: existing } = await supabase
    .from("hub_knowledge_source")
    .select("id, content_hash, drive_file_id, title")
    .eq("workspace_id", cand.workspace_id)
    .eq("drive_file_id", cand.key)
    .maybeSingle();

  if (existing && existing.content_hash === contentHash) {
    return { key: cand.key, action: "unchanged" };
  }

  // Drive push (best-effort) — record the real Drive ID in notebooklm_source_id
  // so NotebookLM can resolve citations back.
  let realDriveFileId: string | null = null;
  if (opts.driveCfg && opts.driveToken) {
    try {
      const existingDriveId = opts.driveIndex.get(cand.drive_filename) ?? null;
      realDriveFileId = await upsertMarkdownFile(opts.driveCfg, opts.driveToken, {
        name: cand.drive_filename,
        content: cand.body,
        existingId: existingDriveId,
      });
    } catch (e) {
      console.warn(
        `[hub-knowledge-sync] drive push failed for ${cand.key}:`,
        e instanceof Error ? e.message : e,
      );
      realDriveFileId = null;
    }
  }

  // Upsert source row. drive_file_id stays as `cand.key` (the stable surrogate).
  let sourceId: string;
  if (existing) {
    const { error } = await supabase
      .from("hub_knowledge_source")
      .update({
        title: cand.title,
        source_type: cand.source_type,
        body_markdown: cand.body,
        content_hash: contentHash,
        related_build_item_id: cand.related_build_item_id,
        related_decision_id: cand.related_decision_id,
        related_feedback_id: cand.related_feedback_id,
        notebooklm_source_id: realDriveFileId,
        synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`source update: ${error.message}`);
    sourceId = existing.id as string;
  } else {
    const { data: ins, error } = await supabase
      .from("hub_knowledge_source")
      .insert({
        workspace_id: cand.workspace_id,
        drive_file_id: cand.key,
        notebooklm_source_id: realDriveFileId,
        title: cand.title,
        source_type: cand.source_type,
        body_markdown: cand.body,
        content_hash: contentHash,
        related_build_item_id: cand.related_build_item_id,
        related_decision_id: cand.related_decision_id,
        related_feedback_id: cand.related_feedback_id,
      })
      .select("id")
      .single();
    if (error || !ins) throw new Error(`source insert: ${error?.message ?? "unknown"}`);
    sourceId = ins.id as string;
  }

  // Prepare replacement chunks BEFORE wiping old ones. Otherwise an embedding
  // failure (e.g. OpenAI 429) would leave the source with zero chunks and
  // Ask-the-Brain would silently drop this source from retrieval until the
  // next 4h sync tick. Build the full rows array first, then swap atomically.
  const chunks = chunkMarkdown(cand.body);
  if (chunks.length === 0) {
    // Empty body: wipe and return without inserting.
    await supabase.from("hub_knowledge_chunk").delete().eq("source_id", sourceId);
    return {
      key: cand.key,
      action: existing ? "updated" : "inserted",
      chunks: 0,
      drive_file_id: realDriveFileId,
    };
  }

  let rows: Array<Record<string, unknown>>;
  if (!opts.embeddingEnabled) {
    rows = chunks.map((body, i) => ({
      source_id: sourceId,
      workspace_id: cand.workspace_id,
      chunk_index: i,
      body,
      embedding_model: OPENAI_EMBEDDING_MODEL,
    }));
  } else {
    // Embed first — if this throws, the existing chunks stay intact.
    const vectors = await embedTexts(chunks);
    rows = chunks.map((body, i) => ({
      source_id: sourceId,
      workspace_id: cand.workspace_id,
      chunk_index: i,
      body,
      embedding: formatVectorLiteral(vectors[i]),
      embedding_model: OPENAI_EMBEDDING_MODEL,
      token_count: approximateTokenCount(body),
    }));
  }

  // Now it's safe to swap: delete old chunks, then insert fresh ones.
  await supabase.from("hub_knowledge_chunk").delete().eq("source_id", sourceId);
  const { error } = await supabase.from("hub_knowledge_chunk").insert(rows);
  if (error) throw new Error(`chunk insert: ${error.message}`);

  return {
    key: cand.key,
    action: opts.embeddingEnabled
      ? existing ? "updated" : "inserted"
      : "embed_skipped",
    chunks: chunks.length,
    drive_file_id: realDriveFileId,
  };
}

function chunkMarkdown(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  // Paragraph-aware: split on double newlines; fall through to char window
  // if a single paragraph is oversized.
  const paras = trimmed.split(/\n\s*\n/);
  let buf = "";
  for (const para of paras) {
    if ((buf + "\n\n" + para).length > MAX_CHUNK_CHARS && buf.length > 0) {
      chunks.push(buf.trim());
      // carry last N chars for overlap
      const tail = buf.slice(-CHUNK_OVERLAP_CHARS);
      buf = tail + "\n\n" + para;
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
    // If a single paragraph is gigantic, split it by sliding window.
    while (buf.length > MAX_CHUNK_CHARS * 2) {
      chunks.push(buf.slice(0, MAX_CHUNK_CHARS).trim());
      buf = buf.slice(MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS);
    }
  }
  if (buf.trim().length > 0) chunks.push(buf.trim());
  return chunks;
}

function approximateTokenCount(text: string): number {
  // Rough 4 chars/token heuristic — good enough for budgeting.
  return Math.max(1, Math.round(text.length / 4));
}

function renderChangelogMarkdown(r: Record<string, unknown>): string {
  return [
    `# ${String(r.summary ?? "Changelog entry")}`,
    "",
    `- Type: **${r.change_type}**`,
    `- Committed: ${r.created_at}`,
    r.commit_sha ? `- Commit: \`${String(r.commit_sha).slice(0, 12)}\`` : null,
    r.demo_url ? `- Link: ${r.demo_url}` : null,
    "",
    r.details ? `## Details\n\n${r.details}` : "",
  ]
    .filter((x) => x !== null && x !== "")
    .join("\n");
}

function renderDecisionMarkdown(r: Record<string, unknown>): string {
  const decidedBy = Array.isArray(r.decided_by) ? (r.decided_by as string[]).join(", ") : "";
  const modules = Array.isArray(r.affects_modules)
    ? (r.affects_modules as string[]).join(", ")
    : "";
  return [
    `# ${String(r.title ?? "Decision")}`,
    "",
    decidedBy ? `- Decided by: ${decidedBy}` : null,
    modules ? `- Affects: ${modules}` : null,
    `- Recorded: ${r.created_at}`,
    "",
    r.context ? `## Context\n\n${r.context}` : null,
    r.decision ? `## Decision\n\n${r.decision}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderFeedbackMarkdown(r: Record<string, unknown>): string {
  const ctx = (r.submission_context && typeof r.submission_context === "object"
    ? r.submission_context
    : {}) as Record<string, unknown>;
  const path = typeof ctx.path === "string" ? ctx.path : null;
  const status = String(r.status ?? "");
  const priority = String(r.priority ?? "");
  const type = String(r.feedback_type ?? "");
  const title = typeof r.ai_summary === "string" && r.ai_summary.length > 0
    ? r.ai_summary
    : String(r.body ?? "").slice(0, 120);

  const outcomeLine = status === "shipped"
    ? "- Outcome: **SHIPPED**"
    : status === "wont_fix"
      ? "- Outcome: **WONT FIX** — reasoning below is institutional memory for why we didn't pursue this."
      : `- Status: ${status}`;

  return [
    `# ${title}`,
    "",
    outcomeLine,
    `- Type: ${type}`,
    `- Priority: ${priority}`,
    path ? `- Surface: \`${path}\`` : null,
    r.created_at ? `- Submitted: ${r.created_at}` : null,
    r.resolved_at ? `- Resolved: ${r.resolved_at}` : null,
    r.claude_pr_url ? `- PR: ${r.claude_pr_url}` : null,
    "",
    r.ai_suggested_action
      ? `## Triage\n\n${r.ai_suggested_action}`
      : null,
    `## Original feedback\n\n${String(r.body ?? "").slice(0, 4000)}`,
    typeof r.voice_transcript === "string" && r.voice_transcript.length > 0
      ? `## Voice transcript\n\n${r.voice_transcript}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderBuildItemMarkdown(r: Record<string, unknown>): string {
  return [
    `# ${String(r.title ?? "Build item")}`,
    "",
    `- Module: **${r.module}**`,
    `- Status: ${r.status}`,
    r.sprint_number ? `- Sprint: ${r.sprint_number}` : null,
    r.shipped_at ? `- Shipped: ${r.shipped_at}` : null,
    r.demo_url ? `- Demo: ${r.demo_url}` : null,
    r.source_commit_sha ? `- Commit: \`${String(r.source_commit_sha).slice(0, 12)}\`` : null,
    "",
    r.description ? `## Description\n\n${r.description}` : "",
  ]
    .filter((x) => x !== null && x !== "")
    .join("\n");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "item";
}
