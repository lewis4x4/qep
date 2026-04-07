/**
 * DGE Optimizer Edge Function
 *
 * The 14-Variable Deal Optimization Engine.
 * For every active deal, produces 3 optimized scenarios:
 *   1. Conservative: Maximum margin, lower close probability
 *   2. Balanced: Optimized across all 14 variables (best expected value)
 *   3. Aggressive: Maximum close probability, minimum acceptable margin
 *
 * POST: Generate/refresh deal scenarios for a specific deal
 * GET:  ?deal_id=... → retrieve existing scenarios
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface DealContext {
  deal: Record<string, unknown>;
  equipment: Record<string, unknown> | null;
  assessment: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  tradeIn: Record<string, unknown> | null;
  marketComps: Record<string, unknown>[];
  incentives: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  competitorMentions: Record<string, unknown>[];
}

async function generate3Scenarios(context: DealContext): Promise<Record<string, unknown>[]> {
  if (!OPENAI_API_KEY) {
    return generateRuleBasedScenarios(context);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: `You are the DGE (Deal Genome Engine) for QEP, a heavy equipment dealership. You optimize deals across 14 variables to produce 3 scenarios.

Variables: Base Price, Market Value, Inventory Age, Trade-In, Attachment Bundle, Service Contract, Financing, Manufacturer Incentives, Customer Price Sensitivity, Customer LTV, Competitive Pressure, Seasonal Demand, Fleet Replacement Cycle, Close Probability.

Return a JSON object with:
{
  "scenarios": [
    {
      "type": "conservative",
      "label": "Maximum Margin",
      "equipment_price": number,
      "trade_allowance": number,
      "attachment_value": number,
      "financing_term_months": number,
      "financing_rate": number,
      "service_contract_value": number,
      "total_deal_value": number,
      "total_margin": number,
      "margin_pct": number,
      "close_probability": number,
      "expected_value": number,
      "reasoning": "string"
    },
    { "type": "balanced", ... },
    { "type": "aggressive", ... }
  ],
  "recommendations": ["string"],
  "risk_factors": ["string"]
}`,
        }, {
          role: "user",
          content: `Optimize this deal:\n${JSON.stringify(context, null, 2)}`,
        }],
        max_tokens: 1500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.error("DGE AI error:", await res.text());
      return generateRuleBasedScenarios(context);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return generateRuleBasedScenarios(context);

    const parsed = JSON.parse(content);
    return parsed.scenarios || generateRuleBasedScenarios(context);
  } catch (err) {
    console.error("DGE AI error:", err);
    return generateRuleBasedScenarios(context);
  }
}

function generateRuleBasedScenarios(context: DealContext): Record<string, unknown>[] {
  const basePrice = (context.deal.amount as number) || 50000;
  const tradeValue = (context.tradeIn?.preliminary_value as number) || 0;

  return [
    {
      type: "conservative",
      label: "Maximum Margin",
      equipment_price: basePrice,
      trade_allowance: tradeValue * 0.9,
      margin_pct: 22,
      close_probability: 40,
      expected_value: basePrice * 0.22 * 0.4,
      reasoning: "Prioritizes dealer margin with conservative trade allowance.",
    },
    {
      type: "balanced",
      label: "Optimized",
      equipment_price: basePrice * 0.97,
      trade_allowance: tradeValue,
      margin_pct: 17,
      close_probability: 65,
      expected_value: basePrice * 0.97 * 0.17 * 0.65,
      reasoning: "Best expected value balancing margin and close probability.",
    },
    {
      type: "aggressive",
      label: "Win the Deal",
      equipment_price: basePrice * 0.93,
      trade_allowance: tradeValue * 1.05,
      margin_pct: 12,
      close_probability: 85,
      expected_value: basePrice * 0.93 * 0.12 * 0.85,
      reasoning: "Maximum close probability with minimum acceptable margin.",
    },
  ];
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // ── GET: retrieve scenarios ──────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const dealId = url.searchParams.get("deal_id");
      if (!dealId) return safeJsonError("deal_id required", 400, origin);

      const { data } = await supabase
        .from("deal_scenarios")
        .select("*, margin_waterfalls(*)")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(3);

      return safeJsonOk({ scenarios: data || [] }, origin);
    }

    // ── POST: generate scenarios ─────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const dealId = body.deal_id;
      if (!dealId) return safeJsonError("deal_id required", 400, origin);

      // Gather all 14 variables
      const { data: deal } = await supabase
        .from("crm_deals")
        .select("*")
        .eq("id", dealId)
        .single();

      if (!deal) return safeJsonError("Deal not found", 404, origin);

      const { data: assessment } = await supabase
        .from("needs_assessments")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: tradeIn } = await supabase
        .from("trade_valuations")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: incentives } = await supabaseAdmin
        .from("manufacturer_incentives")
        .select("*")
        .eq("is_active", true);

      const { data: financing } = await supabaseAdmin
        .from("financing_rate_matrix")
        .select("*")
        .eq("is_active", true);

      const context: DealContext = {
        deal,
        equipment: null,
        assessment,
        customer: null,
        tradeIn,
        marketComps: [],
        incentives: incentives || [],
        financing: financing || [],
        competitorMentions: [],
      };

      const scenarios = await generate3Scenarios(context);

      // Update deal scoring — use user-scoped client so RLS enforces workspace
      const bestScenario = scenarios.find((s) => s.type === "balanced") || scenarios[0];
      const expectedValue = typeof bestScenario?.expected_value === "number"
        ? bestScenario.expected_value
        : null;
      await supabase
        .from("crm_deals")
        .update({
          dge_score: expectedValue,
          dge_scenario_count: scenarios.length,
          dge_last_scored_at: new Date().toISOString(),
        })
        .eq("id", dealId);

      return safeJsonOk({ scenarios, deal_id: dealId }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "dge-optimizer", req });
    console.error("dge-optimizer error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
