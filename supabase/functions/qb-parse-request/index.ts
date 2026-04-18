/**
 * qb-parse-request — Natural Language → Structured Quote Intent
 *
 * Accepts a free-text prompt from a sales rep (typed or voice-transcribed)
 * and returns:
 *   - A structured parse: brand, model, customer type, delivery state, etc.
 *   - Top fuzzy-matched equipment models from the catalog (via qb_search_equipment_fuzzy RPC)
 *   - Per-field confidence scores
 *
 * This function does NOT compute scenarios or call qb-calculate. It is the
 * first stage of the two-stage pipeline:
 *   qb-parse-request → qb-ai-scenarios
 *
 * qb-ai-scenarios calls this internally or accepts an already-parsed result,
 * so the UI only needs one call (qb-ai-scenarios).
 *
 * Auth: requireServiceUser() — valid user JWT, all roles.
 *
 * POST body:
 *   { "prompt": string, "promptSource"?: "text" | "voice" }
 *
 * Response:
 *   {
 *     "parsedIntent": { brand?, model?, customerType, deliveryState?, budgetCents?, ... },
 *     "resolvedBrandId"?: string,
 *     "resolvedModelId"?: string,
 *     "modelCandidates": [...],
 *     "confidence": { brand: float, model: float, state: float, customerType: float },
 *     "logId": string
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.36.3";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ParsedIntent {
  /** Recognized brand keyword(s), e.g. "ASV", "Yanmar" */
  brandKeyword: string | null;
  /** Model keyword(s) or family, e.g. "RT-135", "compact track loader" */
  modelKeyword: string | null;
  /** 'standard' | 'gmu' | null */
  customerType: "standard" | "gmu" | null;
  /** Two-letter US state code, e.g. "FL" */
  deliveryState: string | null;
  /** Approximate budget in cents, or null */
  budgetCents: number | null;
  /** Monthly payment target in cents, or null */
  monthlyBudgetCents: number | null;
  /** Financing preference: 'cash' | 'financing' | 'open' | null */
  financingPref: "cash" | "financing" | "open" | null;
  /** Attachment keywords mentioned, e.g. ["mulcher", "bucket"] */
  attachmentKeywords: string[];
  /** Urgency: 'immediate' | 'weeks' | 'months' | 'unknown' */
  urgency: "immediate" | "weeks" | "months" | "unknown";
  /** Raw summary Claude generated (human-readable) */
  summary: string;
}

export interface ModelCandidate {
  id: string;
  brandId: string;
  brandCode: string;
  brandName: string;
  modelCode: string;
  family: string | null;
  nameDisplay: string;
  listPriceCents: number;
  modelYear: number | null;
  similarity: number;
}

export interface ParseRequestResponse {
  parsedIntent: ParsedIntent;
  resolvedBrandId: string | null;
  resolvedModelId: string | null;
  modelCandidates: ModelCandidate[];
  confidence: {
    brand: number;
    model: number;
    state: number;
    customerType: number;
  };
  logId: string | null;
}

// ── Claude prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the equipment intake intelligence for QEP USA, an authorized heavy equipment dealership.
Your job is to extract structured deal intent from a sales rep's description of a customer opportunity.

QEP sells and rents: ASV compact track loaders, Yanmar compact equipment, Develon excavators/loaders,
and forestry equipment (Barko, Bandit, Prinoth, etc.).

Extract the following fields and return ONLY valid JSON — no prose, no markdown fences:

{
  "brandKeyword": string | null,       // e.g. "ASV", "Yanmar", "Develon" — null if unspecified
  "modelKeyword": string | null,       // e.g. "RT-135", "CT30", "compact track loader", null if unknown
  "customerType": "standard" | "gmu" | null,  // gmu = government / municipality
  "deliveryState": string | null,      // 2-letter US state code, e.g. "FL", "GA"
  "budgetCents": number | null,        // total budget in cents — $100k = 10000000
  "monthlyBudgetCents": number | null, // monthly payment target in cents
  "financingPref": "cash" | "financing" | "open" | null,
  "attachmentKeywords": string[],      // ["mulcher", "bucket", "thumb"] — empty array if none
  "urgency": "immediate" | "weeks" | "months" | "unknown",
  "summary": string                    // one sentence human-readable summary of the opportunity
}

Rules:
- budgetCents: convert dollar amounts to cents. "$100k" = 10000000. Null if not mentioned.
- monthlyBudgetCents: "$2,500/month" = 250000. Null if not mentioned.
- customerType: "gmu" if mentions government, municipality, county, state agency, military.
- deliveryState: infer from city/county mentions ("Lake City" → "FL", "Ocala" → "FL").
- financingPref: "cash" if mentions cash/paying cash/own financing. "financing" if asks for payments/financing.
- urgency: "immediate" if mentions ASAP/this week/urgent. "weeks" if next few weeks. "months" if next quarter+.
- attachmentKeywords: normalize to lowercase singular form: "mulching attachment" → "mulcher".
- Return null for fields you cannot determine with reasonable confidence.
- Return ONLY JSON. No prose before or after.`;

// ── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const startMs = Date.now();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireServiceUser(req.headers.get("authorization"), origin);
  if (!auth.ok) return auth.response;

  // ── Parse body ────────────────────────────────────────────────────────────
  let prompt: string;
  let promptSource: "text" | "voice" = "text";
  try {
    const body = await req.json() as { prompt?: unknown; promptSource?: unknown };
    if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length < 3) {
      return safeJsonError("prompt must be a non-empty string (min 3 chars)", 400, origin);
    }
    prompt = body.prompt.trim();
    if (body.promptSource === "voice") promptSource = "voice";
  } catch {
    return safeJsonError("Request body must be valid JSON", 400, origin);
  }

  // ── Service role client for telemetry writes ──────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svcClient   = createClient(supabaseUrl, serviceKey);

  let logId: string | null = null;
  let parsedIntent: ParsedIntent | null = null;
  let parseError: string | null = null;

  try {
    // ── 1. Claude parse ─────────────────────────────────────────────────────
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const claudeRes = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = claudeRes.content[0].type === "text" ? claudeRes.content[0].text : "";

    // Attempt JSON parse — strip any accidental markdown fences
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsedIntent = JSON.parse(cleaned) as ParsedIntent;

  } catch (err) {
    parseError = err instanceof Error ? err.message : "Claude parse failed";
    // Fall through to log the error and return a graceful response
  }

  // ── 2. Brand resolution ───────────────────────────────────────────────────
  let resolvedBrandId: string | null = null;
  let resolvedModelId: string | null = null;
  let modelCandidates: ModelCandidate[] = [];
  const confidence = { brand: 0, model: 0, state: 0, customerType: 0 };

  if (parsedIntent && !parseError) {
    // Resolve brand by code or name (case-insensitive)
    if (parsedIntent.brandKeyword) {
      const brandQuery = parsedIntent.brandKeyword.toUpperCase();
      const { data: brandRows } = await auth.supabase
        .from("qb_brands")
        .select("id, code, name")
        .or(`code.eq.${brandQuery},name.ilike.${parsedIntent.brandKeyword}`)
        .limit(1)
        .maybeSingle();

      if (brandRows?.id) {
        resolvedBrandId = brandRows.id as string;
        confidence.brand = 0.90;
      } else {
        confidence.brand = 0.20; // keyword present but no catalog match
      }
    }

    // ── 3. Fuzzy model search ───────────────────────────────────────────────
    if (parsedIntent.modelKeyword) {
      const { data: fuzzyRows, error: fuzzyErr } = await auth.supabase
        .rpc("qb_search_equipment_fuzzy", {
          p_query:    parsedIntent.modelKeyword,
          p_brand_id: resolvedBrandId ?? undefined,
          p_limit:    5,
        });

      if (!fuzzyErr && fuzzyRows?.length) {
        modelCandidates = (fuzzyRows as Array<Record<string, unknown>>).map((r) => ({
          id:              r.id as string,
          brandId:         r.brand_id as string,
          brandCode:       r.brand_code as string,
          brandName:       r.brand_name as string,
          modelCode:       r.model_code as string,
          family:          r.family as string | null,
          nameDisplay:     r.name_display as string,
          listPriceCents:  r.list_price_cents as number,
          modelYear:       r.model_year as number | null,
          similarity:      r.similarity as number,
        }));

        // Auto-resolve if top match is high-confidence
        const top = modelCandidates[0];
        if (top.similarity >= 0.65) {
          resolvedModelId = top.id;
          confidence.model = Math.min(top.similarity, 0.95);
          // Back-fill brand if model resolved it
          if (!resolvedBrandId) {
            resolvedBrandId = top.brandId;
            confidence.brand = 0.85;
          }
        } else if (top.similarity >= 0.30) {
          confidence.model = top.similarity * 0.8; // plausible but not locked
        }
      }
    }

    // Confidence for extracted fields
    confidence.state = parsedIntent.deliveryState ? 0.80 : 0;
    confidence.customerType = parsedIntent.customerType ? 0.85 : 0.40;
  }

  // ── 4. Write telemetry log (service role — bypasses RLS) ──────────────────
  const latencyMs = Date.now() - startMs;
  try {
    const { data: logRow } = await svcClient
      .from("qb_ai_request_log")
      .insert({
        user_id:           auth.userId,
        raw_prompt:        prompt,
        resolved_brand_id: resolvedBrandId,
        resolved_model_id: resolvedModelId,
        model_candidates:  modelCandidates.length ? modelCandidates : null,
        confidence,
        delivery_state:    parsedIntent?.deliveryState ?? null,
        customer_type:     parsedIntent?.customerType ?? null,
        latency_ms:        latencyMs,
        error:             parseError,
        prompt_source:     promptSource,
      })
      .select("id")
      .single();
    logId = (logRow as { id: string } | null)?.id ?? null;
  } catch {
    // Telemetry failure must never break the user-facing response
  }

  // ── 5. Return ─────────────────────────────────────────────────────────────
  if (parseError || !parsedIntent) {
    return safeJsonError(
      `Failed to parse your description: ${parseError ?? "unknown error"}. Try rephrasing.`,
      422,
      origin,
    );
  }

  const response: ParseRequestResponse = {
    parsedIntent,
    resolvedBrandId,
    resolvedModelId,
    modelCandidates,
    confidence,
    logId,
  };

  return safeJsonOk(response, origin);
});
