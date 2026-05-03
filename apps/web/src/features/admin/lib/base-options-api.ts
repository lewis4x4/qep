import { supabase } from "@/lib/supabase";
import {
  applyPercentAdjustment,
  attachmentMatchesModel,
  buildCopyModelCode,
} from "./base-options-utils";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeJoinedBrand(value: unknown): { code: string; name: string } {
  const brand = Array.isArray(value) ? value.find(isRecord) : value;
  if (!isRecord(brand)) return { code: "", name: "" };
  return {
    code: stringOrNull(brand.code) ?? "",
    name: stringOrNull(brand.name) ?? "",
  };
}

export function normalizeBaseOptionAttachmentRows(value: unknown): BaseOptionAttachmentRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const partNumber = requiredString(row.part_number);
    const name = requiredString(row.name);
    const updatedAt = requiredString(row.updated_at);
    if (!id || !partNumber || !name || !updatedAt) return [];
    return [{
      id,
      brandId: stringOrNull(row.brand_id),
      partNumber,
      name,
      category: stringOrNull(row.category),
      listPriceCents: numberOrZero(row.list_price_cents),
      compatibleModelIds: stringArray(row.compatible_model_ids),
      universal: row.universal === true,
      active: row.active === true,
      updatedAt,
    }];
  });
}

export function normalizeBaseOptionModelRows(value: unknown): Array<Omit<BaseOptionModelRecord, "optionCount">> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const brandId = requiredString(row.brand_id);
    const modelCode = requiredString(row.model_code);
    const nameDisplay = requiredString(row.name_display);
    const createdAt = requiredString(row.created_at);
    const updatedAt = requiredString(row.updated_at);
    if (!id || !brandId || !modelCode || !nameDisplay || !createdAt || !updatedAt) return [];
    const brand = normalizeJoinedBrand(row.qb_brands);
    return [{
      id,
      brandId,
      brandCode: brand.code,
      brandName: brand.name,
      modelCode,
      family: stringOrNull(row.family),
      nameDisplay,
      standardConfig: stringOrNull(row.standard_config),
      listPriceCents: numberOrZero(row.list_price_cents),
      active: row.active === true,
      createdAt,
      updatedAt,
    }];
  });
}

function withOptionCount(
  row: Omit<BaseOptionModelRecord, "optionCount">,
  optionCount: number,
): BaseOptionModelRecord {
  return {
    ...row,
    optionCount,
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

  const rawModels = normalizeBaseOptionModelRows(data);

  const brandIds = Array.from(new Set(rawModels.map((row) => row.brandId)));
  let attachments: BaseOptionAttachmentRecord[] = [];
  if (brandIds.length > 0) {
    const { data: attachmentData, error: attachmentError } = await supabase
      .from("qb_attachments")
      .select("id, brand_id, part_number, name, category, list_price_cents, compatible_model_ids, universal, active, updated_at")
      .in("brand_id", brandIds)
      .is("deleted_at", null)
      .limit(1000);

    if (attachmentError) throw attachmentError;
    attachments = normalizeBaseOptionAttachmentRows(attachmentData);
  }

  const filtered = rawModels
    .map((row) => {
      const optionCount = attachments.filter((attachment) =>
        attachmentMatchesModel(attachment, row.id, row.brandId, filters.includeInactive),
      ).length;
      return withOptionCount(row, optionCount);
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

  return normalizeBaseOptionAttachmentRows(data)
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

  const attachmentRows = normalizeBaseOptionAttachmentRows(attachments).filter((attachment) =>
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
