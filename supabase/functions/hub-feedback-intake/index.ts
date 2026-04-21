/**
 * hub-feedback-intake — Stakeholder Build Hub feedback intake + AI triage.
 *
 * POST body:
 *   {
 *     body: string,                   // required, 1..4000 chars
 *     feedback_type?: "bug" | "suggestion" | "question" | "approval" | "concern",
 *     build_item_id?: string,         // uuid
 *     voice_audio_url?: string,
 *     voice_transcript?: string,
 *     voice_duration_ms?: number,
 *     screenshot_url?: string,
 *     submission_context?: { path, title, screen, dark_mode, ua_short, ... }
 *   }
 *
 * Flow:
 *   1. requireHubUser — stakeholders + internal roles allowed.
 *   2. Call Claude Sonnet 4.6 to infer type (if missing), priority,
 *      one-line ai_summary, ai_suggested_action.
 *   3. v2.4 dedup: embed "<body>\n<ai_summary>" with
 *      text-embedding-3-small and call match_hub_feedback_dedup to find
 *      the nearest in-flight workspace row. If similarity ≥ 0.85, we'll
 *      create the new row AND a hub_feedback_links edge — both submitters
 *      keep their loop-back, but Brian sees "+1 linked" signal instead
 *      of a duplicate card.
 *   4. Insert hub_feedback row with status='triaged' (skips 'open' — we
 *      triage synchronously so Brian sees a filled row the moment the
 *      stakeholder submits).
 *   5. If we found a dedup match, write hub_feedback_links (service role)
 *      + emit a 'duplicate_linked' event on the primary.
 *   6. If priority='high', fire Resend email to the ops inbox (HUB_OPS_EMAIL).
 *      Zero-blocking: falls back to no-op when RESEND_API_KEY is unset.
 *
 * Zero-blocking on dedup: if OPENAI_API_KEY is missing or the embedding
 * call fails, we skip dedup and proceed with the classic insert path.
 * Brian still gets the row; the link is lossy but not load-bearing.
 *
 * Auth: user JWT (stakeholders + admin/owner/manager/rep).
 * Response: { feedback, triage_model, elapsed_ms, linked_to?: { id, similarity } }.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireHubUser } from "../_shared/hub-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";

// Empirically 0.85 cosine ≈ "these are about the same thing." Below that
// we see distinct issues in the same module get lumped together (false
// merge), above it we miss obvious "+1" cases. Tuned from the v2.4
// calibration set in docs/build-hub-v2-roadmap.md.
const DEDUP_MIN_SIMILARITY = 0.85;
const DEDUP_MAX_AGE_DAYS = 45;

const TRIAGE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;
const TEMPERATURE = 0.1;
const ANTHROPIC_TIMEOUT_MS = 20_000;

type FeedbackType = "bug" | "suggestion" | "question" | "approval" | "concern";
type Priority = "low" | "medium" | "high";

interface IntakeBody {
  body?: unknown;
  feedback_type?: unknown;
  build_item_id?: unknown;
  voice_audio_url?: unknown;
  voice_transcript?: unknown;
  voice_duration_ms?: unknown;
  screenshot_url?: unknown;
  submission_context?: unknown;
}

/** Shape the client sends; validated but stored loosely as jsonb. */
interface SubmissionContext {
  path?: string;
  title?: string;
  build_item_id?: string | null;
  screen?: { w?: number; h?: number };
  dark_mode?: boolean;
  ua_short?: string;
}

interface TriageResult {
  feedback_type: FeedbackType;
  priority: Priority;
  ai_summary: string;
  ai_suggested_action: string;
  confidence: "high" | "low";
}

const TRIAGE_SYSTEM = `You are the triage assistant for QEP OS Stakeholder Build Hub.

QEP USA stakeholders (Ryan, Rylee, Juan, Angela) submit short feedback about
the QEP OS platform as Brian builds it. Your job: classify it and propose the
next action so Brian can act in seconds.

Return ONLY JSON with this exact shape:
{
  "feedback_type": "bug" | "suggestion" | "question" | "approval" | "concern",
  "priority": "low" | "medium" | "high",
  "ai_summary": "<one sentence, <= 160 chars, operator voice>",
  "ai_suggested_action": "<one sentence starting with an imperative verb>",
  "confidence": "high" | "low"
}

Rules:
- Priority "high" only for: broken flow, data loss, auth failure, stakeholder-blocking.
- "approval" type: stakeholder is praising/confirming; priority is always "low".
- "question": needs answer, not code. Suggested action starts with "Reply:".
- Summary is plain, no marketing voice. Never start with "The user...".
- Suggested action is concrete ("Fix X", "Reply: <short answer>", "Draft PR to Y").
- If the body is ambiguous or < 8 words, confidence is "low".
- When a "Submitted from path" is provided, reference it in the summary
  (e.g., "On /qrm/quotes/new …"). The stakeholder shouldn't have to tell us
  where they were — we already know.`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const startMs = Date.now();

  try {
    const auth = await requireHubUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return safeJsonError("ANTHROPIC_API_KEY not set", 500, origin);
    }

    const raw = (await req.json().catch(() => null)) as IntakeBody | null;
    if (!raw) return safeJsonError("Invalid JSON body", 400, origin);

    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (!body) return safeJsonError("body is required", 400, origin);
    if (body.length > 4000) return safeJsonError("body too long (4000 char max)", 400, origin);

    const providedType = normalizeType(raw.feedback_type);
    const buildItemId = typeof raw.build_item_id === "string" && raw.build_item_id.length === 36
      ? raw.build_item_id
      : null;
    const voiceAudioUrl = typeof raw.voice_audio_url === "string" ? raw.voice_audio_url : null;
    const voiceTranscript = typeof raw.voice_transcript === "string" ? raw.voice_transcript : null;
    const voiceDurationMs = typeof raw.voice_duration_ms === "number" && isFinite(raw.voice_duration_ms)
      ? Math.max(0, Math.round(raw.voice_duration_ms))
      : null;
    const screenshotUrl = typeof raw.screenshot_url === "string" ? raw.screenshot_url : null;
    const submissionContext = sanitizeSubmissionContext(raw.submission_context);

    // If the submitter picked a type, we still ask Claude to triage for
    // priority + summary, but we keep their type unless it's clearly wrong
    // (confidence handling below).
    const triage = await triageWithClaude({
      apiKey: anthropicKey,
      body,
      providedType,
      voiceTranscript,
      submissionContext,
      audience: auth.audience,
      subrole: auth.subrole,
    });

    const finalType: FeedbackType = providedType ?? triage.feedback_type;

    // ── v2.4 dedup: embed body+summary, search for near-duplicates ──
    //
    // We run the embedding + match step before insert so the new row goes
    // in WITH the embedding populated (no follow-up UPDATE needed) and so
    // we can write the link atomically-ish. The match uses the caller's
    // JWT-scoped RPC (SECURITY DEFINER inside resolves workspace), so we
    // don't need service role for the lookup.
    //
    // Zero-blocking: if any step fails, we fall through to the plain
    // insert path — dedup is a nice-to-have, not load-bearing.
    let embeddingLiteral: string | null = null;
    let dedupMatch: DedupMatch | null = null;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (openaiKey) {
      try {
        const embedText_ = [body, triage.ai_summary].filter(Boolean).join("\n").slice(0, 8000);
        const vec = await embedText(embedText_);
        embeddingLiteral = formatVectorLiteral(vec);
        dedupMatch = await findDedupMatch(auth.supabase, embeddingLiteral, auth.workspaceId);
      } catch (err) {
        console.warn(
          `[hub-feedback-intake] dedup skipped: ${(err as Error).message ?? "unknown"}`,
        );
        embeddingLiteral = null;
        dedupMatch = null;
      }
    }

    const insertPayload = {
      workspace_id: auth.workspaceId,
      submitted_by: auth.userId,
      build_item_id: buildItemId,
      feedback_type: finalType,
      body,
      voice_transcript: voiceTranscript,
      voice_audio_url: voiceAudioUrl,
      voice_duration_ms: voiceDurationMs,
      screenshot_url: screenshotUrl,
      priority: triage.priority,
      status: "triaged",
      ai_summary: triage.ai_summary,
      ai_suggested_action: triage.ai_suggested_action,
      submission_context: submissionContext ?? {},
      embedding: embeddingLiteral,
    };

    const { data: inserted, error: insertErr } = await auth.supabase
      .from("hub_feedback")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr || !inserted) {
      throw new Error(`insert failed: ${insertErr?.message ?? "unknown"}`);
    }

    // ── Write the dedup link + event via service role ───────────────────
    //
    // hub_feedback_links RLS restricts inserts to service role / internal
    // admin. Stakeholder JWTs can't write here, so we create a short-lived
    // service client just for this edge. The row.ID we just got back is
    // always the *duplicate* (newer submission), the matched row is the
    // *primary* (older, already-triaged).
    if (dedupMatch) {
      try {
        await writeDedupLink({
          primaryId: dedupMatch.feedback_id,
          duplicateId: inserted.id as string,
          workspaceId: auth.workspaceId,
          similarity: dedupMatch.similarity,
          newSubmitterId: auth.userId,
        });
      } catch (err) {
        // The row is already in. A missing link is recoverable later
        // (admins can hand-link) but should never abort the intake.
        console.warn(
          `[hub-feedback-intake] dedup link write failed: ${(err as Error).message ?? "unknown"}`,
        );
      }
    }

    // High-priority items page the ops inbox. Zero-blocking — skipped
    // silently when RESEND_API_KEY isn't set (local dev / CI).
    if (triage.priority === "high") {
      const opsEmail = Deno.env.get("HUB_OPS_EMAIL");
      if (opsEmail) {
        await sendResendEmail({
          to: opsEmail,
          subject: `[hub] ${finalType.toUpperCase()} · ${truncate(triage.ai_summary, 72)}`,
          text: [
            `Audience: ${auth.audience}`,
            `Role: ${auth.role}${auth.subrole ? ` (${auth.subrole})` : ""}`,
            `Type: ${finalType}`,
            `Priority: high`,
            "",
            `Summary: ${triage.ai_summary}`,
            `Suggested action: ${triage.ai_suggested_action}`,
            "",
            "Body:",
            body,
          ].join("\n"),
        }).catch(() => undefined);
      }
    }

    return safeJsonOk(
      {
        feedback: inserted,
        triage_model: TRIAGE_MODEL,
        elapsed_ms: Date.now() - startMs,
        linked_to: dedupMatch
          ? {
              feedback_id: dedupMatch.feedback_id,
              // Guard: match_hub_feedback_dedup can legally return null on a
              // near-zero cosine; toFixed(3) on null throws and the whole
              // intake 500s even though the insert already landed.
              similarity:
                typeof dedupMatch.similarity === "number"
                  ? Number(dedupMatch.similarity.toFixed(3))
                  : null,
              ai_summary: dedupMatch.ai_summary,
            }
          : null,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-feedback-intake" });
    console.error("[hub-feedback-intake]", err);
    return safeJsonError("Internal error", 500, origin);
  }
});

/**
 * Validate + clamp the client-supplied submission context. We allow-list
 * fields so a malicious client can't smuggle arbitrary jsonb into the DB
 * column. Unknown keys are dropped.
 */
function sanitizeSubmissionContext(raw: unknown): SubmissionContext | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: SubmissionContext = {};
  if (typeof src.path === "string") out.path = src.path.slice(0, 400);
  if (typeof src.title === "string") out.title = src.title.slice(0, 240);
  if (typeof src.build_item_id === "string" && src.build_item_id.length === 36) {
    out.build_item_id = src.build_item_id;
  } else if (src.build_item_id === null) {
    out.build_item_id = null;
  }
  if (src.screen && typeof src.screen === "object") {
    const s = src.screen as Record<string, unknown>;
    const w = typeof s.w === "number" && isFinite(s.w) ? Math.max(0, Math.min(99999, Math.round(s.w))) : undefined;
    const h = typeof s.h === "number" && isFinite(s.h) ? Math.max(0, Math.min(99999, Math.round(s.h))) : undefined;
    if (w !== undefined && h !== undefined) out.screen = { w, h };
  }
  if (typeof src.dark_mode === "boolean") out.dark_mode = src.dark_mode;
  if (typeof src.ua_short === "string") out.ua_short = src.ua_short.slice(0, 120);
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * Shape returned by match_hub_feedback_dedup RPC. Only the fields we
 * consume here are typed; the RPC returns a couple more we ignore.
 */
interface DedupMatch {
  feedback_id: string;
  submitted_by: string | null;
  body: string;
  ai_summary: string;
  status: string;
  priority: string;
  similarity: number;
  created_at: string;
}

/**
 * Call match_hub_feedback_dedup to find the nearest in-flight row. Returns
 * the single best match (already threshold-filtered inside the RPC) or null.
 */
async function findDedupMatch(
  supabase: SupabaseClient,
  embeddingLiteral: string,
  workspaceId: string,
): Promise<DedupMatch | null> {
  // Pass p_workspace explicitly. The RPC ignores this for authenticated
  // callers (uses profile.active_workspace_id) — it's the escape hatch
  // for the day intake starts issuing service-role RPCs. Keeps the call
  // site tenant-correct either way.
  const { data, error } = await supabase.rpc("match_hub_feedback_dedup", {
    p_query_embedding: embeddingLiteral,
    p_exclude_id: null,
    p_min_similarity: DEDUP_MIN_SIMILARITY,
    p_max_age_days: DEDUP_MAX_AGE_DAYS,
    p_match_count: 1,
    p_workspace: workspaceId,
  });
  if (error) throw new Error(`match_hub_feedback_dedup: ${error.message}`);
  const rows = (data ?? []) as DedupMatch[];
  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Persist the dedup edge as (primary, duplicate) with service-role
 * writes, then emit a timeline event on the primary so both submitters
 * see the "+1 from Angela" signal in their inbox.
 *
 * We use a short-lived service-role client because hub_feedback_links
 * RLS excludes stakeholders from writing (by design — we don't want a
 * compromised JWT to merge cards). The JWT that reached us is still
 * the user's; we only elevate for these two writes.
 */
async function writeDedupLink(params: {
  primaryId: string;
  duplicateId: string;
  workspaceId: string;
  similarity: number;
  newSubmitterId: string;
}): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("dedup link: SUPABASE env missing");
  }
  const service: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotent insert — the (primary_id, duplicate_id) pair is the PK.
  // `upsert` with onConflict lets a retry not blow up.
  const { error: linkErr } = await service
    .from("hub_feedback_links")
    .upsert(
      {
        primary_id: params.primaryId,
        duplicate_id: params.duplicateId,
        workspace_id: params.workspaceId,
        similarity: params.similarity,
        link_reason: "semantic_dup",
      },
      { onConflict: "primary_id,duplicate_id" },
    );
  if (linkErr) throw new Error(`hub_feedback_links insert: ${linkErr.message}`);

  // Emit a timeline event on the primary. Payload carries the duplicate
  // row id + the new submitter so the admin inbox can render
  // "Angela also reported this" without a second fetch.
  const { error: evErr } = await service.from("hub_feedback_events").insert({
    feedback_id: params.primaryId,
    workspace_id: params.workspaceId,
    event_type: "duplicate_linked",
    actor_id: params.newSubmitterId,
    actor_role: "submitter",
    payload: {
      duplicate_id: params.duplicateId,
      similarity: params.similarity,
      new_submitter_id: params.newSubmitterId,
    },
  });
  if (evErr) throw new Error(`hub_feedback_events insert: ${evErr.message}`);
}

function normalizeType(raw: unknown): FeedbackType | null {
  if (raw === "bug" || raw === "suggestion" || raw === "question" || raw === "approval" || raw === "concern") {
    return raw;
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

async function triageWithClaude(params: {
  apiKey: string;
  body: string;
  providedType: FeedbackType | null;
  voiceTranscript: string | null;
  submissionContext: SubmissionContext | null;
  audience: "internal" | "stakeholder";
  subrole: string | null;
}): Promise<TriageResult> {
  const ctx = params.submissionContext;
  const contextLines: string[] = [];
  if (ctx) {
    if (typeof ctx.path === "string") contextLines.push(`Submitted from path: ${ctx.path}`);
    if (typeof ctx.title === "string") contextLines.push(`Page title: ${ctx.title}`);
    if (typeof ctx.ua_short === "string") contextLines.push(`Device: ${ctx.ua_short}`);
    if (ctx.dark_mode === true) contextLines.push("Dark mode: on");
  }

  const userMessage = [
    `Audience: ${params.audience}${params.subrole ? ` (${params.subrole})` : ""}`,
    params.providedType ? `Submitter-picked type: ${params.providedType}` : "Submitter did not pick a type.",
    ...contextLines,
    params.voiceTranscript ? `Voice transcript: ${params.voiceTranscript}` : null,
    "",
    "Feedback body:",
    params.body,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TRIAGE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: TRIAGE_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic triage ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const textPart = ((data?.content ?? []) as Array<{ type: string; text?: string }>).find(
    (c) => c.type === "text",
  );
  const raw = textPart?.text?.trim() ?? "";

  return parseTriage(raw, params.providedType);
}

function parseTriage(raw: string, fallbackType: FeedbackType | null): TriageResult {
  // Strip ``` fences if the model added them.
  const stripped = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    // Fall through to defaults below.
  }

  const type: FeedbackType = isFeedbackType(parsed.feedback_type)
    ? parsed.feedback_type
    : fallbackType ?? "suggestion";
  const priority: Priority = isPriority(parsed.priority) ? parsed.priority : "medium";
  const summary = typeof parsed.ai_summary === "string"
    ? parsed.ai_summary.trim().slice(0, 280)
    : "Needs review";
  const action = typeof parsed.ai_suggested_action === "string"
    ? parsed.ai_suggested_action.trim().slice(0, 280)
    : "Review and classify";
  const confidence: "high" | "low" = parsed.confidence === "low" ? "low" : "high";

  return {
    feedback_type: type,
    priority,
    ai_summary: summary,
    ai_suggested_action: action,
    confidence,
  };
}

function isFeedbackType(v: unknown): v is FeedbackType {
  return v === "bug" || v === "suggestion" || v === "question" || v === "approval" || v === "concern";
}

function isPriority(v: unknown): v is Priority {
  return v === "low" || v === "medium" || v === "high";
}
