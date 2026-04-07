/**
 * Tax Calculator Edge Function
 *
 * Moonshot 4: Tax & Incentive Intelligence.
 * Ryan: Florida exempts fire suppression equipment AND all future
 * parts/service — but same mulcher could be residential or fire
 * mitigation. It's the APPLICATION that determines the exemption.
 *
 * POST: { deal_id, branch_slug, include_179?: boolean, tax_year?: number }
 * Returns: tax lines, exemptions applied, Section 179 scenarios
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface TaxLine {
  description: string;
  rate: number;
  amount: number;
  applies_to: string;
}

function computeSection179(
  equipmentCost: number,
  taxYear: number,
  effectiveTaxRate: number,
): { deduction: number; bonus: number; total_deduction: number; tax_savings: number; net_cost: number } {
  // 2026 Section 179 limit: $1,220,000 (approximate, adjust per IRS guidance)
  const limit179 = 1_220_000;
  const deduction = Math.min(equipmentCost, limit179);

  // Bonus depreciation phasedown: 2024=60%, 2025=40%, 2026=20%, 2027=0%
  const bonusPct = taxYear <= 2024 ? 0.6 : taxYear === 2025 ? 0.4 : taxYear === 2026 ? 0.2 : 0;
  const bonus = (equipmentCost - deduction) * bonusPct;

  const totalDeduction = deduction + bonus;
  const taxSavings = totalDeduction * effectiveTaxRate;
  const netCost = equipmentCost - taxSavings;

  return { deduction, bonus, total_deduction: totalDeduction, tax_savings: taxSavings, net_cost: netCost };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

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
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    const body = await req.json();
    if (!body.deal_id) return safeJsonError("deal_id required", 400, origin);

    const branchSlug = body.branch_slug || "default";

    // Get deal details
    const { data: deal } = await supabase
      .from("crm_deals")
      .select("id, amount, company_id")
      .eq("id", body.deal_id)
      .single();

    if (!deal) return safeJsonError("Deal not found", 404, origin);

    const equipmentCost = deal.amount || 0;

    // Look up tax treatments for branch jurisdiction
    const { data: taxTreatments } = await supabaseAdmin
      .from("tax_treatments")
      .select("*")
      .eq("is_active", true)
      .order("applies_to");

    // Check for customer exemptions
    let exemptionsApplied: string[] = [];
    if (deal.company_id) {
      const { data: exemptions } = await supabaseAdmin
        .from("tax_exemption_certificates")
        .select("*")
        .eq("crm_company_id", deal.company_id)
        .eq("status", "verified")
        .or(`expiration_date.is.null,expiration_date.gte.${new Date().toISOString().split("T")[0]}`);

      if (exemptions && exemptions.length > 0) {
        exemptionsApplied = exemptions.map((e) => `${e.exemption_type} (cert #${e.certificate_number})`);
      }
    }

    // Calculate tax lines
    const taxLines: TaxLine[] = [];
    let totalTax = 0;

    if (exemptionsApplied.length === 0 && taxTreatments) {
      for (const tt of taxTreatments) {
        if (tt.applies_to === "equipment_new" && equipmentCost > 0) {
          const amount = Math.round(equipmentCost * tt.rate * 100) / 100;
          taxLines.push({
            description: `${tt.name} (${tt.jurisdiction})`,
            rate: tt.rate,
            amount,
            applies_to: tt.applies_to,
          });
          totalTax += amount;
        }
      }
    }

    // Section 179 scenarios
    let section179 = null;
    if (body.include_179 !== false && equipmentCost > 0) {
      const taxYear = body.tax_year || new Date().getFullYear();
      const effectiveRate = body.effective_tax_rate || 0.25;

      section179 = computeSection179(equipmentCost, taxYear, effectiveRate);

      // Save scenario
      await supabaseAdmin.from("section_179_scenarios").insert({
        deal_id: body.deal_id,
        tax_year: taxYear,
        equipment_cost: equipmentCost,
        bonus_depreciation_pct: taxYear <= 2024 ? 60 : taxYear === 2025 ? 40 : taxYear === 2026 ? 20 : 0,
        section_179_deduction: section179.deduction,
        bonus_depreciation_amount: section179.bonus,
        total_deduction: section179.total_deduction,
        effective_tax_rate: effectiveRate * 100,
        tax_savings: section179.tax_savings,
        net_cost_after_tax: section179.net_cost,
        assumptions: { effective_rate: effectiveRate, limit_179: 1_220_000 },
      });
    }

    return safeJsonOk({
      tax_lines: taxLines,
      total_tax: totalTax,
      exemptions_applied: exemptionsApplied,
      section_179: section179,
      equipment_cost: equipmentCost,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "tax-calculator", req });
    console.error("tax-calculator error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
