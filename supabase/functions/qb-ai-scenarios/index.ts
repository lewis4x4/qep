/**
 * qb-ai-scenarios — AI-Assisted Deal Scenario Generator (Streaming SSE)
 *
 * Entry point for the Slice 05 Conversational Deal Engine. Accepts a
 * free-text prompt (or pre-parsed intent) and streams 2–4 deal scenarios
 * back as Server-Sent Events. Target: first scenario card visible in <10s,
 * full set in <60s.
 *
 * Pipeline:
 *   1. Parse prompt via Claude (qb-parse-request logic, inlined to avoid
 *      an internal HTTP hop and save ~200ms).
 *   2. Resolve brand + model via qb_search_equipment_fuzzy RPC.
 *   3. Fetch brand config + active programs from DB in parallel.
 *   4. Compute equipment cost (deterministic — pricing library).
 *   5. Run program eligibility + buildScenarios (deterministic).
 *   6. Stream each scenario as a Server-Sent Event.
 *
 * SSE event types:
 *   { "type": "status",   "message": string }                 — progress updates
 *   { "type": "resolved", "model": ModelSummary }             — model matched
 *   { "type": "scenario", "scenario": QuoteScenario, "index": number }
 *   { "type": "complete", "totalScenarios": number, "latencyMs": number }
 *   { "type": "error",    "message": string, "fatal": boolean }
 *
 * Auth: requireServiceUser() — valid user JWT, all roles.
 *
 * POST body:
 *   {
 *     "prompt": string,
 *     "promptSource"?: "text" | "voice",
 *     // Optional overrides (skip parse step when already resolved):
 *     "modelId"?: string,    // UUID — qb_equipment_models.id
 *     "brandId"?: string,    // UUID — qb_brands.id
 *     "deliveryState"?: string,
 *     "customerType"?: "standard" | "gmu"
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.36.3";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeCorsHeaders } from "../_shared/safe-cors.ts";
import { buildScenarios } from "../../../apps/web/src/lib/programs/scenarios.ts";
import { recommendPrograms } from "../../../apps/web/src/lib/programs/recommender.ts";
import type { QuoteContext as ProgramQuoteContext } from "../../../apps/web/src/lib/programs/types.ts";

// ── Claude intent parse (same system prompt as qb-parse-request) ───────────────

const PARSE_SYSTEM_PROMPT = `You are the equipment intake intelligence for QEP USA, an authorized heavy equipment dealership.
Your job is to extract structured deal intent from a sales rep's description of a customer opportunity.

QEP sells and rents: ASV compact track loaders, Yanmar compact equipment, Develon excavators/loaders,
and forestry equipment (Barko, Bandit, Prinoth, etc.).

Extract the following fields and return ONLY valid JSON — no prose, no markdown fences:

{
  "brandKeyword": string | null,
  "modelKeyword": string | null,
  "customerType": "standard" | "gmu" | null,
  "deliveryState": string | null,
  "budgetCents": number | null,
  "monthlyBudgetCents": number | null,
  "financingPref": "cash" | "financing" | "open" | null,
  "attachmentKeywords": string[],
  "urgency": "immediate" | "weeks" | "months" | "unknown",
  "summary": string
}

Rules:
- budgetCents: convert dollar amounts to cents. "$100k" = 10000000.
- customerType: "gmu" if mentions government, municipality, county, state agency, military.
- deliveryState: infer from city/county. "Lake City" → "FL". "Ocala" → "FL".
- financingPref: "cash" if mentions paying cash. "financing" if asks for payments.
- Return null for fields you cannot determine. Return ONLY JSON.`;

// ── SSE helpers ────────────────────────────────────────────────────────────────

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Constants ──────────────────────────────────────────────────────────────────

// Default delivery state when not inferable — QEP's primary market is FL.
const DEFAULT_DELIVERY_STATE = "FL";
// Freight cents fallback when no zone is configured (prevents hard failure on demo models)
const FALLBACK_FREIGHT_CENTS = 194200; // ASV FL rate from seed data
// Hardcoded FL tax rate (same stub as qb-calculate Slice 02)
const FL_TAX_RATE_PCT = 0.07;

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
  let body: {
    prompt?: string;
    promptSource?: "text" | "voice";
    modelId?: string;
    brandId?: string;
    deliveryState?: string;
    customerType?: "standard" | "gmu";
  };
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Request body must be valid JSON", 400, origin);
  }

  if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length < 3) {
    return safeJsonError("prompt is required (min 3 chars)", 400, origin);
  }
  const prompt = body.prompt.trim();
  const promptSource = body.promptSource === "voice" ? "voice" : "text";

  // Service role client for telemetry writes (bypasses RLS)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svcClient   = createClient(supabaseUrl, serviceKey);

  // ── Set up SSE stream ─────────────────────────────────────────────────────
  const corsHeaders = safeCorsHeaders(origin);
  const sseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        try { controller.enqueue(sseEvent(data)); } catch { /* client disconnected */ }
      };

      let logId: string | null = null;
      let resolvedModelId  = body.modelId    ?? null;
      let resolvedBrandId  = body.brandId    ?? null;
      let deliveryState    = body.deliveryState?.toUpperCase() ?? null;
      let customerType: "standard" | "gmu" = body.customerType ?? "standard";

      try {
        // ── Stage 1: Parse intent ───────────────────────────────────────────
        emit({ type: "status", message: "Reading your deal description…" });

        const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured on this environment.");

        const anthropic = new Anthropic({ apiKey: anthropicKey });

        const claudeRes = await anthropic.messages.create({
          model:      "claude-sonnet-4-6",
          max_tokens: 512,
          system:     PARSE_SYSTEM_PROMPT,
          messages:   [{ role: "user", content: prompt }],
        });

        const rawText = claudeRes.content[0].type === "text" ? claudeRes.content[0].text : "{}";
        const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed  = JSON.parse(cleaned) as {
          brandKeyword:      string | null;
          modelKeyword:      string | null;
          customerType:      "standard" | "gmu" | null;
          deliveryState:     string | null;
          budgetCents:       number | null;
          monthlyBudgetCents:number | null;
          financingPref:     string | null;
          attachmentKeywords:string[];
          urgency:           string;
          summary:           string;
        };

        // Fill in from body overrides → Claude parse → defaults
        deliveryState = deliveryState ?? parsed.deliveryState?.toUpperCase() ?? DEFAULT_DELIVERY_STATE;
        customerType  = body.customerType ?? (parsed.customerType === "gmu" ? "gmu" : "standard");

        // ── Stage 2: Resolve brand + model ─────────────────────────────────
        emit({ type: "status", message: "Searching the machine catalog…" });

        // Brand resolution (if not already provided)
        if (!resolvedBrandId && parsed.brandKeyword) {
          const brandQuery = parsed.brandKeyword.toUpperCase();
          const { data: brandRow } = await auth.supabase
            .from("qb_brands")
            .select("id, code, name")
            .or(`code.eq.${brandQuery},name.ilike.${parsed.brandKeyword}`)
            .limit(1)
            .maybeSingle();
          resolvedBrandId = (brandRow as { id: string } | null)?.id ?? null;
        }

        // Model fuzzy search (if not already provided)
        let modelCandidates: Array<Record<string, unknown>> = [];
        if (!resolvedModelId && parsed.modelKeyword) {
          const { data: fuzzyRows } = await auth.supabase.rpc("qb_search_equipment_fuzzy", {
            p_query:    parsed.modelKeyword,
            p_brand_id: resolvedBrandId ?? undefined,
            p_limit:    5,
          });
          modelCandidates = (fuzzyRows ?? []) as Array<Record<string, unknown>>;

          const top = modelCandidates[0];
          if (top && (top.similarity as number) >= 0.30) {
            resolvedModelId = top.id as string;
            if (!resolvedBrandId) resolvedBrandId = top.brand_id as string;
          }
        }

        // Log telemetry (fire-and-forget)
        svcClient.from("qb_ai_request_log").insert({
          user_id:           auth.userId,
          raw_prompt:        prompt,
          resolved_brand_id: resolvedBrandId,
          resolved_model_id: resolvedModelId,
          model_candidates:  modelCandidates.length ? modelCandidates.slice(0, 5) : null,
          confidence: {
            brand: resolvedBrandId ? 0.85 : 0.10,
            model: resolvedModelId ? 0.85 : 0.10,
            state: deliveryState ? 0.80 : 0.30,
            customerType: 0.80,
          },
          delivery_state: deliveryState,
          customer_type:  customerType,
          latency_ms:     Date.now() - startMs,
          error:          null,
          prompt_source:  promptSource,
        }).select("id").single().then(({ data }) => {
          logId = (data as { id: string } | null)?.id ?? null;
        }).catch(() => { /* telemetry failure must not affect response */ });

        // ── No model found — return partial results ─────────────────────────
        if (!resolvedModelId) {
          emit({
            type:    "error",
            fatal:   false,
            message: parsed.modelKeyword
              ? `Couldn't find a machine matching "${parsed.modelKeyword}" in the catalog. ` +
                `${modelCandidates.length ? `Closest matches: ${modelCandidates.slice(0, 3).map((c) => c.name_display).join(", ")}. ` : ""}` +
                `Try being more specific (e.g. "ASV RT-135") or browse the catalog manually.`
              : `No machine mentioned in your description. Try: "We need an ASV RT-135 for a construction contractor in Lake City."`,
            candidates: modelCandidates.slice(0, 3).map((c) => ({
              modelCode:      c.model_code,
              nameDisplay:    c.name_display,
              listPriceCents: c.list_price_cents,
            })),
            parsedSummary: parsed.summary,
          });
          emit({ type: "complete", totalScenarios: 0, latencyMs: Date.now() - startMs });
          controller.close();
          return;
        }

        // ── Stage 3: Fetch model + brand + programs (parallel) ─────────────
        emit({ type: "status", message: "Pulling programs and pricing data…" });

        const [modelResult, freightResult, programsResult] = await Promise.all([
          auth.supabase
            .from("qb_equipment_models")
            .select(`
              id, model_code, name_display, list_price_cents, model_year, family,
              brand:qb_brands (
                id, code, name, discount_configured,
                dealer_discount_pct, default_markup_pct, markup_floor_pct,
                tariff_pct, pdi_default_cents, good_faith_pct, attachment_markup_pct
              )
            `)
            .eq("id", resolvedModelId)
            .is("deleted_at", null)
            .single(),

          auth.supabase
            .from("qb_freight_zones")
            .select("freight_large_cents, freight_small_cents, zone_name")
            .eq("brand_id", resolvedBrandId!)
            .contains("state_codes", [deliveryState])
            .order("effective_from", { ascending: false })
            .limit(1)
            .maybeSingle(),

          auth.supabase
            .from("qb_programs")
            .select("id, program_type, name, brand_id, active, effective_from, effective_to, details, program_code")
            .eq("brand_id", resolvedBrandId!)
            .eq("active", true)
            .lte("effective_from", new Date().toISOString().slice(0, 10))
            .or(`effective_to.is.null,effective_to.gte.${new Date().toISOString().slice(0, 10)}`),
        ]);

        if (modelResult.error || !modelResult.data) {
          emit({ type: "error", fatal: true, message: "Could not load machine data from catalog." });
          controller.close();
          return;
        }

        const model = modelResult.data as Record<string, unknown>;
        const brand = Array.isArray(model.brand) ? model.brand[0] : model.brand as Record<string, unknown>;

        if (!brand) {
          emit({ type: "error", fatal: true, message: "Brand data missing for this machine." });
          controller.close();
          return;
        }

        if (!brand.discount_configured) {
          emit({
            type:    "error",
            fatal:   false,
            message: `${brand.name} not yet configured for deal engine.`,
          });
          emit({ type: "complete", totalScenarios: 0, latencyMs: Date.now() - startMs });
          controller.close();
          return;
        }

        // Emit the resolved model so the UI can show it immediately
        emit({
          type: "resolved",
          model: {
            id:              model.id,
            modelCode:       model.model_code,
            nameDisplay:     model.name_display,
            listPriceCents:  model.list_price_cents,
            modelYear:       model.model_year,
            brandCode:       brand.code,
            brandName:       brand.name,
          },
          parsedSummary: parsed.summary,
          deliveryState,
          customerType,
        });

        // ── Stage 4: Compute equipment cost ────────────────────────────────
        const listPriceCents      = model.list_price_cents as number;
        const dealerDiscountPct   = brand.dealer_discount_pct as number;
        const markupTargetPct     = (brand.default_markup_pct as number) ?? 0.12;
        const tariffPct           = brand.tariff_pct as number;
        const pdiCents            = brand.pdi_default_cents as number;
        const goodFaithPct        = brand.good_faith_pct as number;

        // Use zone freight if available; fall back to seeded ASV FL rate
        const freightData = freightResult.data as Record<string, unknown> | null;
        const freightCents = (freightData?.freight_large_cents as number | undefined)
          ?? FALLBACK_FREIGHT_CENTS;

        // Pricing waterfall (Steps 1–7 from Slice 02 spec):
        const discountCents         = Math.round(listPriceCents * dealerDiscountPct);
        const discountedPrice       = listPriceCents - discountCents;
        const pdiAndGoodFaith       = pdiCents + Math.round(discountedPrice * goodFaithPct);
        const tariffCents           = Math.round(listPriceCents * tariffPct);
        const equipmentCostCents    = discountedPrice + pdiAndGoodFaith + freightCents + tariffCents;
        const markupCents           = Math.round(equipmentCostCents * markupTargetPct);
        const baselineSalesPriceCents = equipmentCostCents + markupCents;

        // ── Stage 5: Program eligibility + scenarios ────────────────────────
        emit({ type: "status", message: "Calculating your deal scenarios…" });

        const programCtx: ProgramQuoteContext = {
          brandId:          resolvedBrandId!,
          equipmentModelId: resolvedModelId,
          modelCode:        model.model_code as string,
          modelYear:        model.model_year as number | null,
          customerType,
          dealDate:         new Date(),
          listPriceCents,
        };

        const programs = programsResult.data ?? [];
        const recommendations = await recommendPrograms(programCtx, auth.supabase);

        const scenarios = buildScenarios({
          context:                  programCtx,
          recommendations,
          equipmentCostCents,
          baselineSalesPriceCents,
          markupPct: markupTargetPct,
        });

        // ── Stage 6: Stream scenarios ───────────────────────────────────────
        // Yield briefly between each scenario so the browser renders cards
        // progressively even though the computation is synchronous.
        for (let i = 0; i < scenarios.length; i++) {
          emit({ type: "scenario", scenario: scenarios[i], index: i });
          // Micro-yield: let Deno's event loop flush the SSE chunk to the client
          await new Promise<void>((resolve) => setTimeout(resolve, 80));
        }

        emit({
          type:           "complete",
          totalScenarios: scenarios.length,
          latencyMs:      Date.now() - startMs,
          logId,
          resolvedModel: {
            id:             model.id,
            modelCode:      model.model_code,
            nameDisplay:    model.name_display,
            listPriceCents: model.list_price_cents,
          },
          brandId:         resolvedBrandId,
          deliveryState,
          customerType,
          programCount:    programs.length,
        });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error building scenarios";
        console.error("[qb-ai-scenarios]", err);

        // Update telemetry log with error
        if (logId) {
          svcClient.from("qb_ai_request_log")
            .update({ error: message })
            .eq("id", logId)
            .catch(() => { /* ignore */ });
        }

        emit({ type: "error", fatal: true, message });
        emit({ type: "complete", totalScenarios: 0, latencyMs: Date.now() - startMs });
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: sseHeaders });
});
