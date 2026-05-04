import type { Json } from "./database.types";

type JsonRecord = { [key: string]: Json | undefined };

export interface Asset360Equipment {
  id: string;
  workspace_id: string;
  company_id: string;
  primary_contact_id: string | null;
  name: string;
  asset_tag: string | null;
  serial_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  condition: "new" | "excellent" | "good" | "fair" | "poor" | "salvage" | null;
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned" | "on_order";
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  engine_hours: number | null;
  warranty_expires_on: string | null;
  next_service_due_at: string | null;
  photo_urls: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Asset360Company {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
}

export interface Asset360RecentService {
  id: string;
  summary: string | null;
  status: string;
  scheduled_for: string | null;
  completed_at: string | null;
}

export interface Asset360OpenDeal {
  id: string;
  name: string;
  amount: number | null;
  stage_id: string | null;
  next_follow_up_at: string | null;
}

export interface Asset360Response {
  equipment: Asset360Equipment;
  company: Asset360Company | null;
  badges: AssetBadgeData;
  recent_service: Asset360RecentService[];
  open_deal: Asset360OpenDeal | null;
}

export interface AssetBadgeData {
  open_work_orders: number;
  open_quotes: number;
  pending_parts_orders: number;
  overdue_intervals: number;
  trade_up_score: number;
  lifetime_parts_spend: number;
}

export const EMPTY_ASSET_BADGES: AssetBadgeData = {
  open_work_orders: 0,
  open_quotes: 0,
  pending_parts_orders: 0,
  overdue_intervals: 0,
  trade_up_score: 0,
  lifetime_parts_spend: 0,
};

function readNumber(value: Json | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isJsonRecord(value: Json | null): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRecord(value: Json | null | undefined): JsonRecord | null {
  return isJsonRecord(value ?? null) ? value as JsonRecord : null;
}

function readNullableString(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNullableNumber(value: Json | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRequiredString(value: Json | undefined): string | null {
  return readNullableString(value);
}

function readStringArray(value: Json | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : null;
}

function readMetadata(value: Json | undefined): Record<string, unknown> {
  return asJsonRecord(value) ?? {};
}

function readCondition(value: Json | undefined): Asset360Equipment["condition"] {
  return value === "new"
    || value === "excellent"
    || value === "good"
    || value === "fair"
    || value === "poor"
    || value === "salvage"
    ? value
    : null;
}

function readAvailability(value: Json | undefined): Asset360Equipment["availability"] {
  return value === "available"
    || value === "rented"
    || value === "sold"
    || value === "in_service"
    || value === "in_transit"
    || value === "reserved"
    || value === "decommissioned"
    ? value
    : "available";
}

function readOwnership(value: Json | undefined): Asset360Equipment["ownership"] {
  return value === "owned"
    || value === "leased"
    || value === "customer_owned"
    || value === "rental_fleet"
    || value === "consignment"
    ? value
    : "owned";
}

export function parseAssetBadges(value: Json | null): AssetBadgeData {
  if (!isJsonRecord(value)) {
    return EMPTY_ASSET_BADGES;
  }

  return {
    open_work_orders: readNumber(value.open_work_orders),
    open_quotes: readNumber(value.open_quotes),
    pending_parts_orders: readNumber(value.pending_parts_orders),
    overdue_intervals: readNumber(value.overdue_intervals),
    trade_up_score: readNumber(value.trade_up_score),
    lifetime_parts_spend: readNumber(value.lifetime_parts_spend),
  };
}

function parseEquipment(value: Json | undefined): Asset360Equipment | null {
  const record = asJsonRecord(value);
  if (!record) return null;

  const id = readRequiredString(record.id);
  const workspaceId = readRequiredString(record.workspace_id);
  const companyId = readRequiredString(record.company_id);
  const name = readRequiredString(record.name);
  const createdAt = readRequiredString(record.created_at);

  if (!id || !workspaceId || !companyId || !name || !createdAt) return null;

  return {
    id,
    workspace_id: workspaceId,
    company_id: companyId,
    primary_contact_id: readNullableString(record.primary_contact_id),
    name,
    asset_tag: readNullableString(record.asset_tag),
    serial_number: readNullableString(record.serial_number),
    make: readNullableString(record.make),
    model: readNullableString(record.model),
    year: readNullableNumber(record.year),
    condition: readCondition(record.condition),
    availability: readAvailability(record.availability),
    ownership: readOwnership(record.ownership),
    engine_hours: readNullableNumber(record.engine_hours),
    warranty_expires_on: readNullableString(record.warranty_expires_on),
    next_service_due_at: readNullableString(record.next_service_due_at),
    photo_urls: readStringArray(record.photo_urls),
    metadata: readMetadata(record.metadata),
    created_at: createdAt,
  };
}

function parseCompany(value: Json | undefined): Asset360Company | null {
  const record = asJsonRecord(value);
  if (!record) return null;
  const id = readRequiredString(record.id);
  const name = readRequiredString(record.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    city: readNullableString(record.city),
    state: readNullableString(record.state),
  };
}

function parseRecentService(value: Json | undefined): Asset360RecentService[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): Asset360RecentService[] => {
    if (!isJsonRecord(item)) return [];
    const id = readRequiredString(item.id);
    if (!id) return [];

    return [{
      id,
      summary: readNullableString(item.summary) ?? readNullableString(item.customer_problem_summary),
      status: readNullableString(item.status) ?? readNullableString(item.current_stage) ?? "open",
      scheduled_for: readNullableString(item.scheduled_for) ?? readNullableString(item.scheduled_start_at),
      completed_at: readNullableString(item.completed_at) ?? readNullableString(item.closed_at),
    }];
  });
}

function parseOpenDeal(value: Json | undefined): Asset360OpenDeal | null {
  const record = asJsonRecord(value);
  if (!record) return null;
  const id = readRequiredString(record.id);
  const name = readRequiredString(record.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    amount: readNullableNumber(record.amount),
    stage_id: readNullableString(record.stage_id),
    next_follow_up_at: readNullableString(record.next_follow_up_at),
  };
}

export function parseAsset360(value: Json | null): Asset360Response | null {
  if (!isJsonRecord(value)) return null;

  const equipment = parseEquipment(value.equipment);
  if (!equipment) return null;

  return {
    equipment,
    company: parseCompany(value.company),
    badges: parseAssetBadges(value.badges ?? null),
    recent_service: parseRecentService(value.recent_service),
    open_deal: parseOpenDeal(value.open_deal),
  };
}
