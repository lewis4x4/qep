/**
 * qb-calculate — Quote Builder pricing Edge Function
 *
 * Wraps the deterministic pricing engine so calculation runs server-side and
 * cannot be tampered with in the browser. Clients call via:
 *   supabase.functions.invoke('qb-calculate', { body: request })
 *
 * Auth: requireServiceUser() from _shared/service-auth.ts
 *   - Requires valid user JWT (all roles permitted).
 *   - Rejects bare service_role key — use user session.
 *
 * Corrections vs. pre-Slice-01 spec:
 *   - Function name: qb-calculate (not calculate-quote)
 *   - Auth: requireServiceUser(), not a generic serve() wrapper
 *   - All IDs: string UUIDs (not number)
 *   - Table names: qb_* prefix throughout
 *   - discount_configured guard: surfaced as 400 with clear message
 *
 * Slice 02 note: taxRatePct is hardcoded to 0.07 (7% FL generic).
 * Slice 03+: call the existing tax-calculator edge fn with deliveryState/deliveryZip.
 */

import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonOk,
  safeJsonError,
} from "../_shared/safe-cors.ts";
import { calculateQuote } from "../../../apps/web/src/lib/pricing/calculator.ts";
import { PricingError } from "../../../apps/web/src/lib/pricing/errors.ts";
import type {
  PriceQuoteRequest,
  QuoteContext,
  ProgramFixture,
} from "../../../apps/web/src/lib/pricing/types.ts";

// ── Florida generic tax rate (stub) ──────────────────────────────────────────
// TODO(slice-03): replace with a call to the existing tax-calculator edge fn
//   using request.deliveryState + request.deliveryZip for county-level precision.
const FL_TAX_RATE_PCT = 0.07;

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  // Auth — user JWT required
  const auth = await requireServiceUser(
    req.headers.get("authorization"),
    origin,
  );
  if (!auth.ok) return auth.response;

  // Parse request body
  let request: PriceQuoteRequest;
  try {
    request = await req.json() as PriceQuoteRequest;
  } catch {
    return safeJsonError("Request body must be valid JSON", 400, origin);
  }

  if (!request.equipmentModelId) {
    return safeJsonError("equipmentModelId is required", 400, origin);
  }
  if (!request.deliveryState) {
    return safeJsonError("deliveryState is required", 400, origin);
  }

  const { supabase } = auth;

  try {
    // ── 1. Fetch model + brand ─────────────────────────────────────────────
    const { data: model, error: modelErr } = await supabase
      .from("qb_equipment_models")
      .select(`
        id,
        model_code,
        name_display,
        list_price_cents,
        frame_size,
        workspace_id,
        brand:qb_brands (
          id,
          code,
          name,
          discount_configured,
          dealer_discount_pct,
          markup_target_pct,
          markup_floor_pct,
          tariff_pct,
          pdi_default_cents,
          good_faith_pct,
          attachment_markup_pct
        )
      `)
      .eq("id", request.equipmentModelId)
      .is("deleted_at", null)
      .single();

    if (modelErr || !model) {
      return safeJsonError(
        `Machine ${request.equipmentModelId} wasn't found in the catalog. It may have been removed.`,
        404,
        origin,
      );
    }

    // Supabase returns joined rows as arrays for one-to-many but as objects
    // for foreign key (many-to-one) joins. Cast brand accordingly.
    const brand = Array.isArray(model.brand) ? model.brand[0] : model.brand;
    if (!brand) {
      return safeJsonError(
        `Brand data missing for machine ${request.equipmentModelId}. Contact support.`,
        500,
        origin,
      );
    }

    // ── 2. Freight zone lookup ─────────────────────────────────────────────
    // Slice-07 C1 fix: qb_freight_zones actually uses freight_large_cents /
    // freight_small_cents / zone_name (not large_frame_cents / small_frame_cents
    // / zone_code), and there is no is_active column — active zones are
    // expressed via effective_from / effective_to. The prior column names were
    // a drift between the Slice-02 stub and the Slice-04 schema (migration 284).
    const frameSize = model.frame_size ?? "large";
    const today = new Date().toISOString().slice(0, 10);
    const { data: freightZone, error: freightErr } = await supabase
      .from("qb_freight_zones")
      .select("freight_large_cents, freight_small_cents, zone_name")
      .eq("brand_id", brand.id)
      .contains("state_codes", [request.deliveryState])
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (freightErr) {
      return safeJsonError(
        `Freight lookup failed for ${brand.name} to ${request.deliveryState}: ${freightErr.message}`,
        500,
        origin,
      );
    }
    if (!freightZone) {
      return safeJsonError(
        `No freight rate configured for ${brand.name} to ${request.deliveryState}. Add a freight zone in Admin → Price Sheets.`,
        400,
        origin,
      );
    }

    const freightCents =
      frameSize === "small"
        ? (freightZone.freight_small_cents ?? freightZone.freight_large_cents)
        : freightZone.freight_large_cents;

    // ── 3. Active programs for this brand ─────────────────────────────────
    // F1 fix: qb_programs uses `active` (not `is_active`), `effective_from`/`effective_to` (not start_date/end_date).
    // F4 fix: add date-window filter so expired or future programs are excluded from quotes.
    // `today` is already declared above for the freight-zone window; reuse it.
    const { data: programRows, error: progErr } = await supabase
      .from("qb_programs")
      .select("id, program_type, name, brand_id, active, effective_from, effective_to, details")
      .eq("brand_id", brand.id)
      .eq("active", true)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .is("deleted_at", null);

    if (progErr) {
      return safeJsonError(
        `Program lookup failed: ${progErr.message}`,
        500,
        origin,
      );
    }

    const programs: ProgramFixture[] = (programRows ?? []).map((r) => ({
      id: r.id as string,
      programType: r.program_type as ProgramFixture["programType"],
      name: r.name as string,
      brandId: r.brand_id as string,
      isActive: r.active as boolean,
      startDate: r.effective_from as string,
      endDate: r.effective_to as string | null,
      details: (r.details ?? {}) as Record<string, unknown>,
    }));

    // ── 4. Catalog attachments the request references ─────────────────────
    const requestedAttachmentIds = (request.attachments ?? []).map(
      (a) => a.attachmentId,
    );

    let catalogAttachments: QuoteContext["catalogAttachments"] = [];
    if (requestedAttachmentIds.length > 0) {
      const { data: attRows, error: attErr } = await supabase
        .from("qb_attachments")
        .select(
          "id, name, list_price_cents, oem_branded, compatible_model_ids, universal",
        )
        .in("id", requestedAttachmentIds)
        .is("deleted_at", null);

      if (attErr) {
        return safeJsonError(
          `Attachment lookup failed: ${attErr.message}`,
          500,
          origin,
        );
      }

      catalogAttachments = (attRows ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        list_price_cents: r.list_price_cents as number,
        oem_branded: r.oem_branded as boolean,
        compatible_model_ids: r.compatible_model_ids as string[] | null,
        universal: r.universal as boolean,
      }));
    }

    // ── 5. Build context and calculate ────────────────────────────────────
    const ctx: QuoteContext = {
      model: {
        id: model.id as string,
        model_code: model.model_code as string,
        name_display: model.name_display as string,
        list_price_cents: model.list_price_cents as number,
        frame_size: model.frame_size as string | null,
        workspace_id: model.workspace_id as string,
        brand: {
          id: brand.id as string,
          code: brand.code as string,
          name: brand.name as string,
          discount_configured: brand.discount_configured as boolean,
          dealer_discount_pct: brand.dealer_discount_pct as number,
          markup_target_pct: brand.markup_target_pct as number,
          markup_floor_pct: brand.markup_floor_pct as number,
          tariff_pct: brand.tariff_pct as number,
          pdi_default_cents: brand.pdi_default_cents as number,
          good_faith_pct: brand.good_faith_pct as number,
          attachment_markup_pct: brand.attachment_markup_pct as number,
        },
      },
      freightCents: freightCents as number,
      freightZone: freightZone.zone_name as string,
      taxRatePct: FL_TAX_RATE_PCT,
      programs,
      catalogAttachments,
    };

    const result = calculateQuote(request, ctx);
    return safeJsonOk(result, origin);
  } catch (err) {
    if (err instanceof PricingError) {
      return safeJsonError(
        JSON.stringify({ code: err.code, message: err.message, details: err.details }),
        400,
        origin,
      );
    }
    // Unexpected — log and return generic error
    console.error("[qb-calculate] unexpected error:", err);
    return safeJsonError("Something went wrong calculating the quote. Try again or contact support.", 500, origin);
  }
});
