// Pure helpers extracted from QuoteBuilderV2Page (IRON wizard orchestrator slimming).
// Mechanical move — no behavior change.

import type { CatalogStructuredSpec } from "@/lib/pricing/catalog-specs";
import type { QuoteLineItemDraft, QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { IronQuoteHandoff } from "./iron-quote-handoff";
import { isSafeProposalMediaUrl } from "./quote-proposal-data";

export function readinessChipLabel(missing: string): string {
  if (missing.includes("customer-facing equipment")) return "Visible machine";
  if (missing.includes("equipment selection")) return "Equipment";
  if (missing.includes("customer or prospect")) return "Customer";
  if (missing.includes("branch")) return "Branch";
  if (missing.includes("email")) return "Email";
  if (missing.includes("customer")) return "Customer";
  return missing;
}

export type EquipmentAvailabilityStatus = "in_stock" | "in_transit" | "source_required";

export interface CatalogEntryMatch {
  id?: string;
  sourceCatalog?: QuoteLineItemDraft["sourceCatalog"];
  sourceId?: string | null;
  dealerCost?: number | null;
  make: string;
  model: string;
  year: number | null;
  list_price?: number | null;
  stock_number?: string | null;
  serial_number?: string | null;
  condition?: string | null;
  warranty_text?: string | null;
  long_description?: string | null;
  spec_bullets?: string[] | null;
  structured_specs?: CatalogStructuredSpec[] | null;
  spec_search_text?: string | null;
  spec_source?: "manufacturer_ingested" | string | null;
  photo_url?: string | null;
  photo_urls?: string[] | null;
  vendor_logo_url?: string | null;
  media_source?: string | null;
  media_source_id?: string | null;
  media_kind?: string | null;
  availabilityStatus?: EquipmentAvailabilityStatus;
  availability_status?: EquipmentAvailabilityStatus;
  received_at?: string | null;
  hot_list?: boolean;
  attachments?: Array<{ id: string; name: string; price: number }>;
}

export interface CatalogAttachmentMatch {
  id: string;
  name: string;
  price: number;
  brandName?: string | null;
  category?: string | null;
  universal?: boolean;
}

export function availabilityStatusForEntry(
  entry: Pick<CatalogEntryMatch, "stock_number" | "condition" | "availabilityStatus" | "availability_status">,
): EquipmentAvailabilityStatus {
  if (entry.availabilityStatus) return entry.availabilityStatus;
  if (entry.availability_status) return entry.availability_status;
  const condition = entry.condition?.toLowerCase() ?? "";
  if (condition.includes("transit")) return "in_transit";
  if (entry.stock_number) return "in_stock";
  return "source_required";
}

export function availabilityStatusForLine(item: QuoteLineItemDraft): EquipmentAvailabilityStatus {
  const raw = item.metadata?.availability_status;
  return raw === "in_stock" || raw === "in_transit" || raw === "source_required"
    ? raw
    : "source_required";
}

export function availabilityLabel(status: EquipmentAvailabilityStatus): string {
  if (status === "in_stock") return "In stock";
  if (status === "in_transit") return "In transit";
  return "Source required";
}

function safeCatalogMediaUrl(value: unknown): string | null {
  return isSafeProposalMediaUrl(value) ? value.trim() : null;
}

function safeCatalogMediaUrls(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const safe = safeCatalogMediaUrl(item);
    if (!safe || seen.has(safe)) return [];
    seen.add(safe);
    return [safe];
  });
}

function mediaKindForEntry(entry: CatalogEntryMatch): string | undefined {
  if (entry.media_kind) return entry.media_kind;
  if (entry.sourceCatalog === "catalog_entries" || entry.stock_number || entry.serial_number) return "actual";
  if (entry.photo_url || (entry.photo_urls?.length ?? 0) > 0) return "model_generic";
  return undefined;
}

export function metadataForCatalogEntry(entry: CatalogEntryMatch): Record<string, unknown> {
  const photoUrls = safeCatalogMediaUrls(entry.photo_urls);
  const primaryPhotoUrl = safeCatalogMediaUrl(entry.photo_url) ?? photoUrls[0] ?? null;
  const allPhotoUrls = primaryPhotoUrl
    ? [primaryPhotoUrl, ...photoUrls.filter((url) => url !== primaryPhotoUrl)]
    : photoUrls;
  const vendorLogoUrl = safeCatalogMediaUrl(entry.vendor_logo_url);
  const metadata: Record<string, unknown> = {
    availability_status: availabilityStatusForEntry(entry),
    stock_number: entry.stock_number ?? null,
    serial_number: entry.serial_number ?? null,
    condition: entry.condition ?? null,
    media_source: entry.media_source ?? (entry.sourceCatalog === "catalog_entries" ? "crm_equipment" : entry.sourceCatalog ?? "qb_equipment_models"),
    media_source_id: entry.media_source_id ?? entry.sourceId ?? entry.id ?? null,
  };
  if (primaryPhotoUrl) metadata.photo_url = primaryPhotoUrl;
  if (allPhotoUrls.length > 0) metadata.photo_urls = allPhotoUrls;
  if (vendorLogoUrl) metadata.vendor_logo_url = vendorLogoUrl;
  if (entry.warranty_text) metadata.warranty_text = entry.warranty_text;
  if (entry.long_description) metadata.long_description = entry.long_description;
  if (entry.structured_specs?.length) {
    metadata.structured_specs = entry.structured_specs.slice(0, 16);
    metadata.spec_source = entry.spec_source ?? "manufacturer_ingested";
  }
  if (entry.spec_bullets?.length) metadata.spec_bullets = entry.spec_bullets.filter(Boolean).slice(0, 8);
  const mediaKind = mediaKindForEntry(entry);
  if (mediaKind) metadata.media_kind = mediaKind;
  if (typeof entry.received_at === "string" && entry.received_at.trim().length > 0) {
    metadata.received_at = entry.received_at.trim();
  }
  if (entry.hot_list === true) {
    metadata.hot_list = true;
  }
  return metadata;
}

export function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function availabilityClientLineKey(item: QuoteLineItemDraft, index: number): string {
  return [
    item.sourceCatalog ?? item.kind,
    item.sourceId ?? item.id ?? item.title,
    item.make ?? "",
    item.model ?? "",
    item.year ?? "",
    index,
  ].join("|");
}

export function availabilityRequestIdForLine(item: QuoteLineItemDraft): string | null {
  return metadataString(item.metadata, "availability_request_id");
}

export function availabilityRequestStatusForLine(item: QuoteLineItemDraft): string | null {
  return metadataString(item.metadata, "availability_request_status");
}

export function availabilityRequestCreatedAtForLine(item: QuoteLineItemDraft): string | null {
  return metadataString(item.metadata, "availability_confirmation_requested_at");
}

export function availabilityRequestLabel(status: string | null): string {
  if (status === "available") return "Available";
  if (status === "available_with_conditions") return "Available with conditions";
  if (status === "alternative_recommended") return "Alternative ready";
  if (status === "not_available") return "Unavailable";
  if (status === "checking_internal_inventory") return "Checking inventory";
  if (status === "checking_vendor") return "Checking vendor";
  if (status === "pending") return "Availability pending";
  return "Request sent";
}

export function buildEquipmentLine(entry: CatalogEntryMatch): QuoteLineItemDraft {
  const metadata = metadataForCatalogEntry(entry);
  if (typeof entry.list_price === "number" && Number.isFinite(entry.list_price)) {
    metadata.system_base_unit_price = entry.list_price;
  }
  return {
    kind: "equipment",
    id: entry.id,
    sourceCatalog: entry.sourceCatalog ?? "qb_equipment_models",
    sourceId: entry.sourceId ?? entry.id ?? null,
    dealerCost: entry.dealerCost ?? null,
    title: `${entry.make} ${entry.model}`,
    make: entry.make,
    model: entry.model,
    year: entry.year,
    quantity: 1,
    unitPrice: entry.list_price ?? 0,
    metadata,
  };
}

export function isQuoteApprovedForDistribution(status: string | null | undefined): boolean {
  return status === "approved"
    || status === "approved_with_conditions"
    || status === "sent"
    || status === "accepted";
}

export function equipmentKeyForLine(item: Pick<QuoteLineItemDraft, "id" | "title" | "make" | "model" | "year">): string {
  return [
    item.id ?? "",
    item.title ?? "",
    item.make ?? "",
    item.model ?? "",
    item.year ?? "",
  ].join("|");
}

export function normalizeMachineMatchLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function draftHasCustomer(
  draft: Pick<QuoteWorkspaceDraft, "customerName" | "customerCompany" | "contactId" | "companyId">,
): boolean {
  return Boolean(
    draft.customerName?.trim()
    || draft.customerCompany?.trim()
    || draft.contactId
    || draft.companyId,
  );
}

export function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function statusLabel(status: string | null | undefined): string {
  return (status ?? "draft").replace(/_/g, " ");
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function splitIronOptionLines(value: string | null): string[] {
  if (!value || value === "none specified") return [];
  const normalized = value
    .replace(/\b(?:and|plus)\b/gi, ",")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return [...new Set(normalized)].slice(0, 8);
}

export function buildIronQuoteIntakeSummary(handoff: IronQuoteHandoff): string {
  const lines = [
    `Iron intake: ${handoff.rawText}`,
    handoff.structuredCustomerText ? `Customer: ${handoff.structuredCustomerText}` : null,
    handoff.structuredApplicationText ? `Application/job: ${handoff.structuredApplicationText}` : null,
    handoff.structuredEquipmentText ? `Equipment: ${handoff.structuredEquipmentText}` : null,
    handoff.structuredOptionsText ? `Options/attachments: ${handoff.structuredOptionsText}` : null,
    handoff.structuredTimeframeText ? `Timeframe: ${handoff.structuredTimeframeText}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildIronQuoteIntakeEquipmentLine(handoff: IronQuoteHandoff): QuoteLineItemDraft | null {
  if (!handoff.structuredEquipmentText) return null;
  return {
    id: `iron-intake-equipment-${handoff.handoffId}`,
    kind: "equipment",
    sourceCatalog: "manual",
    sourceId: null,
    dealerCost: null,
    title: handoff.structuredEquipmentText,
    quantity: 1,
    unitPrice: 0,
    metadata: {
      source: "iron_quote_intake",
      application_text: handoff.structuredApplicationText,
      options_text: handoff.structuredOptionsText,
      timeframe_text: handoff.structuredTimeframeText,
      price_status: "needs_pricing",
    },
  };
}

export function buildIronQuoteIntakeOptionLines(handoff: IronQuoteHandoff): QuoteLineItemDraft[] {
  return splitIronOptionLines(handoff.structuredOptionsText).map((title, index) => ({
    id: `iron-intake-option-${handoff.handoffId}-${index}`,
    kind: "option",
    sourceCatalog: "manual",
    sourceId: null,
    dealerCost: null,
    title,
    quantity: 1,
    unitPrice: 0,
    metadata: {
      source: "iron_quote_intake",
      timeframe_text: handoff.structuredTimeframeText,
      price_status: "needs_pricing",
    },
  }));
}

export function appendMissingIronLines(
  current: QuoteLineItemDraft[],
  incoming: QuoteLineItemDraft[],
): QuoteLineItemDraft[] {
  if (incoming.length === 0) return current;
  const titles = new Set(current.map((item) => item.title.trim().toLowerCase()).filter(Boolean));
  const additions = incoming.filter((item) => !titles.has(item.title.trim().toLowerCase()));
  return additions.length > 0 ? [...current, ...additions] : current;
}
