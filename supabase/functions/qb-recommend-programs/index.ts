/**
 * qb-recommend-programs — Program Recommender Edge Function
 *
 * POST /qb-recommend-programs
 * Body: QuoteContext (brandId, equipmentModelId, modelCode, modelYear,
 *       customerType, gmuDetails?, isRentalFleetPurchase?, dealDate, listPriceCents,
 *       equipmentCostCents, baselineSalesPriceCents, markupPct)
 *
 * Returns:
 *   {
 *     recommendations: ProgramRecommendation[],
 *     scenarios:       QuoteScenario[],
 *     stackingWarnings: string[]
 *   }
 *
 * Auth: requireServiceUser() — requires valid user JWT (all roles).
 * Service role key is rejected — use user session.
 *
 * Corrections vs. pre-Slice-01 greenfield spec:
 *   - Table is qb_programs (not programs).
 *   - All IDs are string UUIDs.
 *   - dealDate is ISO string in the body; parsed to Date before passing to engine.
 *   - .ts extensions required on all relative imports (Deno).
 */

import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonOk,
  safeJsonError,
} from "../_shared/safe-cors.ts";
import { recommendPrograms } from "../../../apps/web/src/lib/programs/recommender.ts";
import { buildScenarios } from "../../../apps/web/src/lib/programs/scenarios.ts";
import { validateStackingFromDB } from "../../../apps/web/src/lib/programs/stacking-db.ts";
import type { QuoteContext } from "../../../apps/web/src/lib/programs/types.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await requireServiceUser(req.headers.get("authorization"), origin);
  if (!auth.ok) return auth.response;

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Request body must be valid JSON", 400, origin);
  }

  // Required fields
  const {
    brandId,
    equipmentModelId,
    modelCode,
    customerType,
    dealDate: dealDateRaw,
    listPriceCents,
    // Optional
    modelYear,
    gmuDetails,
    isRentalFleetPurchase,
    equipmentCostCents,
    baselineSalesPriceCents,
    markupPct,
  } = body as Record<string, any>;

  if (!brandId || !equipmentModelId || !modelCode || !customerType || !dealDateRaw || !listPriceCents) {
    return safeJsonError(
      "Missing required fields: brandId, equipmentModelId, modelCode, customerType, dealDate, listPriceCents",
      400,
      origin,
    );
  }

  if (!["standard", "gmu"].includes(customerType)) {
    return safeJsonError("customerType must be 'standard' or 'gmu'", 400, origin);
  }

  let dealDate: Date;
  try {
    dealDate = new Date(dealDateRaw);
    if (isNaN(dealDate.getTime())) throw new Error("invalid");
  } catch {
    return safeJsonError("dealDate must be a valid ISO date string (e.g. '2026-02-15')", 400, origin);
  }

  const context: QuoteContext = {
    brandId: String(brandId),
    equipmentModelId: String(equipmentModelId),
    modelCode: String(modelCode),
    modelYear: modelYear != null ? Number(modelYear) : null,
    customerType: customerType as "standard" | "gmu",
    gmuDetails: gmuDetails as QuoteContext["gmuDetails"],
    isRentalFleetPurchase: Boolean(isRentalFleetPurchase),
    dealDate,
    listPriceCents: Number(listPriceCents),
  };

  // ── Recommend ───────────────────────────────────────────────────────────────
  let recommendations;
  try {
    recommendations = await recommendPrograms(context, auth.supabase as any);
  } catch (err: any) {
    console.error("[qb-recommend-programs] recommendPrograms error:", err);
    return safeJsonError(`Failed to load programs: ${err.message}`, 500, origin);
  }

  // ── Stacking — check the eligible program IDs ────────────────────────────────
  const eligibleIds = recommendations
    .filter((r) => r.eligibility.eligible)
    .map((r) => r.programId);

  const stackingResult = await validateStackingFromDB(
    { programIds: eligibleIds, customerType: context.customerType },
    auth.supabase as any,
  );

  // ── Scenarios ────────────────────────────────────────────────────────────────
  const scenarios = buildScenarios({
    context,
    recommendations,
    equipmentCostCents: Number(equipmentCostCents ?? 0),
    baselineSalesPriceCents: Number(baselineSalesPriceCents ?? listPriceCents),
    markupPct: Number(markupPct ?? 0),
  });

  // ── Response ─────────────────────────────────────────────────────────────────
  return safeJsonOk(
    {
      recommendations,
      scenarios,
      stackingWarnings: stackingResult.warnings,
      stackingViolations: stackingResult.violations,
    },
    origin,
  );
});
