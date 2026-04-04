/**
 * Quote Builder V2 Edge Function
 *
 * AI equipment recommendation, margin check surfacing, financing calc.
 * Zero-blocking: works with manual catalog when IntelliDealer unavailable.
 *
 * POST /recommend: AI equipment recommendation from job description
 * POST /calculate: Financing scenarios from financing_rate_matrix
 * POST /save: Save quote package
 * GET ?deal_id=...: Load existing quote for deal
 *
 * Auth: rep/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

async function aiEquipmentRecommendation(
  jobDescription: string,
  catalogEntries: Record<string, unknown>[],
): Promise<{ machine: string; attachments: string[]; reasoning: string }> {
  if (!OPENAI_API_KEY) {
    return { machine: "", attachments: [], reasoning: "AI recommendation unavailable — select equipment manually." };
  }

  try {
    const catalogSummary = catalogEntries.slice(0, 50).map((e) =>
      `${e.make} ${e.model} (${e.year || "N/A"}) - ${e.category} - $${e.list_price || "N/A"}`
    ).join("\n");

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
          content: `You are an equipment specialist for QEP, a heavy equipment dealership. Given a job description, recommend the optimal machine and attachments from the available inventory. Return JSON: { "machine": "Make Model", "attachments": ["Attachment 1", "Attachment 2"], "reasoning": "2-3 sentence explanation of why this equipment is optimal for the described job" }`,
        }, {
          role: "user",
          content: `Job description: ${jobDescription}\n\nAvailable equipment:\n${catalogSummary || "No catalog entries — provide general recommendation."}`,
        }],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return { machine: "", attachments: [], reasoning: "AI recommendation failed." };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { machine: "", attachments: [], reasoning: "No recommendation generated." };
    return JSON.parse(content);
  } catch {
    return { machine: "", attachments: [], reasoning: "AI recommendation error — select manually." };
  }
}

function calculateFinancingScenarios(
  totalAmount: number,
  rates: Array<{ term_months: number; apr: number; lender_name: string; loan_type: string }>,
): Array<{ type: string; term_months: number; rate: number; monthly_payment: number; total_cost: number; lender: string }> {
  const scenarios: Array<{ type: string; term_months: number; rate: number; monthly_payment: number; total_cost: number; lender: string }> = [];

  // Cash scenario
  scenarios.push({
    type: "cash",
    term_months: 0,
    rate: 0,
    monthly_payment: 0,
    total_cost: totalAmount,
    lender: "Cash",
  });

  // Finance scenario (60-month, best rate)
  const financeRate = rates.find((r) => r.term_months === 60 && r.loan_type === "finance") || rates[0];
  if (financeRate) {
    const monthlyRate = financeRate.apr / 100 / 12;
    const months = financeRate.term_months || 60;
    const payment = monthlyRate > 0
      ? (totalAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : totalAmount / months;
    scenarios.push({
      type: "finance",
      term_months: months,
      rate: financeRate.apr,
      monthly_payment: Math.round(payment * 100) / 100,
      total_cost: Math.round(payment * months * 100) / 100,
      lender: financeRate.lender_name,
    });
  }

  // Lease scenario (48-month)
  const leaseRate = rates.find((r) => r.term_months === 48 && r.loan_type === "lease") || rates.find((r) => r.loan_type === "lease");
  if (leaseRate) {
    const monthlyRate = leaseRate.apr / 100 / 12;
    const months = leaseRate.term_months || 48;
    const residual = totalAmount * 0.25; // 25% residual
    const payment = monthlyRate > 0
      ? ((totalAmount - residual) * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : (totalAmount - residual) / months;
    scenarios.push({
      type: "lease",
      term_months: months,
      rate: leaseRate.apr,
      monthly_payment: Math.round(payment * 100) / 100,
      total_cost: Math.round((payment * months + residual) * 100) / 100,
      lender: leaseRate.lender_name,
    });
  }

  return scenarios;
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    // ── GET: Load existing quote for deal ────────────────────────────────
    if (req.method === "GET") {
      const dealId = url.searchParams.get("deal_id");
      if (!dealId) return safeJsonError("deal_id required", 400, origin);

      const { data, error } = await supabase
        .from("quote_packages")
        .select("*, quote_signatures(*)")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return safeJsonError("Failed to load quote", 500, origin);
      return safeJsonOk({ quote: data }, origin);
    }

    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const body = await req.json();

    // ── POST /recommend: AI equipment recommendation ─────────────────────
    if (action === "recommend") {
      if (!body.job_description) {
        return safeJsonError("job_description required", 400, origin);
      }

      // Fetch available catalog
      const { data: catalog } = await supabase
        .from("catalog_entries")
        .select("make, model, year, category, list_price, attachments")
        .eq("is_available", true)
        .limit(50);

      const recommendation = await aiEquipmentRecommendation(
        body.job_description,
        catalog ?? [],
      );

      return safeJsonOk({ recommendation }, origin);
    }

    // ── POST /calculate: Financing scenarios ─────────────────────────────
    if (action === "calculate") {
      if (!body.total_amount || body.total_amount <= 0) {
        return safeJsonError("total_amount must be positive", 400, origin);
      }

      const { data: rates } = await supabase
        .from("financing_rate_matrix")
        .select("term_months, apr, lender_name, loan_type")
        .eq("is_active", true);

      const scenarios = calculateFinancingScenarios(
        body.total_amount,
        (rates ?? []) as Array<{ term_months: number; apr: number; lender_name: string; loan_type: string }>,
      );

      // Margin check
      const marginPct = body.margin_pct ?? null;
      const marginStatus = marginPct !== null && marginPct < 10
        ? { flagged: true, message: "Margin below 10% — requires Iron Manager approval" }
        : { flagged: false, message: null };

      return safeJsonOk({ scenarios, margin_check: marginStatus }, origin);
    }

    // ── POST /save: Save quote package ───────────────────────────────────
    if (action === "save") {
      if (!body.deal_id) {
        return safeJsonError("deal_id required", 400, origin);
      }

      const { data, error } = await supabase
        .from("quote_packages")
        .upsert({
          deal_id: body.deal_id,
          contact_id: body.contact_id,
          equipment: body.equipment || [],
          attachments_included: body.attachments_included || [],
          trade_in_valuation_id: body.trade_in_valuation_id,
          trade_allowance: body.trade_allowance,
          financing_scenarios: body.financing_scenarios || [],
          equipment_total: body.equipment_total || 0,
          attachment_total: body.attachment_total || 0,
          subtotal: body.subtotal || 0,
          trade_credit: body.trade_credit || 0,
          net_total: body.net_total || 0,
          margin_amount: body.margin_amount,
          margin_pct: body.margin_pct,
          ai_recommendation: body.ai_recommendation,
          entry_mode: body.entry_mode || "manual",
          created_by: user.id,
        }, { onConflict: "deal_id" })
        .select()
        .single();

      if (error) {
        console.error("quote save error:", error);
        return safeJsonError("Failed to save quote", 500, origin);
      }

      return safeJsonOk({ quote: data }, origin, 201);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    console.error("quote-builder-v2 error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
