/**
 * publish-price-sheet — Catalog Apply Edge Function (Slice 04)
 *
 * POST /publish-price-sheet
 * Body: { priceSheetId: string }
 *
 * Flow:
 *   1. Load qb_price_sheets row — must be in 'extracted' status.
 *   2. Optimistic guard: set status → 'extracting' (re-used as publish-in-progress
 *      mutex; prevents double-publish without a schema migration).
 *   3. Load all approved qb_price_sheet_items and qb_price_sheet_programs.
 *   4. Apply each approved item to the catalog:
 *        model create   → INSERT qb_equipment_models
 *        model update   → UPDATE qb_equipment_models SET ... WHERE id = proposed_model_id
 *        attachment create/update → qb_attachments
 *        freight create → INSERT qb_freight_zones
 *        freight update → look up by brand+state_codes, then UPDATE
 *        program create → INSERT qb_programs
 *        program update → UPDATE qb_programs WHERE id = proposed_program_id
 *        no_change/skip → mark applied, no catalog mutation
 *   5. Mark each applied item: applied_at = now().
 *   6. Supersede prior published sheets for same brand+sheet_type.
 *   7. Set sheet status = 'published', published_at = now(), reviewed_by = userId.
 *
 * Auth: requireServiceUser() — valid user JWT, roles: admin/manager/owner.
 *
 * Important: all relative imports use .ts extension (Deno requirement).
 * No @/ path aliases — they don't resolve in Deno.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonOk, safeJsonError } from "../_shared/safe-cors.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriceSheetRow {
  id: string;
  brand_id: string;
  sheet_type: string | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  workspace_id: string;
}

interface PriceSheetItem {
  id: string;
  item_type: "model" | "attachment" | "freight" | "note";
  extracted: Record<string, unknown>;
  proposed_model_id: string | null;
  proposed_attachment_id: string | null;
  action: "create" | "update" | "no_change" | "skip";
  review_status: string;
}

interface PriceSheetProgram {
  id: string;
  program_code: string;
  program_type: string;
  extracted: Record<string, unknown>;
  proposed_program_id: string | null;
  action: "create" | "update" | "no_change" | "skip";
  review_status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve model codes to their UUID catalog IDs for compatible_model_ids. */
async function resolveModelIds(
  modelCodes: string[],
  brandId: string,
  serviceClient: ReturnType<typeof createClient>,
): Promise<string[]> {
  if (!modelCodes?.length) return [];
  const { data } = await serviceClient
    .from("qb_equipment_models")
    .select("id, model_code")
    .eq("brand_id", brandId)
    .in("model_code", modelCodes);
  return (data ?? []).map((r: any) => r.id);
}

/** Apply a single model item to the catalog. Returns the catalog row id. */
async function applyModel(
  item: PriceSheetItem,
  sheet: PriceSheetRow,
  serviceClient: ReturnType<typeof createClient>,
): Promise<{ ok: boolean; catalogId?: string; error?: string }> {
  const ext = item.extracted as any;

  if (item.action === "create") {
    const { data, error } = await serviceClient
      .from("qb_equipment_models")
      .insert({
        workspace_id: sheet.workspace_id,
        brand_id: sheet.brand_id,
        model_code: ext.model_code,
        family: ext.family ?? null,
        name_display: ext.name_display ?? ext.model_code,
        standard_config: ext.standard_config ?? null,
        list_price_cents: ext.list_price_cents,
        specs: ext.specs ?? null,
        active: true,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: data.id };
  }

  if (item.action === "update" && item.proposed_model_id) {
    const updates: Record<string, unknown> = {};
    if (ext.list_price_cents !== undefined) updates.list_price_cents = ext.list_price_cents;
    if (ext.family !== undefined) updates.family = ext.family;
    if (ext.name_display !== undefined) updates.name_display = ext.name_display;
    if (ext.standard_config !== undefined) updates.standard_config = ext.standard_config;
    if (ext.specs !== undefined) updates.specs = ext.specs;

    const { error } = await serviceClient
      .from("qb_equipment_models")
      .update(updates)
      .eq("id", item.proposed_model_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: item.proposed_model_id };
  }

  // no_change / skip — no mutation
  return { ok: true, catalogId: item.proposed_model_id ?? undefined };
}

/** Apply a single attachment item to the catalog. */
async function applyAttachment(
  item: PriceSheetItem,
  sheet: PriceSheetRow,
  serviceClient: ReturnType<typeof createClient>,
): Promise<{ ok: boolean; catalogId?: string; error?: string }> {
  const ext = item.extracted as any;

  if (item.action === "create") {
    const compatibleIds = await resolveModelIds(
      ext.compatible_model_codes ?? [],
      sheet.brand_id,
      serviceClient,
    );
    const { data, error } = await serviceClient
      .from("qb_attachments")
      .insert({
        workspace_id: sheet.workspace_id,
        brand_id: sheet.brand_id,
        part_number: ext.part_number,
        name: ext.name,
        category: ext.category ?? null,
        list_price_cents: ext.list_price_cents,
        attachment_type: ext.attachment_type ?? null,
        compatible_model_ids: compatibleIds.length > 0 ? compatibleIds : null,
        active: true,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: data.id };
  }

  if (item.action === "update" && item.proposed_attachment_id) {
    const updates: Record<string, unknown> = {};
    if (ext.list_price_cents !== undefined) updates.list_price_cents = ext.list_price_cents;
    if (ext.name !== undefined) updates.name = ext.name;
    if (ext.category !== undefined) updates.category = ext.category;
    if (ext.attachment_type !== undefined) updates.attachment_type = ext.attachment_type;

    if (ext.compatible_model_codes?.length) {
      const compatibleIds = await resolveModelIds(
        ext.compatible_model_codes,
        sheet.brand_id,
        serviceClient,
      );
      if (compatibleIds.length > 0) updates.compatible_model_ids = compatibleIds;
    }

    const { error } = await serviceClient
      .from("qb_attachments")
      .update(updates)
      .eq("id", item.proposed_attachment_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: item.proposed_attachment_id };
  }

  return { ok: true, catalogId: item.proposed_attachment_id ?? undefined };
}

/** Apply a single freight zone item to the catalog. */
async function applyFreight(
  item: PriceSheetItem,
  sheet: PriceSheetRow,
  serviceClient: ReturnType<typeof createClient>,
): Promise<{ ok: boolean; catalogId?: string; error?: string }> {
  const ext = item.extracted as any;

  if (item.action === "create") {
    const { data, error } = await serviceClient
      .from("qb_freight_zones")
      .insert({
        workspace_id: sheet.workspace_id,
        brand_id: sheet.brand_id,
        zone_name: ext.zone_name ?? ext.state_codes?.join("/") ?? "Unknown",
        state_codes: ext.state_codes,
        freight_large_cents: ext.freight_large_cents,
        freight_small_cents: ext.freight_small_cents,
        effective_from: sheet.effective_from ?? null,
        effective_to: sheet.effective_to ?? null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: data.id };
  }

  if (item.action === "update") {
    // Re-lookup existing zone by brand + overlapping state_codes
    const { data: existing, error: lookupErr } = await serviceClient
      .from("qb_freight_zones")
      .select("id")
      .eq("brand_id", sheet.brand_id)
      .contains("state_codes", ext.state_codes)
      .maybeSingle();

    if (lookupErr || !existing) {
      // Fallback: insert as new zone
      const { data, error } = await serviceClient
        .from("qb_freight_zones")
        .insert({
          workspace_id: sheet.workspace_id,
          brand_id: sheet.brand_id,
          zone_name: ext.zone_name ?? ext.state_codes?.join("/") ?? "Unknown",
          state_codes: ext.state_codes,
          freight_large_cents: ext.freight_large_cents,
          freight_small_cents: ext.freight_small_cents,
          effective_from: sheet.effective_from ?? null,
          effective_to: sheet.effective_to ?? null,
        })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, catalogId: data.id };
    }

    const { error } = await serviceClient
      .from("qb_freight_zones")
      .update({
        freight_large_cents: ext.freight_large_cents,
        freight_small_cents: ext.freight_small_cents,
        zone_name: ext.zone_name ?? existing.zone_name,
        effective_from: sheet.effective_from ?? null,
        effective_to: sheet.effective_to ?? null,
      })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: existing.id };
  }

  return { ok: true };
}

/** Apply a single program to the catalog. */
/**
 * F5 fix: normalize `low_rate_financing` program details from the nested-array
 * shape that Claude extracts (details.terms[], details.lenders[]) to the flat
 * scalar shape that the pricing engine reads (term_months, rate_pct,
 * dealer_participation_pct, lender_name). The original arrays are preserved
 * under details.all_terms and details.all_lenders so nothing is lost.
 *
 * Selection rule: pick the term with the lowest rate_pct; break ties by
 * preferring term months closest to 60. This gives the "headline" term for
 * calculator display while all terms remain available for the UI.
 */
function normalizeFinancingDetails(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.terms) || raw.terms.length === 0) return raw;

  const terms = raw.terms as Array<{
    months?: number;
    rate_pct?: number;
    dealer_participation_pct?: number;
  }>;

  // Sort: lowest rate first; tie-break by closest to 60 months
  const sorted = [...terms].sort((a, b) => {
    const rateDiff = (a.rate_pct ?? 0) - (b.rate_pct ?? 0);
    if (rateDiff !== 0) return rateDiff;
    return Math.abs((a.months ?? 60) - 60) - Math.abs((b.months ?? 60) - 60);
  });
  const primary = sorted[0];

  const lenders = Array.isArray(raw.lenders) ? raw.lenders : [];
  const primaryLender = (lenders[0] as Record<string, unknown> | undefined) ?? {};

  return {
    ...raw,
    // Flat scalars the calculator reads:
    term_months: primary.months ?? 60,
    rate_pct: primary.rate_pct ?? 0,
    dealer_participation_pct: primary.dealer_participation_pct ?? 0,
    lender_name: (primaryLender.name as string | undefined) ?? "Manufacturer Financing",
    // Preserve originals so nothing is lost:
    all_terms: terms,
    all_lenders: lenders,
  };
}

async function applyProgram(
  prog: PriceSheetProgram,
  sheet: PriceSheetRow,
  serviceClient: ReturnType<typeof createClient>,
): Promise<{ ok: boolean; catalogId?: string; error?: string }> {
  const ext = prog.extracted as any;
  // Dates: prefer sheet-level dates, fall back to today / +90 days
  const effectiveFrom = sheet.effective_from ?? new Date().toISOString().slice(0, 10);
  const effectiveTo =
    sheet.effective_to ??
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Normalize details: flatten financing term arrays → scalar fields the calculator needs
  let details: Record<string, unknown> = ext.details ?? {};
  if (prog.program_type === "low_rate_financing") {
    details = normalizeFinancingDetails(details);
  }

  if (prog.action === "create") {
    const { data, error } = await serviceClient
      .from("qb_programs")
      .insert({
        workspace_id: sheet.workspace_id,
        brand_id: sheet.brand_id,
        program_code: prog.program_code,
        program_type: prog.program_type,
        name: ext.name ?? prog.program_code,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        details,
        active: true,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: data.id };
  }

  if (prog.action === "update" && prog.proposed_program_id) {
    const updates: Record<string, unknown> = {
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      active: true,
    };
    if (ext.name) updates.name = ext.name;
    if (ext.details) updates.details = details; // use normalized details

    const { error } = await serviceClient
      .from("qb_programs")
      .update(updates)
      .eq("id", prog.proposed_program_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalogId: prog.proposed_program_id };
  }

  // no_change / skip
  return { ok: true, catalogId: prog.proposed_program_id ?? undefined };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireServiceUser(req.headers.get("authorization"), origin);
  if (!auth.ok) return auth.response;
  const { supabase, userId } = auth;

  if (!["admin", "manager", "owner"].includes(auth.role)) {
    return safeJsonError("Price sheet publish requires admin, manager, or owner role", 403, origin);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let priceSheetId: string;
  try {
    const body = await req.json();
    priceSheetId = body?.priceSheetId;
    if (!priceSheetId) throw new Error("priceSheetId required");
  } catch (e: any) {
    return safeJsonError(`Invalid request body: ${e.message}`, 400, origin);
  }

  // ── Load sheet ────────────────────────────────────────────────────────────
  const { data: sheet, error: sheetErr } = await supabase
    .from("qb_price_sheets")
    .select("id, brand_id, sheet_type, status, effective_from, effective_to, workspace_id")
    .eq("id", priceSheetId)
    .single();

  if (sheetErr || !sheet) {
    return safeJsonError(`Price sheet not found: ${priceSheetId}`, 404, origin);
  }

  // F3 fix: replace two-step status-check + flip (TOCTOU race) with a single
  // conditional UPDATE. Only one concurrent caller can win the CAS; the other
  // will see 0 rows updated and receive 409 without ever touching the catalog.
  const { data: claim, error: claimErr } = await supabase
    .from("qb_price_sheets")
    .update({ status: "extracting" })
    .eq("id", priceSheetId)
    .eq("status", "extracted")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    return safeJsonError(`Failed to claim publish slot: ${claimErr.message}`, 500, origin);
  }
  if (!claim) {
    // Either already publishing or not in 'extracted' state — safe 409.
    return safeJsonError(
      `Sheet is not in 'extracted' state or a publish is already in flight for sheet ${priceSheetId}`,
      409,
      origin,
    );
  }

  // Service client for catalog writes (bypasses RLS)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ── Load approved items ───────────────────────────────────────────────────
  const { data: items, error: itemsErr } = await serviceClient
    .from("qb_price_sheet_items")
    .select("id, item_type, extracted, proposed_model_id, proposed_attachment_id, action, review_status")
    .eq("price_sheet_id", priceSheetId)
    .eq("review_status", "approved");

  if (itemsErr) {
    await serviceClient
      .from("qb_price_sheets")
      .update({ status: "extracted" }) // roll back guard
      .eq("id", priceSheetId);
    return safeJsonError(`Failed to load sheet items: ${itemsErr.message}`, 500, origin);
  }

  const { data: programs, error: progsErr } = await serviceClient
    .from("qb_price_sheet_programs")
    .select("id, program_code, program_type, extracted, proposed_program_id, action, review_status")
    .eq("price_sheet_id", priceSheetId)
    .eq("review_status", "approved");

  if (progsErr) {
    await serviceClient
      .from("qb_price_sheets")
      .update({ status: "extracted" })
      .eq("id", priceSheetId);
    return safeJsonError(`Failed to load sheet programs: ${progsErr.message}`, 500, origin);
  }

  // ── Apply items to catalog ────────────────────────────────────────────────
  const appliedItemIds: string[] = [];
  const skippedItems: Array<{ id: string; reason: string }> = [];
  const sheetRow = sheet as PriceSheetRow;

  for (const rawItem of (items ?? []) as PriceSheetItem[]) {
    let result: { ok: boolean; catalogId?: string; error?: string };

    if (rawItem.item_type === "model") {
      result = await applyModel(rawItem, sheetRow, serviceClient);
    } else if (rawItem.item_type === "attachment") {
      result = await applyAttachment(rawItem, sheetRow, serviceClient);
    } else if (rawItem.item_type === "freight") {
      result = await applyFreight(rawItem, sheetRow, serviceClient);
    } else {
      // note — no catalog mutation
      result = { ok: true };
    }

    if (result.ok) {
      appliedItemIds.push(rawItem.id);
    } else {
      skippedItems.push({ id: rawItem.id, reason: result.error ?? "unknown" });
      console.warn(`[publish-price-sheet] Item ${rawItem.id} (${rawItem.item_type}) failed: ${result.error}`);
    }
  }

  // Mark applied items
  if (appliedItemIds.length > 0) {
    await serviceClient
      .from("qb_price_sheet_items")
      .update({ applied_at: new Date().toISOString() })
      .in("id", appliedItemIds);
  }

  // ── Apply programs to catalog ─────────────────────────────────────────────
  const appliedProgramIds: string[] = [];
  const skippedPrograms: Array<{ id: string; reason: string }> = [];

  for (const rawProg of (programs ?? []) as PriceSheetProgram[]) {
    const result = await applyProgram(rawProg, sheetRow, serviceClient);
    if (result.ok) {
      appliedProgramIds.push(rawProg.id);
    } else {
      skippedPrograms.push({ id: rawProg.id, reason: result.error ?? "unknown" });
      console.warn(
        `[publish-price-sheet] Program ${rawProg.id} (${rawProg.program_code}) failed: ${result.error}`,
      );
    }
  }

  if (appliedProgramIds.length > 0) {
    await serviceClient
      .from("qb_price_sheet_programs")
      .update({ applied_at: new Date().toISOString() })
      .in("id", appliedProgramIds);
  }

  // ── Supersede prior published sheets for this brand+sheet_type ───────────
  const sheetType = sheet.sheet_type ?? "price_book";
  // For 'both' sheet_type, supersede both price_book and retail_programs prior sheets
  const supersedableTypes =
    sheetType === "both"
      ? ["price_book", "retail_programs", "both"]
      : [sheetType, "both"];

  await serviceClient
    .from("qb_price_sheets")
    .update({ status: "superseded" })
    .eq("brand_id", sheet.brand_id)
    .in("sheet_type", supersedableTypes)
    .eq("status", "published")
    .neq("id", priceSheetId);

  // ── Publish ───────────────────────────────────────────────────────────────
  await serviceClient
    .from("qb_price_sheets")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", priceSheetId);

  const summary = {
    itemsApplied: appliedItemIds.length,
    itemsSkipped: skippedItems.length,
    programsApplied: appliedProgramIds.length,
    programsSkipped: skippedPrograms.length,
    skippedDetails: skippedItems.length + skippedPrograms.length > 0
      ? { items: skippedItems, programs: skippedPrograms }
      : undefined,
  };

  console.log(
    `[publish-price-sheet] Sheet ${priceSheetId} published: ${appliedItemIds.length} items, ${appliedProgramIds.length} programs applied.`,
  );

  return safeJsonOk(
    {
      priceSheetId,
      status: "published",
      ...summary,
    },
    origin,
  );
});
