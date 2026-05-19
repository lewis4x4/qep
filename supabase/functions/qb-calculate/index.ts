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
 * Tax: delegates jurisdiction lookup to the tax-calculator edge function using
 * deliveryState + deliveryCounty, then feeds the effective rate into the
 * deterministic pricing engine.
 */

import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { calculateQuote } from "../../../apps/web/src/lib/pricing/calculator.ts";
import { PricingError } from "../../../apps/web/src/lib/pricing/errors.ts";
import type {
  PriceQuoteRequest,
  ProgramFixture,
  QuoteContext,
} from "../../../apps/web/src/lib/pricing/types.ts";

type QuoteRequestWithTaxFields = PriceQuoteRequest & {
  branchSlug?: string;
  branch_slug?: string;
  companyId?: string;
  company_id?: string;
  deliveryCounty?: string;
  delivery_county?: string;
  taxProfile?: string;
  tax_profile?: string;
  taxOverrideAmount?: number | null;
  tax_override_amount?: number | null;
  taxOverrideReason?: string | null;
  tax_override_reason?: string | null;
};

type TaxRateResolution =
  | { ok: true; taxRatePct: number }
  | { ok: false; response: Response };

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberField(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function resolveTaxRatePct(params: {
  req: Request;
  origin: string | null;
  request: PriceQuoteRequest;
  preliminaryQuote: ReturnType<typeof calculateQuote>;
}): Promise<TaxRateResolution> {
  const { req, origin, request, preliminaryQuote } = params;
  if (request.taxExempt) return { ok: true, taxRatePct: 0 };

  const taxableBaseCents = preliminaryQuote.customerPriceAfterRebatesCents;
  if (taxableBaseCents <= 0) return { ok: true, taxRatePct: 0 };

  const extended = request as QuoteRequestWithTaxFields;
  const deliveryState = request.deliveryState.trim().toUpperCase();
  const deliveryCounty = stringField(extended.deliveryCounty) ??
    stringField(extended.delivery_county);
  if (deliveryState === "FL" && !deliveryCounty) {
    return {
      ok: false,
      response: safeJsonError(
        "deliveryCounty is required for Florida county tax calculation",
        400,
        origin,
      ),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const authorization = req.headers.get("authorization") ??
    req.headers.get("Authorization");
  if (!supabaseUrl || !authorization) {
    return {
      ok: false,
      response: safeJsonError(
        "Tax calculator configuration or authorization is missing",
        500,
        origin,
      ),
    };
  }

  const taxResponse = await fetch(
    `${supabaseUrl}/functions/v1/tax-calculator`,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch_slug: stringField(extended.branch_slug) ??
          stringField(extended.branchSlug),
        company_id: stringField(extended.company_id) ??
          stringField(extended.companyId),
        subtotal: taxableBaseCents / 100,
        discount_total: 0,
        trade_allowance: 0,
        tax_profile: stringField(extended.tax_profile) ??
          stringField(extended.taxProfile) ?? "standard",
        delivery_state: deliveryState,
        delivery_county: deliveryCounty,
        tax_override_amount: numberField(extended.tax_override_amount) ??
          numberField(extended.taxOverrideAmount),
        tax_override_reason: stringField(extended.tax_override_reason) ??
          stringField(extended.taxOverrideReason),
        include_179: false,
      }),
    },
  );

  const taxBody = await taxResponse.json().catch(() => null) as {
    error?: string;
    total_tax?: unknown;
  } | null;
  if (!taxResponse.ok) {
    return {
      ok: false,
      response: safeJsonError(
        taxBody?.error ?? `Tax calculation failed (${taxResponse.status})`,
        taxResponse.status,
        origin,
      ),
    };
  }

  const totalTaxDollars = Number(taxBody?.total_tax ?? 0);
  if (!Number.isFinite(totalTaxDollars) || totalTaxDollars < 0) {
    return {
      ok: false,
      response: safeJsonError(
        "Tax calculator returned an invalid total_tax",
        502,
        origin,
      ),
    };
  }

  const totalTaxCents = Math.round(totalTaxDollars * 100);
  return { ok: true, taxRatePct: totalTaxCents / taxableBaseCents };
}

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

    const freightCents = frameSize === "small"
      ? (freightZone.freight_small_cents ?? freightZone.freight_large_cents)
      : freightZone.freight_large_cents;

    // ── 3. Active programs for this brand ─────────────────────────────────
    // F1 fix: qb_programs uses `active` (not `is_active`), `effective_from`/`effective_to` (not start_date/end_date).
    // F4 fix: add date-window filter so expired or future programs are excluded from quotes.
    // `today` is already declared above for the freight-zone window; reuse it.
    const { data: programRows, error: progErr } = await supabase
      .from("qb_programs")
      .select(
        "id, program_type, name, brand_id, active, effective_from, effective_to, details",
      )
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
      taxRatePct: 0,
      programs,
      catalogAttachments,
    };

    const preliminaryQuote = calculateQuote(request, ctx);
    const taxRate = await resolveTaxRatePct({
      req,
      origin,
      request,
      preliminaryQuote,
    });
    if (!taxRate.ok) return taxRate.response;

    const result = calculateQuote(request, {
      ...ctx,
      taxRatePct: taxRate.taxRatePct,
    });
    return safeJsonOk(result, origin);
  } catch (err) {
    if (err instanceof PricingError) {
      return safeJsonError(
        JSON.stringify({
          code: err.code,
          message: err.message,
          details: err.details,
        }),
        400,
        origin,
      );
    }
    // Unexpected — log and return generic error
    console.error("[qb-calculate] unexpected error:", err);
    return safeJsonError(
      "Something went wrong calculating the quote. Try again or contact support.",
      500,
      origin,
    );
  }
});
