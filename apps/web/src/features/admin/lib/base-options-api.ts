import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  applyPercentAdjustment,
  attachmentMatchesModel,
  buildCopyModelCode,
} from "./base-options-utils";

type EquipmentModelRow = Database["public"]["Tables"]["qb_equipment_models"]["Row"];
type AttachmentRow = Database["public"]["Tables"]["qb_attachments"]["Row"];

export type BaseOptionsSort = "base" | "make_model" | "class";

export interface BaseOptionsFilters {
  baseNumber: string;
  make: string;
  model: string;
  className: string;
  includeInactive: boolean;
  sortBy: BaseOptionsSort;
}

export interface BaseOptionModelRecord {
  id: string;
  brandId: string;
  brandCode: string;
  brandName: string;
  modelCode: string;
  family: string | null;
  nameDisplay: string;
  standardConfig: string | null;
  listPriceCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  optionCount: number;
}

export interface BaseOptionAttachmentRecord {
  id: string;
  brandId: string | null;
  partNumber: string;
  name: string;
  category: string | null;
  listPriceCents: number;
  compatibleModelIds: string[];
  universal: boolean;
  active: boolean;
  updatedAt: string;
}

export interface SaveBaseOptionModelInput {
  id?: string;
  brandId: string;
  modelCode: string;
  family?: string | null;
  nameDisplay: string;
  standardConfig?: string | null;
  listPriceCents: number;
  active: boolean;
}

export interface SaveBaseOptionAttachmentInput {
  id: string;
  name?: string;
  category?: string | null;
  listPriceCents?: number;
  active?: boolean;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function mapAttachmentRow(row: AttachmentRow): BaseOptionAttachmentRecord {
  return {
    id: row.id,
    brandId: row.brand_id,
    partNumber: row.part_number,
    name: row.name,
    category: row.category,
    listPriceCents: Number(row.list_price_cents ?? 0),
    compatibleModelIds: Array.isArray(row.compatible_model_ids) ? row.compatible_model_ids : [],
    universal: row.universal,
    active: row.active,
    updatedAt: row.updated_at,
  };
}

function sortModels(rows: BaseOptionModelRecord[], sortBy: BaseOptionsSort): BaseOptionModelRecord[] {
  const sorted = [...rows];
  if (sortBy === "class") {
    sorted.sort((a, b) => `${a.family ?? ""}:${a.modelCode}`.localeCompare(`${b.family ?? ""}:${b.modelCode}`));
    return sorted;
  }
  if (sortBy === "make_model") {
    sorted.sort((a, b) => `${a.brandName}:${a.nameDisplay}`.localeCompare(`${b.brandName}:${b.nameDisplay}`));
    return sorted;
  }
  sorted.sort((a, b) => a.modelCode.localeCompare(b.modelCode));
  return sorted;
}

export async function listBaseOptionModels(filters: BaseOptionsFilters): Promise<BaseOptionModelRecord[]> {
  const { data, error } = await supabase
    .from("qb_equipment_models")
    .select(
      "id, brand_id, model_code, family, name_display, standard_config, list_price_cents, active, created_at, updated_at, qb_brands!brand_id(id, code, name)",
    )
    .is("deleted_at", null)
    .limit(400);

  if (error) throw error;

  const rawModels = (data ?? []) as Array<
    EquipmentModelRow & {
      qb_brands: { id: string; code: string; name: string } | Array<{ id: string; code: string; name: string }> | null;
    }
  >;

  const brandIds = Array.from(new Set(rawModels.map((row) => row.brand_id).filter(Boolean)));
  let attachments: BaseOptionAttachmentRecord[] = [];
  if (brandIds.length > 0) {
    const { data: attachmentData, error: attachmentError } = await supabase
      .from("qb_attachments")
      .select("id, brand_id, part_number, name, category, list_price_cents, compatible_model_ids, universal, active, updated_at")
      .in("brand_id", brandIds)
      .is("deleted_at", null)
      .limit(1000);

    if (attachmentError) throw attachmentError;
    attachments = ((attachmentData ?? []) as AttachmentRow[]).map(mapAttachmentRow);
  }

  const filtered = rawModels
    .map((row) => {
      const brandJoin = Array.isArray(row.qb_brands) ? row.qb_brands[0] : row.qb_brands;
      const optionCount = attachments.filter((attachment) =>
        attachmentMatchesModel(attachment, row.id, row.brand_id, filters.includeInactive),
      ).length;
      return {
        id: row.id,
        brandId: row.brand_id,
        brandCode: brandJoin?.code ?? "",
        brandName: brandJoin?.name ?? "",
        modelCode: row.model_code,
        family: row.family,
        nameDisplay: row.name_display,
        standardConfig: row.standard_config,
        listPriceCents: Number(row.list_price_cents ?? 0),
        active: row.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        optionCount,
      };
    })
    .filter((row) => {
      if (!filters.includeInactive && !row.active) return false;
      const baseQuery = normalizeSearch(filters.baseNumber);
      const makeQuery = normalizeSearch(filters.make);
      const modelQuery = normalizeSearch(filters.model);
      const classQuery = normalizeSearch(filters.className);
      if (baseQuery && !row.modelCode.toLowerCase().includes(baseQuery)) return false;
      if (makeQuery && !`${row.brandCode} ${row.brandName}`.toLowerCase().includes(makeQuery)) return false;
      if (modelQuery && !`${row.nameDisplay} ${row.modelCode}`.toLowerCase().includes(modelQuery)) return false;
      if (classQuery && !(row.family ?? "").toLowerCase().includes(classQuery)) return false;
      return true;
    });

  return sortModels(filtered, filters.sortBy);
}

export async function listCompatibleAttachmentsForModel(
  modelId: string,
  brandId: string,
  includeInactive = false,
): Promise<BaseOptionAttachmentRecord[]> {
  const { data, error } = await supabase
    .from("qb_attachments")
    .select("id, brand_id, part_number, name, category, list_price_cents, compatible_model_ids, universal, active, updated_at")
    .eq("brand_id", brandId)
    .is("deleted_at", null)
    .limit(500);

  if (error) throw error;

  return ((data ?? []) as AttachmentRow[])
    .map(mapAttachmentRow)
    .filter((attachment) => attachmentMatchesModel(attachment, modelId, brandId, includeInactive))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveBaseOptionModel(input: SaveBaseOptionModelInput): Promise<void> {
  const payload = {
    brand_id: input.brandId,
    model_code: input.modelCode.trim(),
    family: input.family?.trim() || null,
    name_display: input.nameDisplay.trim(),
    standard_config: input.standardConfig?.trim() || null,
    list_price_cents: input.listPriceCents,
    active: input.active,
  };

  if (input.id) {
    const { error } = await supabase
      .from("qb_equipment_models")
      .update(payload)
      .eq("id", input.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("qb_equipment_models").insert(payload);
  if (error) throw error;
}

export async function saveBaseOptionAttachment(input: SaveBaseOptionAttachmentInput): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.category !== undefined) updates.category = input.category?.trim() || null;
  if (input.listPriceCents !== undefined) updates.list_price_cents = input.listPriceCents;
  if (input.active !== undefined) updates.active = input.active;

  const { error } = await supabase
    .from("qb_attachments")
    .update(updates)
    .eq("id", input.id);

  if (error) throw error;
}

export async function copyBaseOptionModel(
  sourceModelId: string,
  override: { modelCode?: string; nameDisplay?: string },
): Promise<string> {
  const { data: source, error: sourceError } = await supabase
    .from("qb_equipment_models")
    .select("*")
    .eq("id", sourceModelId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Source base not found.");

  const { data: siblingRows, error: siblingError } = await supabase
    .from("qb_equipment_models")
    .select("model_code")
    .eq("brand_id", source.brand_id)
    .is("deleted_at", null);
  if (siblingError) throw siblingError;

  const nextCode = override.modelCode?.trim() || buildCopyModelCode(source.model_code, (siblingRows ?? []).map((row) => row.model_code));

  const { data: inserted, error: insertError } = await supabase
    .from("qb_equipment_models")
    .insert({
      workspace_id: source.workspace_id,
      brand_id: source.brand_id,
      model_code: nextCode,
      family: source.family,
      series: source.series,
      model_year: source.model_year,
      name_display: override.nameDisplay?.trim() || `${source.name_display} Copy`,
      standard_config: source.standard_config,
      list_price_cents: source.list_price_cents,
      weight_lbs: source.weight_lbs,
      horsepower: source.horsepower,
      specs: source.specs,
      active: source.active,
      aged_inventory_model_year: source.aged_inventory_model_year,
    })
    .select("id")
    .single<{ id: string }>();
  if (insertError || !inserted) throw insertError ?? new Error("Copy failed.");

  const { data: attachments, error: attachmentsError } = await supabase
    .from("qb_attachments")
    .select("id, compatible_model_ids, active")
    .eq("brand_id", source.brand_id)
    .eq("active", true)
    .is("deleted_at", null)
    .limit(500);
  if (attachmentsError) throw attachmentsError;

  const updates = (attachments ?? []).filter((row) => {
    const compatibleIds = Array.isArray(row.compatible_model_ids) ? row.compatible_model_ids : [];
    return compatibleIds.includes(sourceModelId);
  });

  await Promise.all(
    updates.map((attachment) => {
      const compatibleIds = Array.isArray(attachment.compatible_model_ids)
        ? attachment.compatible_model_ids
        : [];
      const nextCompatibleIds = Array.from(new Set([...compatibleIds, inserted.id]));
      return supabase
        .from("qb_attachments")
        .update({ compatible_model_ids: nextCompatibleIds })
        .eq("id", attachment.id);
    }),
  );

  return inserted.id;
}

export async function bulkAdjustBaseOptionPrices(input: {
  modelIds: string[];
  percentDelta: number;
  includeAttachments: boolean;
}): Promise<{ modelsUpdated: number; attachmentsUpdated: number }> {
  const modelIds = Array.from(new Set(input.modelIds));
  if (modelIds.length === 0) return { modelsUpdated: 0, attachmentsUpdated: 0 };

  const { data: models, error: modelError } = await supabase
    .from("qb_equipment_models")
    .select("id, list_price_cents, brand_id")
    .in("id", modelIds);
  if (modelError) throw modelError;

  await Promise.all(
    (models ?? []).map((model) =>
      supabase
        .from("qb_equipment_models")
        .update({
          list_price_cents: applyPercentAdjustment(Number(model.list_price_cents ?? 0), input.percentDelta),
        })
        .eq("id", model.id),
    ),
  );

  if (!input.includeAttachments) {
    return { modelsUpdated: models?.length ?? 0, attachmentsUpdated: 0 };
  }

  const brandIds = Array.from(new Set((models ?? []).map((model) => model.brand_id).filter(Boolean)));
  const { data: attachments, error: attachmentError } = await supabase
    .from("qb_attachments")
    .select("id, brand_id, compatible_model_ids, universal, active, list_price_cents")
    .in("brand_id", brandIds)
    .eq("active", true)
    .is("deleted_at", null)
    .limit(1000);
  if (attachmentError) throw attachmentError;

  const attachmentRows = ((attachments ?? []) as AttachmentRow[]).map(mapAttachmentRow).filter((attachment) =>
    models?.some((model) => attachmentMatchesModel(attachment, model.id, model.brand_id, false)),
  );

  await Promise.all(
    attachmentRows.map((attachment) =>
      supabase
        .from("qb_attachments")
        .update({
          list_price_cents: applyPercentAdjustment(attachment.listPriceCents, input.percentDelta),
        })
        .eq("id", attachment.id),
    ),
  );

  return {
    modelsUpdated: models?.length ?? 0,
    attachmentsUpdated: attachmentRows.length,
  };
}
