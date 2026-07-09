/**
 * L9.3 — RPO conversion deal creation, shared by the
 * `create_rental_conversion_deal` flow action (rental.rpo.threshold_reached)
 * and the rental-ops `convert_rpo_to_deal` operator action, so both paths
 * produce identical deals.
 *
 * Semantics:
 *   • One conversion deal per contract — enforced by the m807 partial
 *     unique index on qrm_deals.rental_contract_id; this helper is
 *     find-or-create on that key.
 *   • Seeded amount = (rpo_purchase_price_cents − rpo_credit_accrued_cents)
 *     ÷ 100 — qrm_deals.amount is DOLLARS numeric(14,2), RPO columns are
 *     cents.
 *   • The unit links via qrm_deal_equipment role='subject' (the primary-
 *     unit convention flow_emit_from_deal / link_customer_fleet key on).
 *   • Stage = the workspace's 'Lead Received' stage, falling back to the
 *     lowest sort_order stage — zero-blocking for workspaces with custom
 *     pipelines.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface RentalConversionDealResult {
  dealId: string | null;
  created: boolean;
  error?: string;
}

export async function createRentalConversionDeal(
  admin: SupabaseClient,
  workspaceId: string,
  contractId: string,
): Promise<RentalConversionDealResult> {
  const { data: contract, error: contractError } = await admin
    .from("rental_contracts")
    .select(
      "id, workspace_id, contract_number, qrm_company_id, equipment_id, rpo_eligible, rpo_purchase_price_cents, rpo_credit_accrued_cents, rpo_exercise_deadline",
    )
    .eq("id", contractId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (contractError || !contract) {
    return { dealId: null, created: false, error: contractError?.message ?? "rental contract not found" };
  }
  if (contract.rpo_eligible !== true) {
    return { dealId: null, created: false, error: "contract is not RPO-eligible" };
  }
  if (!contract.qrm_company_id) {
    return { dealId: null, created: false, error: "contract has no company — link qrm_company_id first" };
  }

  // Idempotent on the provenance key.
  const { data: existing } = await admin
    .from("qrm_deals")
    .select("id")
    .eq("rental_contract_id", contract.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing?.id) {
    return { dealId: existing.id as string, created: false };
  }

  let stageId: string | null = null;
  const { data: leadStage } = await admin
    .from("qrm_deal_stages")
    .select("id")
    .eq("name", "Lead Received")
    .limit(1)
    .maybeSingle();
  stageId = (leadStage?.id as string | undefined) ?? null;
  if (!stageId) {
    const { data: firstStage } = await admin
      .from("qrm_deal_stages")
      .select("id")
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    stageId = (firstStage?.id as string | undefined) ?? null;
  }
  if (!stageId) {
    return { dealId: null, created: false, error: "no deal stages configured" };
  }

  const purchaseCents = Number(contract.rpo_purchase_price_cents ?? 0);
  const accruedCents = Number(contract.rpo_credit_accrued_cents ?? 0);
  const amountDollars = Math.max(0, purchaseCents - accruedCents) / 100;

  const { data: deal, error: dealError } = await admin
    .from("qrm_deals")
    .insert({
      workspace_id: workspaceId,
      name: `RPO conversion — ${contract.contract_number ?? String(contract.id).slice(0, 8)}`,
      stage_id: stageId,
      company_id: contract.qrm_company_id,
      amount: amountDollars,
      expected_close_on: contract.rpo_exercise_deadline ?? null,
      rental_contract_id: contract.id,
      metadata: {
        source: "rpo_conversion",
        rpo_purchase_price_cents: purchaseCents,
        rpo_credit_accrued_cents: accruedCents,
        rental_contract_number: contract.contract_number ?? null,
      },
    })
    .select("id")
    .single();
  if (dealError || !deal) {
    // Unique-index race: another path just created it — return that one.
    const { data: raced } = await admin
      .from("qrm_deals")
      .select("id")
      .eq("rental_contract_id", contract.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (raced?.id) return { dealId: raced.id as string, created: false };
    return { dealId: null, created: false, error: dealError?.message ?? "deal insert failed" };
  }

  if (contract.equipment_id) {
    const { error: linkError } = await admin.from("qrm_deal_equipment").insert({
      workspace_id: workspaceId,
      deal_id: deal.id,
      equipment_id: contract.equipment_id,
      role: "subject",
    });
    // unique(deal_id, equipment_id) — a duplicate link is not a failure.
    if (linkError && !String(linkError.message ?? "").includes("duplicate")) {
      return {
        dealId: deal.id as string,
        created: true,
        error: `deal created but unit link failed: ${linkError.message}`,
      };
    }
  }

  return { dealId: deal.id as string, created: true };
}
