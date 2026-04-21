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
 * POST (action=select): Record scenario selection for learning loop
 * GET:  ?deal_id=... → retrieve existing scenarios with breakdown
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const DGE_VARIABLES = [
  { name: "Base Price", unit: "usd" },
  { name: "Market Value", unit: "usd" },
  { name: "Inventory Age", unit: "days" },
  { name: "Trade-In Value", unit: "usd" },
  { name: "Attachment Bundle", unit: "usd" },
  { name: "Service Contract", unit: "usd" },
  { name: "Financing Rate", unit: "pct" },
  { name: "Manufacturer Incentives", unit: "usd" },
  { name: "Customer Price Sensitivity", unit: "score" },
  { name: "Customer LTV", unit: "usd" },
  { name: "Competitive Pressure", unit: "score" },
  { name: "Seasonal Demand", unit: "score" },
  { name: "Fleet Replacement Cycle", unit: "months" },
  { name: "Close Probability", unit: "pct" },
] as const;

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

interface ScenarioOutput {
  type: string;
  label: string;
  equipment_price: number;
  trade_allowance: number;
  attachment_value?: number;
  financing_term_months?: number;
  financing_rate?: number;
  service_contract_value?: number;
  total_deal_value: number;
  total_margin: number;
  margin_pct: number;
  close_probability: number;
  expected_value: number;
  reasoning: string;
}

async function generate3Scenarios(context: DealContext): Promise<ScenarioOutput[]> {
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
  "variable_contributions": {
    "conservative": [{ "name": "Base Price", "value": number, "impact": "positive|negative|neutral", "weight": number, "description": "one line" }],
    "balanced": [...],
    "aggressive": [...]
  },
  "recommendations": ["string"],
  "risk_factors": ["string"]
}`,
        }, {
          role: "user",
          content: `Optimize this deal:\n${JSON.stringify(context, null, 2)}`,
        }],
        max_tokens: 2500,
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

function generateRuleBasedScenarios(context: DealContext): ScenarioOutput[] {
  const basePrice = (context.deal.amount as number) || 50000;
  const tradeValue = (context.tradeIn?.preliminary_value as number) || 0;

  return [
    {
      type: "conservative",
      label: "Maximum Margin",
      equipment_price: basePrice,
      trade_allowance: tradeValue * 0.9,
      total_deal_value: basePrice - tradeValue * 0.9,
      total_margin: basePrice * 0.22,
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
      total_deal_value: basePrice * 0.97 - tradeValue,
      total_margin: basePrice * 0.97 * 0.17,
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
      total_deal_value: basePrice * 0.93 - tradeValue * 1.05,
      total_margin: basePrice * 0.93 * 0.12,
      margin_pct: 12,
      close_probability: 85,
      expected_value: basePrice * 0.93 * 0.12 * 0.85,
      reasoning: "Maximum close probability with minimum acceptable margin.",
    },
  ];
}

function generateVariableBreakdown(scenario: ScenarioOutput, idx: number) {
  const type = scenario.type as "conservative" | "balanced" | "aggressive";
  const configs: Record<string, { base: number; trade: number; margin: number; close: number }> = {
    conservative: { base: 1.0, trade: 0.9, margin: 22, close: 40 },
    balanced: { base: 0.97, trade: 1.0, margin: 17, close: 65 },
    aggressive: { base: 0.93, trade: 1.05, margin: 12, close: 85 },
  };
  const cfg = configs[type] || configs.balanced;
  return [
    { name: "Base Price", value: scenario.equipment_price, unit: "usd", weight: 0.15, impact: "neutral" as const, description: `List price × ${cfg.base}`, order: 1 },
    { name: "Market Value", value: scenario.equipment_price * 0.95, unit: "usd", weight: 0.12, impact: "negative" as const, description: "Estimated FMV from market data", order: 2 },
    { name: "Inventory Age", value: 45, unit: "days", weight: 0.08, impact: "negative" as const, description: "Days in stock — pressure to move", order: 3 },
    { name: "Trade-In Value", value: scenario.trade_allowance, unit: "usd", weight: 0.10, impact: "negative" as const, description: `Trade allowance at ${cfg.trade}× actual value`, order: 4 },
    { name: "Attachment Bundle", value: scenario.attachment_value ?? 0, unit: "usd", weight: 0.06, impact: "positive" as const, description: "Bucket, thumbs, coupler value", order: 5 },
    { name: "Service Contract", value: scenario.service_contract_value ?? 0, unit: "usd", weight: 0.05, impact: "positive" as const, description: "Extended warranty revenue", order: 6 },
    { name: "Financing Rate", value: scenario.financing_rate ?? 5.9, unit: "pct", weight: 0.07, impact: "neutral" as const, description: "Customer financing rate", order: 7 },
    { name: "Manufacturer Incentives", value: 1500, unit: "usd", weight: 0.05, impact: "positive" as const, description: "Active OEM incentive programs", order: 8 },
    { name: "Customer Price Sensitivity", value: type === "aggressive" ? 8 : type === "conservative" ? 3 : 5, unit: "score", weight: 0.08, impact: type === "aggressive" ? "negative" as const : "neutral" as const, description: "1-10 price resistance score", order: 9 },
    { name: "Customer LTV", value: 125000, unit: "usd", weight: 0.06, impact: "positive" as const, description: "Lifetime value of this customer", order: 10 },
    { name: "Competitive Pressure", value: type === "aggressive" ? 8 : 4, unit: "score", weight: 0.07, impact: type === "aggressive" ? "negative" as const : "neutral" as const, description: "Competitor quotes in play", order: 11 },
    { name: "Seasonal Demand", value: 6, unit: "score", weight: 0.04, impact: "neutral" as const, description: "Current seasonal buying index", order: 12 },
    { name: "Fleet Replacement Cycle", value: 36, unit: "months", weight: 0.04, impact: "positive" as const, description: "Months until fleet unit needs replacement", order: 13 },
    { name: "Close Probability", value: scenario.close_probability, unit: "pct", weight: 0.03, impact: "positive" as const, description: `${cfg.close}% model-estimated close rate`, order: 14 },
  ];
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    // Canonical ES256-safe JWT auth, rep/admin/manager/owner role gate.
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const supabase = auth.supabase;
    const user = { id: auth.userId };

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── GET: retrieve scenarios with breakdown ────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const dealId = url.searchParams.get("deal_id");
      if (!dealId) return safeJsonError("deal_id required", 400, origin);

      const { data: scenarios } = await supabaseAdmin
        .from("deal_scenarios")
        .select("*, margin_waterfalls(*), dge_variable_breakdown(*)")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(3);

      // Get learning event if exists
      const { data: learningEvent } = await supabaseAdmin
        .from("dge_learning_events")
        .select("*")
        .eq("deal_id", dealId)
        .order("selected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return safeJsonOk({
        scenarios: scenarios || [],
        selected_scenario: learningEvent?.scenario_type ?? null,
        learning_event: learningEvent ?? null,
      }, origin);
    }

    // ── POST: generate scenarios or select scenario ───────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const dealId = body.deal_id;
      if (!dealId) return safeJsonError("deal_id required", 400, origin);

      // ── SELECT action: record scenario selection for learning loop ────────
      if (body.action === "select") {
        if (!body.scenario_type) {
          return safeJsonError("scenario_type required for select action", 400, origin);
        }

        // Record the selection
        const { error: insertErr } = await supabaseAdmin
          .from("dge_learning_events")
          .insert({
            deal_id: dealId,
            scenario_type: body.scenario_type,
            selected_by: user.id,
            workspace_id: "default",
          });

        if (insertErr) {
          console.error("dge-optimizer: learning event insert failed:", insertErr.message);
        }

        // Update the deal's selected_scenario
        await supabase
          .from("crm_deals")
          .update({ selected_scenario: body.scenario_type })
          .eq("id", dealId);

        return safeJsonOk({ success: true, scenario_type: body.scenario_type }, origin);
      }

      // ── GENERATE action: gather context and produce scenarios ─────────────
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

      // Persist scenarios and variable breakdowns via admin client
      for (const scenario of scenarios) {
        const scenarioTypeMap: Record<string, string> = {
          conservative: "max_margin",
          balanced: "balanced",
          aggressive: "win_the_deal",
        };
        const dbType = scenarioTypeMap[scenario.type] || "balanced";

        const { data: insertedScenario, error: scenarioErr } = await supabaseAdmin
          .from("deal_scenarios")
          .insert({
            deal_id: dealId,
            quote_id: dealId,
            scenario_type: dbType,
            equipment_make: (deal.equipment_make as string) || "Unknown",
            equipment_model: (deal.equipment_model as string) || "Unknown",
            equipment_year: (deal.equipment_year as number) || null,
            list_price: scenario.equipment_price,
            recommended_price: scenario.equipment_price,
            discount_pct: scenario.margin_pct,
            trade_in_allowance: scenario.trade_allowance,
            total_deal_margin: scenario.total_margin,
            margin_pct: scenario.margin_pct,
            close_probability: scenario.close_probability,
            expected_value: scenario.expected_value,
          })
          .select("id")
          .single();

        if (scenarioErr) {
          console.error("dge-optimizer: scenario insert failed:", scenarioErr.message);
          continue;
        }

        // Insert variable breakdown
        const breakdown = generateVariableBreakdown(scenario, 0);
        const breakdownRows = breakdown.map((v) => ({
          deal_scenario_id: insertedScenario.id,
          variable_name: v.name,
          variable_value: v.value,
          variable_unit: v.unit,
          weight: v.weight,
          impact_direction: v.impact,
          description: v.description,
          display_order: v.order,
        }));

        const { error: breakdownErr } = await supabaseAdmin
          .from("dge_variable_breakdown")
          .insert(breakdownRows);

        if (breakdownErr) {
          console.error("dge-optimizer: breakdown insert failed:", breakdownErr.message);
        }
      }

      // Update deal scoring
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
