/**
 * qb-copilot-turn — Deal Copilot per-quote turn orchestrator (Slice 21).
 *
 * The Deal Assistant (Slice 05) is a cold-start oracle — a rep describes a
 * deal from scratch and gets back scenarios. This function promotes that
 * into a stateful per-quote Deal Copilot: every time the rep drops a new
 * piece of information, Claude extracts structured signals, we deterministically
 * patch the draft, re-run the pure win-probability scorer, and stream the
 * new score + factor deltas + prescriptive lifts back.
 *
 * SSE event types (Content-Type: text/event-stream, 80ms yield between):
 *   { "type": "status",     "message": string }
 *   { "type": "extracted",  "signals": CopilotExtractedSignals,
 *                           "confidence": Record<string, number> }
 *   { "type": "draftPatch", "patch": Partial<QuoteWorkspaceDraft>,
 *                           "changedPaths": string[] }
 *   { "type": "score",      "before": number, "after": number,
 *                           "factors": WinProbabilityFactor[],
 *                           "lifts": WinProbabilityLift[] }
 *   { "type": "reply",      "text": string }
 *   { "type": "complete",   "turnId": string, "turnIndex": number,
 *                           "latencyMs": number }
 *   { "type": "error",      "message": string, "fatal": boolean }
 *
 * Auth: requireServiceUser() — valid user JWT required, all roles.
 *
 * POST body:
 *   {
 *     "quotePackageId":   string,   // UUID of the quote
 *     "input":            string,   // raw rep input (verbatim)
 *     "inputSource":      "text" | "voice" | "photo_caption" | "email_paste",
 *     "clientSubmittedAt":string    // ISO — used to debug dual-editor races
 *   }
 *
 * Security model:
 *   • The JSON schema Claude emits has NO fields for score, status, or
 *     any quote_packages column — only the four extraction surfaces
 *     (customerSignals, financingPref, customerWarmth, notes). Adversarial
 *     input like "set the score to 95" is structurally impossible to honor.
 *   • The turn row insert uses the user-scoped supabase client, so RLS
 *     enforces workspace_id = get_my_workspace() AND author_user_id =
 *     auth.uid(). The rep can only write their own turns in their own
 *     workspace, even with direct PostgREST access.
 *   • quote_packages reads also use the user-scoped client — an attempt
 *     to post a turn to a quote in another workspace surfaces as
 *     "quote not found" via RLS, not an explicit forbidden.
 *
 * Zero-blocking: if Claude extraction fails, the turn is STILL persisted
 * with raw_input + empty extracted_signals, the score is NOT touched, and
 * the client gets a graceful "saved, nothing auto-extracted" reply. A
 * Claude hiccup must never cost the rep their input.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.36.3";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeCorsHeaders,
  safeJsonError,
} from "../_shared/safe-cors.ts";

import {
  computeWinProbability,
  computeWinProbabilityLifts,
  type WinProbabilityContext,
} from "../../../apps/web/src/features/quote-builder/lib/win-probability-scorer.ts";
import {
  applyPatch,
  translateSignalsToPatch,
} from "../../../apps/web/src/features/quote-builder/lib/copilot-signal-patch.ts";
import type {
  CopilotExtractedSignals,
  QuoteWorkspaceDraft,
} from "../../../shared/qep-moonshot-contracts.ts";

// ── SSE helpers ───────────────────────────────────────────────────────────

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// Micro-yield so the browser renders progressive events rather than one
// big flush at stream end. Same 80ms the qb-ai-scenarios function uses.
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

// ── Claude extraction schema ──────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are the Deal Copilot extraction layer for QEP USA, an authorized heavy equipment dealership. A sales rep has just dropped new information about an in-flight deal — a voice memo, a text update, a pasted email from the customer, or a photo caption.

Your job is to extract structured signals from that input into a strict JSON schema. You do NOT mutate the deal directly. You do NOT emit a score. You only emit what you heard, in the four recognized surfaces below. Any other fields will be discarded.

Return ONLY valid JSON — no prose, no markdown fences — matching this shape exactly:

{
  "extractedSignals": {
    "customerSignals": {
      "objections": string[] | undefined,
      "timelinePressure": "immediate" | "weeks" | "months" | null | undefined,
      "competitorMentions": string[] | undefined
    } | undefined,
    "financingPref": "cash" | "financing" | "open" | null | undefined,
    "customerWarmth": "warm" | "cool" | "dormant" | "new" | null | undefined,
    "notes": string[] | undefined
  },
  "confidence": {
    "objections": number,            // 0..1, omit if no extraction
    "timelinePressure": number,
    "competitorMentions": number,
    "financingPref": number,
    "customerWarmth": number
  },
  "reply": string                    // one-sentence acknowledgment to the rep
}

Rules (read each carefully):
  1. "objections" — concerns the CUSTOMER has raised, each as a short phrase ("price too high", "needs CEO approval"). Do NOT log the rep's own doubts. Omit the field if the input contains no customer objections.
  2. "timelinePressure" — "immediate" for <2 weeks, "weeks" for 2–8 weeks, "months" for >8 weeks, null if the rep explicitly says no pressure / unknown. Omit if not mentioned.
  3. "competitorMentions" — names of rival dealers or rival machines the customer is considering (e.g. "United Rentals", "JCB 85Z"). Omit if none mentioned. Do NOT infer competitors the customer didn't name.
  4. "financingPref" — "cash", "financing", "open", null, or omit. Only set when the customer has committed to a path.
  5. "customerWarmth" — only re-rate when the input contains clear relational cues ("he was frustrated" → cool, "great conversation, he's excited" → warm). Default to omitting.
  6. "notes" — free-text observations Claude wants preserved that DON'T map to the fields above. Used for audit, not scoring.
  7. "reply" — a one-sentence acknowledgment to the rep ("Got it — marked Dave as cash-preferred."). Keep under 140 chars. Plain text, no markdown.
  8. Confidence values are 0.0–1.0. Emit one for each field you extracted; omit for fields you skipped.
  9. If the input is ambiguous or empty, return an empty extractedSignals object and a reply like "Saved. Nothing new to extract from that one." Never fabricate signals.
 10. Return ONLY JSON. No prose before or after. No code fences.`;

interface ClaudeExtractionResult {
  extractedSignals: CopilotExtractedSignals;
  confidence: Record<string, number>;
  reply: string;
}

function parseClaudeJson(rawText: string): ClaudeExtractionResult | null {
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    // Narrow the shape defensively — Claude might still emit unexpected
    // top-level keys. We only accept the three we expect.
    if (typeof parsed !== "object" || parsed === null) return null;
    const extractedSignals = (parsed.extractedSignals ?? {}) as CopilotExtractedSignals;
    const confidence = (parsed.confidence ?? {}) as Record<string, number>;
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    return { extractedSignals, confidence, reply };
  } catch {
    return null;
  }
}

// ── Draft loader ──────────────────────────────────────────────────────────
//
// We rebuild a *minimal* QuoteWorkspaceDraft from the live quote_packages
// row. Only the fields the scorer actually reads are populated — the
// scorer is robust to missing fields and omits factors when their inputs
// are absent. Keeping this slice narrow avoids coupling the edge function
// to every new quote_packages column that lands in future slices.
//
// Source-of-truth per field:
//   • customerSignals              → copilot_latest_signals (updated by
//                                     the turn trigger) merged with what
//                                     CRM-picked signals we can observe
//   • customerWarmth / financingPref → copilot_latest_signals (the copilot
//                                       is the canonical writer)
//   • tradeAllowance               → quote_packages.trade_allowance
//                                     (numeric dollars)
//   • equipment (presence-only)    → quote_packages.equipment[] length
//   • recommendation (presence)    → null on the server path; the web
//                                     scorer layer reapplies this when
//                                     the rep re-opens the quote

interface QuotePackageSlice {
  id: string;
  workspace_id: string;
  win_probability_score: number | null;
  win_probability_snapshot: Record<string, unknown> | null;
  copilot_latest_signals: Record<string, unknown> | null;
  trade_allowance: number | null;
  equipment: unknown[] | null;
}

/** Copilot-authored fields that piggyback on the jsonb denorm column. */
interface CopilotLatestSignalsShape {
  objections?: string[];
  competitorMentions?: string[];
  timelinePressure?: "immediate" | "weeks" | "months" | null;
  financingPref?: "cash" | "financing" | "open" | null;
  customerWarmth?: "warm" | "cool" | "dormant" | "new" | null;
}

function seedDraftFromQuote(qp: QuotePackageSlice): Partial<QuoteWorkspaceDraft> {
  const latest = (qp.copilot_latest_signals ?? {}) as CopilotLatestSignalsShape;

  const hasCopilotSignals =
    latest.objections !== undefined ||
    latest.competitorMentions !== undefined ||
    latest.timelinePressure !== undefined;

  const customerSignals: QuoteWorkspaceDraft["customerSignals"] = hasCopilotSignals
    ? {
        // CRM-sourced numerics default to zeros on the server path. The
        // scorer only surfaces factors for non-null lastContactDaysAgo
        // and treats zero past-quote-counts as the "none" bucket, which
        // is the safest default.
        openDeals: 0,
        openDealValueCents: 0,
        lastContactDaysAgo: null,
        pastQuoteCount: 0,
        pastQuoteValueCents: 0,
        ...(latest.objections !== undefined ? { objections: latest.objections } : {}),
        ...(latest.competitorMentions !== undefined
          ? { competitorMentions: latest.competitorMentions }
          : {}),
        ...(latest.timelinePressure !== undefined
          ? { timelinePressure: latest.timelinePressure }
          : {}),
      }
    : null;

  const equipmentArray = Array.isArray(qp.equipment) ? qp.equipment : [];

  return {
    customerSignals,
    customerWarmth: latest.customerWarmth ?? null,
    financingPref: latest.financingPref ?? null,
    tradeAllowance: typeof qp.trade_allowance === "number" ? qp.trade_allowance : 0,
    // The scorer reads `equipment.length`; we only need truthiness, so we
    // pass placeholder entries sized to match the real array length.
    equipment: equipmentArray.map(() => ({
      kind: "equipment" as const,
      title: "placeholder",
      quantity: 1,
      unitPrice: 0,
    })),
    attachments: [],
    recommendation: null,
    voiceSummary: null,
    entryMode: "manual",
    branchSlug: "",
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 0,
    selectedFinanceScenario: null,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const startMs = Date.now();

  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireServiceUser(req.headers.get("authorization"), origin);
  if (!auth.ok) return auth.response;

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: {
    quotePackageId?: string;
    input?: string;
    inputSource?: string;
    clientSubmittedAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Request body must be valid JSON", 400, origin);
  }

  const quotePackageId = typeof body.quotePackageId === "string" ? body.quotePackageId : "";
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const inputSource = body.inputSource as
    | "text"
    | "voice"
    | "photo_caption"
    | "email_paste"
    | undefined;

  if (!quotePackageId) {
    return safeJsonError("quotePackageId is required", 400, origin);
  }
  if (input.length < 2) {
    return safeJsonError("input is required (min 2 chars)", 400, origin);
  }
  if (
    inputSource !== "text" &&
    inputSource !== "voice" &&
    inputSource !== "photo_caption" &&
    inputSource !== "email_paste"
  ) {
    return safeJsonError("inputSource must be text|voice|photo_caption|email_paste", 400, origin);
  }

  // Service role client for telemetry writes + any server-authoritative
  // updates that shouldn't be gated by RLS (score snapshot update).
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svcClient = createClient(supabaseUrl, serviceKey);

  // ── Set up SSE stream ───────────────────────────────────────────────────
  const corsHeaders = safeCorsHeaders(origin);
  const sseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(sseEvent(data));
        } catch {
          /* client disconnected */
        }
      };

      try {
        // ── Stage 1: Load the quote ─────────────────────────────────────────
        emit({ type: "status", message: "Loading quote…" });

        const { data: qpRow, error: qpErr } = await auth.supabase
          .from("quote_packages")
          .select(
            "id, workspace_id, win_probability_score, win_probability_snapshot, copilot_latest_signals, trade_allowance, equipment",
          )
          .eq("id", quotePackageId)
          .maybeSingle();

        if (qpErr || !qpRow) {
          // RLS miss or genuine not-found — same externally. Do NOT leak
          // which one to avoid a workspace-probing oracle.
          emit({ type: "error", fatal: true, message: "Quote not found or inaccessible." });
          emit({
            type: "complete",
            turnId: null,
            turnIndex: null,
            latencyMs: Date.now() - startMs,
          });
          controller.close();
          return;
        }

        const quote = qpRow as unknown as QuotePackageSlice;
        const scoreBefore = quote.win_probability_score ?? null;

        // ── Stage 2: Load the last 5 turns for conversational context ──────
        const { data: priorTurns } = await auth.supabase
          .from("qb_quote_copilot_turns")
          .select("turn_index, raw_input, extracted_signals, copilot_reply, created_at")
          .eq("quote_package_id", quotePackageId)
          .is("deleted_at", null)
          .order("turn_index", { ascending: false })
          .limit(5);

        const contextTurns = (priorTurns ?? []).reverse();
        const nextTurnIndex =
          (priorTurns && priorTurns.length > 0 ? (priorTurns[0]!.turn_index as number) : 0) + 1;

        // ── Stage 3: Call Claude for signal extraction ──────────────────────
        emit({ type: "status", message: "Extracting signals…" });

        const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!anthropicKey) {
          throw new Error("ANTHROPIC_API_KEY not configured on this environment.");
        }
        const anthropic = new Anthropic({ apiKey: anthropicKey });

        const conversationalContext = contextTurns
          .map(
            (t) =>
              `Turn ${t.turn_index}: ${t.raw_input}\n` +
              (t.copilot_reply ? `Copilot reply: ${t.copilot_reply}\n` : ""),
          )
          .join("\n");

        let claudeExtraction: ClaudeExtractionResult | null = null;
        let claudeErrorDetail: string | null = null;
        let aiLogId: string | null = null;

        try {
          const claudeRes = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            system: EXTRACTION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content:
                  (conversationalContext.length > 0
                    ? `Prior turns on this quote:\n${conversationalContext}\n\n`
                    : "") + `New turn from the rep (${inputSource}):\n${input}`,
              },
            ],
          });

          const rawText =
            claudeRes.content[0] && claudeRes.content[0].type === "text"
              ? claudeRes.content[0].text
              : "{}";
          claudeExtraction = parseClaudeJson(rawText);
          if (!claudeExtraction) {
            claudeErrorDetail = "Claude returned unparseable JSON.";
          }
        } catch (err) {
          claudeErrorDetail = err instanceof Error ? err.message : "Claude call failed.";
        }

        // Log telemetry. Map the broader copilot inputSource to the log
        // table's narrower prompt_source enum (text|voice only).
        try {
          const logRow = await svcClient
            .from("qb_ai_request_log")
            .insert({
              workspace_id: auth.workspaceId,
              user_id: auth.userId,
              raw_prompt: input,
              resolved_brand_id: null,
              resolved_model_id: null,
              model_candidates: null,
              confidence: claudeExtraction?.confidence ?? null,
              delivery_state: null,
              customer_type: null,
              latency_ms: Date.now() - startMs,
              error: claudeErrorDetail,
              prompt_source: inputSource === "voice" ? "voice" : "text",
            })
            .select("id")
            .single();
          aiLogId = (logRow.data as { id: string } | null)?.id ?? null;
        } catch (telemetryErr) {
          console.warn("[qb-copilot-turn] telemetry insert failed:", telemetryErr);
        }

        // ── Stage 4: Translate extracted → patch (deterministic) ────────────
        const extractedSignals: CopilotExtractedSignals =
          claudeExtraction?.extractedSignals ?? {};
        const confidence = claudeExtraction?.confidence ?? {};
        const seedDraft = seedDraftFromQuote(quote);

        const patchResult = translateSignalsToPatch(seedDraft, extractedSignals);

        emit({
          type: "extracted",
          signals: extractedSignals,
          confidence,
        });
        await yieldEventLoop();

        if (!patchResult.isNoOp) {
          emit({
            type: "draftPatch",
            patch: patchResult.patch,
            changedPaths: patchResult.changedPaths,
          });
          await yieldEventLoop();
        }

        // ── Stage 5: Apply patch + re-run scorer ────────────────────────────
        // The edge fn doesn't have margin baseline context — pass null
        // so the margin factor is omitted from the server-side result.
        // The client already handles margin separately via WinProbabilityStrip.
        const scoreCtx: WinProbabilityContext = { marginPct: null };

        let scoreAfter: number | null = null;
        let factorDiff: unknown[] | null = null;
        let liftDiff: unknown[] | null = null;

        if (!patchResult.isNoOp) {
          const nextDraft = applyPatch(seedDraft, patchResult.patch);
          const result = computeWinProbability(nextDraft, scoreCtx);
          const lifts = computeWinProbabilityLifts(nextDraft, scoreCtx);
          scoreAfter = result.score;
          factorDiff = result.factors;
          liftDiff = lifts;

          emit({
            type: "score",
            before: scoreBefore,
            after: scoreAfter,
            factors: result.factors,
            lifts,
          });
          await yieldEventLoop();
        }

        // ── Stage 6: Persist the turn row ───────────────────────────────────
        //
        // Insert via user-scoped client so RLS enforces workspace + author
        // identity. The DB trigger trg_qb_quote_copilot_sync_denorms will
        // auto-update copilot_turn_count + copilot_last_turn_at +
        // copilot_latest_signals. We only explicitly update
        // win_probability_score + win_probability_snapshot below (via
        // service client) because those depend on having re-run the scorer.

        const insertResult = await auth.supabase
          .from("qb_quote_copilot_turns")
          .insert({
            workspace_id: auth.workspaceId,
            quote_package_id: quotePackageId,
            author_user_id: auth.userId,
            turn_index: nextTurnIndex,
            input_source: inputSource,
            raw_input: input,
            transcript: inputSource === "voice" ? input : null,
            extracted_signals: extractedSignals,
            copilot_reply: claudeExtraction?.reply ?? null,
            score_before: scoreBefore,
            score_after: scoreAfter,
            factor_diff: factorDiff,
            lift_diff: liftDiff,
            ai_request_log_id: aiLogId,
          })
          .select("id, turn_index")
          .single();

        if (insertResult.error || !insertResult.data) {
          // Unique-conflict on turn_index means a concurrent writer beat
          // us — client should retry. Any other error is fatal.
          const msg = insertResult.error?.message ?? "Failed to persist turn.";
          const isDup = /duplicate|unique/i.test(msg);
          emit({
            type: "error",
            fatal: !isDup,
            message: isDup
              ? "Another turn landed first — please retry."
              : "Couldn't save this turn. Your input wasn't stored.",
          });
          emit({
            type: "complete",
            turnId: null,
            turnIndex: null,
            latencyMs: Date.now() - startMs,
          });
          controller.close();
          return;
        }

        const turnRow = insertResult.data as { id: string; turn_index: number };

        // ── Stage 7: Persist the new score snapshot (server-authoritative) ──
        // Only when the patch actually moved the score. Empty-extraction
        // turns leave win_probability_* untouched per zero-blocking policy.
        if (scoreAfter !== null && !patchResult.isNoOp) {
          const snapshot = {
            score: scoreAfter,
            factors: factorDiff,
            lifts: liftDiff,
            scoredBy: "qb-copilot-turn",
            scoredAt: new Date().toISOString(),
            turnId: turnRow.id,
          };
          try {
            await svcClient
              .from("quote_packages")
              .update({
                win_probability_score: scoreAfter,
                win_probability_snapshot: snapshot,
              })
              .eq("id", quotePackageId);
          } catch (updErr) {
            // Snapshot update failure is non-fatal — the turn is saved,
            // and the denorm trigger captured copilot_latest_signals.
            // The next client-side scorer run will reconcile.
            console.warn("[qb-copilot-turn] score snapshot update failed:", updErr);
          }
        }

        // ── Stage 8: Stream reply + complete ────────────────────────────────
        emit({
          type: "reply",
          text:
            claudeExtraction?.reply ??
            (patchResult.isNoOp
              ? "Saved. Nothing new to extract from that one."
              : "Saved — the copilot updated the deal."),
        });
        await yieldEventLoop();

        emit({
          type: "complete",
          turnId: turnRow.id,
          turnIndex: turnRow.turn_index,
          latencyMs: Date.now() - startMs,
        });
      } catch (err) {
        const internalMessage =
          err instanceof Error ? err.message : "Unexpected error during copilot turn.";
        console.error("[qb-copilot-turn]", err);
        emit({
          type: "error",
          fatal: true,
          message: "Couldn't process that turn right now. Please try again.",
        });
        emit({
          type: "complete",
          turnId: null,
          turnIndex: null,
          latencyMs: Date.now() - startMs,
        });
        // Intentionally do NOT leak internalMessage to the client.
        void internalMessage;
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: sseHeaders });
});
