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
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface TaxLine {
  description: string;
  rate: number;
  amount: number;
  applies_to: string;
}

type QuoteTaxProfile =
  | "standard"
  | "agriculture_exempt"
  | "fire_mitigation_exempt"
  | "government_exempt"
  | "resale_exempt";

function clampCurrency(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, numeric) * 100) / 100;
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
    // Canonical JWT auth — ES256-safe + rep/admin/manager/owner role gate.
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const supabase = auth.supabase;

    // tax_treatments, tax_exemption_certificates, section_179_scenarios are
    // admin-managed tables — keep a service-role client for those reads/inserts.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const branchSlug = typeof body.branch_slug === "string" ? body.branch_slug : null;
    const companyId = typeof body.company_id === "string" ? body.company_id : null;
    const dealId = typeof body.deal_id === "string" ? body.deal_id : null;
    const subtotal = clampCurrency(body.subtotal);
    const discountTotal = clampCurrency(body.discount_total);
    const tradeAllowance = clampCurrency(body.trade_allowance);
    const taxProfile = (typeof body.tax_profile === "string" ? body.tax_profile : "standard") as QuoteTaxProfile;
    const taxableBasis = Math.max(0, subtotal - discountTotal - tradeAllowance);
    const section179Base = Math.max(0, subtotal - discountTotal);

    if (subtotal <= 0) return safeJsonError("subtotal must be positive", 400, origin);
    if (!branchSlug) return safeJsonError("branch_slug required", 400, origin);

    const { data: branch } = await supabaseAdmin
      .from("branches")
      .select("slug, state_province")
      .eq("slug", branchSlug)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (!branch?.state_province) {
      return safeJsonError("Branch tax jurisdiction unavailable", 400, origin);
    }

    // Look up tax treatments for branch jurisdiction
    const { data: taxTreatments } = await supabaseAdmin
      .from("tax_treatments")
      .select("*")
      .eq("is_active", true)
      .eq("jurisdiction", branch.state_province)
      .eq("tax_type", "sales_tax")
      .order("applies_to");

    // Check for customer exemptions
    let exemptionsApplied: string[] = [];
    if (companyId) {
      const { data: exemptions } = await supabaseAdmin
        .from("tax_exemption_certificates")
        .select("*")
        .eq("crm_company_id", companyId)
        .eq("status", "verified")
        .or(`expiration_date.is.null,expiration_date.gte.${new Date().toISOString().split("T")[0]}`);

      if (exemptions && exemptions.length > 0) {
        const matching = taxProfile === "standard"
          ? exemptions
          : exemptions.filter((e) => e.exemption_type === taxProfile.replace(/_exempt$/, ""));
        if (matching.length > 0) {
          exemptionsApplied = matching.map((e) => `${e.exemption_type} (cert #${e.certificate_number})`);
        }
      }
    }

    if (taxProfile !== "standard" && exemptionsApplied.length === 0) {
      exemptionsApplied = [
        `Estimated ${taxProfile.replace(/_exempt$/, "").replace(/_/g, " ")} exemption — verify certificate before sending.`,
      ];
    }

    // Calculate tax lines
    const taxLines: TaxLine[] = [];
    let totalTax = 0;

    if (exemptionsApplied.length === 0 && taxTreatments) {
      for (const tt of taxTreatments) {
        if (["equipment_new", "attachments"].includes(tt.applies_to) && taxableBasis > 0) {
          const amount = Math.round(taxableBasis * tt.rate * 100) / 100;
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
    if (body.include_179 !== false && section179Base > 0) {
      const taxYear = body.tax_year || new Date().getFullYear();
      const effectiveRate = body.effective_tax_rate || 0.25;

      section179 = computeSection179(section179Base, taxYear, effectiveRate);

      // Save scenario
      await supabaseAdmin.from("section_179_scenarios").insert({
        deal_id: dealId,
        tax_year: taxYear,
        equipment_cost: section179Base,
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
      equipment_cost: section179Base,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "tax-calculator", req });
    console.error("tax-calculator error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
