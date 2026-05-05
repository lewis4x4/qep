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
import { clampCurrency, computeQuoteTax, type QuoteTaxProfile, type TaxLine } from "./tax-logic.ts";

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
    const workspaceId = auth.workspaceId || "default";

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
    const deliveryState = typeof body.delivery_state === "string" ? body.delivery_state.trim().toUpperCase() : null;
    const deliveryCounty = typeof body.delivery_county === "string" ? body.delivery_county.trim() : null;
    const taxOverrideAmount = body.tax_override_amount == null || body.tax_override_amount === ""
      ? null
      : clampCurrency(body.tax_override_amount);
    const taxOverrideReason = typeof body.tax_override_reason === "string" ? body.tax_override_reason.trim() : "";
    const taxableBasis = clampCurrency(subtotal - discountTotal - tradeAllowance);
    const section179Base = clampCurrency(subtotal - discountTotal);

    if (subtotal <= 0) return safeJsonError("subtotal must be positive", 400, origin);
    if (taxOverrideAmount != null && taxOverrideReason.length === 0) {
      return safeJsonError("tax_override_reason is required when tax_override_amount is provided", 400, origin);
    }

    let branchState: string | null = null;
    if (branchSlug) {
      const { data: branch } = await supabaseAdmin
        .from("branches")
        .select("slug, state_province")
        .eq("workspace_id", workspaceId)
        .eq("slug", branchSlug)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();
      branchState = typeof branch?.state_province === "string" ? branch.state_province : null;
    }

    const stateCode = deliveryState || branchState;
    if (!stateCode) {
      return safeJsonError("delivery_state or branch_slug required for tax jurisdiction", 400, origin);
    }

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

    let taxResult = computeQuoteTax({
      subtotal,
      discountTotal,
      tradeAllowance,
      taxProfile,
      stateCode,
      countyName: deliveryCounty,
      exemptionsApplied,
      taxOverrideAmount,
      taxOverrideReason,
    });

    if (taxResult.exemptions_applied.length === 0 && !taxResult.manual_override_applied && stateCode.toUpperCase() === "FL") {
      let jurisdiction: Record<string, unknown> | null = null;
      if (!deliveryCounty) {
        return safeJsonError("delivery_county is required for taxable Florida tax preview", 400, origin);
      }
      const lookupCounty = deliveryCounty.replace(/\s+county$/i, "").trim();
      const allowedJurisdictionWorkspaces = Array.from(new Set([workspaceId, "global"]));
      const { data } = await supabaseAdmin
        .from("tax_jurisdictions")
        .select("id, workspace_id, state_code, county_name, jurisdiction_name, state_rate, county_surtax_rate, surtax_cap_amount")
        .in("workspace_id", allowedJurisdictionWorkspaces)
        .eq("state_code", "FL")
        .ilike("county_name", lookupCounty)
        .eq("is_active", true)
        .order("effective_date", { ascending: false })
        .limit(10);
      const jurisdictionRows = Array.isArray(data) ? data : [];
      jurisdiction = jurisdictionRows.find((row) => row.workspace_id === workspaceId)
        ?? jurisdictionRows.find((row) => row.workspace_id === "global")
        ?? null;
      if (!jurisdiction) {
        return safeJsonError(`Florida tax jurisdiction unavailable for ${deliveryCounty}`, 400, origin);
      }
      taxResult = computeQuoteTax({
        subtotal,
        discountTotal,
        tradeAllowance,
        taxProfile,
        stateCode,
        countyName: deliveryCounty,
        jurisdiction: jurisdiction
          ? {
            id: typeof jurisdiction.id === "string" ? jurisdiction.id : null,
            state_code: typeof jurisdiction.state_code === "string" ? jurisdiction.state_code : "FL",
            county_name: typeof jurisdiction.county_name === "string" ? jurisdiction.county_name : deliveryCounty,
            jurisdiction_name: typeof jurisdiction.jurisdiction_name === "string" ? jurisdiction.jurisdiction_name : null,
            state_rate: Number(jurisdiction.state_rate ?? 0.06),
            county_surtax_rate: Number(jurisdiction.county_surtax_rate ?? 0),
            surtax_cap_amount: jurisdiction.surtax_cap_amount == null ? null : Number(jurisdiction.surtax_cap_amount),
          }
          : null,
        exemptionsApplied,
      });
    } else if (taxResult.exemptions_applied.length === 0 && !taxResult.manual_override_applied) {
      // Preserve legacy non-FL treatment-table behavior.
      const { data: taxTreatments } = await supabaseAdmin
        .from("tax_treatments")
        .select("*")
        .eq("is_active", true)
        .eq("jurisdiction", stateCode)
        .eq("tax_type", "sales_tax")
        .order("applies_to");
      const taxLines: TaxLine[] = [];
      let totalTax = 0;
      for (const tt of taxTreatments ?? []) {
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
      taxResult = {
        ...taxResult,
        tax_lines: taxLines,
        total_tax: Math.round(totalTax * 100) / 100,
        state_tax: Math.round(totalTax * 100) / 100,
        county_tax: 0,
      };
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
      tax_lines: taxResult.tax_lines,
      total_tax: taxResult.total_tax,
      state_tax: taxResult.state_tax,
      county_tax: taxResult.county_tax,
      taxable_basis: taxResult.taxable_basis,
      exemptions_applied: taxResult.exemptions_applied,
      manual_override_applied: taxResult.manual_override_applied,
      section_179: section179,
      equipment_cost: section179Base,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "tax-calculator", req });
    console.error("tax-calculator error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
