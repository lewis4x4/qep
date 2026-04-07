/**
 * Deposit Calculator Edge Function
 *
 * POST: Calculate deposit tier, create deposit record, notify Iron Woman.
 *
 * Implements owner's exact deposit tiers:
 *   $0-$10K      → $500     (tier_1)
 *   $10K-$100K   → $1,000   (tier_2)
 *   $100K-$250K  → $2,500   (tier_3)
 *   $250K+       → MAX($5K, 1%) (tier_4)
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface DepositRequest {
  deal_id: string;
  equipment_value: number;
}

interface DepositTier {
  amount: number;
  tier: string;
  refund_policy: string;
}

function calculateDepositTier(equipmentValue: number): DepositTier {
  if (equipmentValue <= 10000) {
    return { amount: 500, tier: "tier_1", refund_policy: "non_refundable" };
  } else if (equipmentValue <= 100000) {
    return { amount: 1000, tier: "tier_2", refund_policy: "non_refundable" };
  } else if (equipmentValue <= 250000) {
    return { amount: 2500, tier: "tier_3", refund_policy: "non_refundable" };
  } else {
    const onePercent = equipmentValue * 0.01;
    return {
      amount: Math.max(5000, onePercent),
      tier: "tier_4",
      refund_policy: "non_refundable",
    };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
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

    const body: DepositRequest = await req.json();

    if (!body.deal_id) {
      return safeJsonError("deal_id is required", 400, origin);
    }
    if (!body.equipment_value || body.equipment_value <= 0) {
      return safeJsonError("equipment_value must be a positive number", 400, origin);
    }

    // Calculate deposit tier
    const tier = calculateDepositTier(body.equipment_value);

    // Check for existing active deposit on this deal
    const { data: existing } = await supabase
      .from("deposits")
      .select("id, status")
      .eq("deal_id", body.deal_id)
      .not("status", "in", '("refunded","refund_requested")')
      .maybeSingle();

    if (existing) {
      return safeJsonError(
        `Active deposit already exists for this deal (status: ${existing.status})`,
        409,
        origin,
      );
    }

    // Create deposit record
    const { data: deposit, error: depositError } = await supabase
      .from("deposits")
      .insert({
        deal_id: body.deal_id,
        equipment_value: body.equipment_value,
        required_amount: tier.amount,
        deposit_tier: tier.tier,
        refund_policy: tier.refund_policy,
        status: "pending",
        created_by: user.id,
      })
      .select()
      .single();

    if (depositError) {
      console.error("deposit-calculator insert error:", depositError);
      return safeJsonError("Failed to create deposit record", 500, origin);
    }

    // Update deal deposit status
    await supabase
      .from("crm_deals")
      .update({
        deposit_status: "pending",
        deposit_amount: tier.amount,
      })
      .eq("id", body.deal_id);

    // Notify Iron Woman (admin role) via in-app notification
    const { data: deal } = await supabase
      .from("crm_deals")
      .select("name, primary_contact_id, company_id")
      .eq("id", body.deal_id)
      .single();

    // Find all Iron Woman users in the workspace
    const { data: ironWomen } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("iron_role", "iron_woman");

    if (ironWomen && ironWomen.length > 0) {
      const notifications = ironWomen.map((iw) => ({
        workspace_id: "default",
        user_id: iw.id,
        kind: "deposit_required",
        title: `Deposit Required: ${deal?.name ?? "Deal"}`,
        body: `$${tier.amount.toLocaleString()} deposit (${tier.tier}) required for equipment valued at $${body.equipment_value.toLocaleString()}.`,
        deal_id: body.deal_id,
        metadata: {
          deposit_id: deposit.id,
          tier: tier.tier,
          amount: tier.amount,
          equipment_value: body.equipment_value,
        },
      }));

      await supabaseAdmin
        .from("crm_in_app_notifications")
        .insert(notifications);
    }

    return safeJsonOk({
      deposit,
      tier: {
        name: tier.tier,
        amount: tier.amount,
        refund_policy: tier.refund_policy,
      },
    }, origin, 201);
  } catch (err) {
    captureEdgeException(err, { fn: "deposit-calculator", req });
    console.error("deposit-calculator error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
