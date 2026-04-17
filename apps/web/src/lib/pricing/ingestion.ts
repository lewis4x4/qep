/**
 * QEP Price Sheet Ingestion — Diff Engine (Slice 04)
 *
 * detectAction() compares an extracted item from Claude against the existing
 * qb_equipment_models / qb_attachments / qb_freight_zones catalog and returns
 * what action should be taken: create, update, no_change, or skip.
 *
 * Pure / testable:
 *  - DB I/O is injected via SupabaseLike (same pattern as programs/stacking-db.ts)
 *  - No direct Supabase import — works in both Bun tests and Deno edge functions
 *
 * Money: all monetary values are integer cents throughout.
 */

// ── Duck-typed Supabase client (Deno-compatible) ──────────────────────────────

interface SupabaseLike {
  from: (table: string) => any;
}

// ── Extracted item shapes (from Claude JSON response) ────────────────────────

export interface ExtractedModel {
  model_code: string;
  family?: string;
  name_display?: string;
  standard_config?: string;
  list_price_cents: number;
  specs?: Record<string, unknown>;
  notes?: string;
}

export interface ExtractedAttachment {
  part_number: string;
  name: string;
  category?: string;
  list_price_cents: number;
  compatible_model_codes?: string[];
  attachment_type?: "factory_option" | "field_install" | "recommended_bucket";
}

export interface ExtractedFreightZone {
  state_codes: string[];
  zone_name?: string;
  freight_large_cents: number;
  freight_small_cents: number;
}

// ── Action result ────────────────────────────────────────────────────────────

export type IngestionAction = "create" | "update" | "no_change" | "skip";

export interface ActionResult {
  action: IngestionAction;
  existingId?: string;
  /** Field-level diff for update items: { field: { old: unknown, new: unknown } } */
  changes?: Record<string, { old: unknown; new: unknown }>;
  /** 0.0–1.0 confidence score */
  confidence: number;
  /** Human-readable reason for skip (e.g. missing required field) */
  skipReason?: string;
}

// ── Model diff engine ─────────────────────────────────────────────────────────

export async function detectModelAction(
  extracted: ExtractedModel,
  brandId: string,
  supabase: SupabaseLike,
): Promise<ActionResult> {
  if (!extracted.model_code || extracted.list_price_cents <= 0) {
    return {
      action: "skip",
      confidence: 1.0,
      skipReason: `Missing required field — model_code: "${extracted.model_code}", list_price_cents: ${extracted.list_price_cents}`,
    };
  }

  const { data: existing, error } = await supabase
    .from("qb_equipment_models")
    .select("id, model_code, list_price_cents, standard_config, family, name_display, specs")
    .eq("brand_id", brandId)
    .eq("model_code", extracted.model_code)
    .maybeSingle();

  if (error) {
    return {
      action: "skip",
      confidence: 0.0,
      skipReason: `DB lookup failed: ${error.message}`,
    };
  }

  if (!existing) {
    return { action: "create", confidence: 1.0 };
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (existing.list_price_cents !== extracted.list_price_cents) {
    changes.list_price_cents = { old: existing.list_price_cents, new: extracted.list_price_cents };
  }
  if (extracted.standard_config !== undefined && existing.standard_config !== extracted.standard_config) {
    changes.standard_config = { old: existing.standard_config, new: extracted.standard_config };
  }
  if (extracted.family !== undefined && existing.family !== extracted.family) {
    changes.family = { old: existing.family, new: extracted.family };
  }
  if (extracted.name_display !== undefined && existing.name_display !== extracted.name_display) {
    changes.name_display = { old: existing.name_display, new: extracted.name_display };
  }

  if (Object.keys(changes).length === 0) {
    return { action: "no_change", existingId: existing.id, confidence: 1.0 };
  }

  return { action: "update", existingId: existing.id, changes, confidence: 0.95 };
}

// ── Attachment diff engine ─────────────────────────────────────────────────────

export async function detectAttachmentAction(
  extracted: ExtractedAttachment,
  brandId: string,
  supabase: SupabaseLike,
): Promise<ActionResult> {
  if (!extracted.part_number || !extracted.name || extracted.list_price_cents <= 0) {
    return {
      action: "skip",
      confidence: 1.0,
      skipReason: `Missing required field — part_number: "${extracted.part_number}", name: "${extracted.name}", list_price_cents: ${extracted.list_price_cents}`,
    };
  }

  const { data: existing, error } = await supabase
    .from("qb_attachments")
    .select("id, part_number, name, list_price_cents, category, attachment_type")
    .eq("brand_id", brandId)
    .eq("part_number", extracted.part_number)
    .maybeSingle();

  if (error) {
    return { action: "skip", confidence: 0.0, skipReason: `DB lookup failed: ${error.message}` };
  }

  if (!existing) {
    return { action: "create", confidence: 1.0 };
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (existing.list_price_cents !== extracted.list_price_cents) {
    changes.list_price_cents = { old: existing.list_price_cents, new: extracted.list_price_cents };
  }
  if (extracted.name && existing.name !== extracted.name) {
    changes.name = { old: existing.name, new: extracted.name };
  }
  if (extracted.category !== undefined && existing.category !== extracted.category) {
    changes.category = { old: existing.category, new: extracted.category };
  }

  if (Object.keys(changes).length === 0) {
    return { action: "no_change", existingId: existing.id, confidence: 1.0 };
  }

  return { action: "update", existingId: existing.id, changes, confidence: 0.95 };
}

// ── Freight zone diff engine ──────────────────────────────────────────────────

export async function detectFreightZoneAction(
  extracted: ExtractedFreightZone,
  brandId: string,
  supabase: SupabaseLike,
): Promise<ActionResult> {
  if (
    !extracted.state_codes?.length ||
    extracted.freight_large_cents <= 0 ||
    extracted.freight_small_cents <= 0
  ) {
    return {
      action: "skip",
      confidence: 1.0,
      skipReason: `Missing required field — state_codes: ${JSON.stringify(extracted.state_codes)}, freight amounts must be > 0`,
    };
  }

  // Match on brand_id + overlapping state_codes (contains all states in extracted)
  const { data: existing, error } = await supabase
    .from("qb_freight_zones")
    .select("id, state_codes, freight_large_cents, freight_small_cents, zone_name")
    .eq("brand_id", brandId)
    .contains("state_codes", extracted.state_codes)
    .maybeSingle();

  if (error) {
    return { action: "skip", confidence: 0.0, skipReason: `DB lookup failed: ${error.message}` };
  }

  if (!existing) {
    return { action: "create", confidence: 0.9 };
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (existing.freight_large_cents !== extracted.freight_large_cents) {
    changes.freight_large_cents = { old: existing.freight_large_cents, new: extracted.freight_large_cents };
  }
  if (existing.freight_small_cents !== extracted.freight_small_cents) {
    changes.freight_small_cents = { old: existing.freight_small_cents, new: extracted.freight_small_cents };
  }

  if (Object.keys(changes).length === 0) {
    return { action: "no_change", existingId: existing.id, confidence: 1.0 };
  }

  return { action: "update", existingId: existing.id, changes, confidence: 0.9 };
}
