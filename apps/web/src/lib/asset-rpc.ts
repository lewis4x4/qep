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

export interface Asset360RentalContract {
  id: string;
  contract_number: string | null;
  status: string | null;
  lifecycle_state: string | null;
  approved_start_date: string | null;
  approved_end_date: string | null;
  on_rent_at: string | null;
  off_rent_at: string | null;
  returned_at: string | null;
  closed_at: string | null;
  agreed_daily_rate: number | null;
  agreed_weekly_rate: number | null;
  agreed_monthly_rate: number | null;
}

export interface Asset360RentalInvoice {
  id: string;
  invoice_number: string | null;
  period_start: string | null;
  period_end: string | null;
  total_cents: number | null;
  balance_cents: number | null;
  status: string | null;
  due_date: string | null;
}

export interface Asset360Rental {
  contracts: Asset360RentalContract[];
  open_contract: Asset360RentalContract | null;
  recent_invoices: Asset360RentalInvoice[];
}

export interface Asset360Intake {
  id: string;
  current_stage: number | null;
  stock_number: string | null;
  po_number: string | null;
  arrival_date: string | null;
  pdi_completed: boolean | null;
  photo_ready: boolean | null;
  pricing_verified: boolean | null;
  updated_at: string | null;
}

export interface Asset360Invoice {
  id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  status: string | null;
  total: number | null;
  amount_paid: number | null;
  created_at: string | null;
}

export interface Asset360Trade {
  id: string;
  deal_id: string | null;
  allowance_cents: number | null;
  book_value_cents: number | null;
  disposition: string | null;
  reconditioning_approval_status: string | null;
  approved_at: string | null;
  created_at: string | null;
}

export interface Asset360Response {
  equipment: Asset360Equipment;
  company: Asset360Company | null;
  badges: AssetBadgeData;
  recent_service: Asset360RecentService[];
  open_deal: Asset360OpenDeal | null;
  // N6.1 arms — older RPC deploys omit these; parsers default them.
  rental: Asset360Rental | null;
  intake: Asset360Intake | null;
  invoices: Asset360Invoice[];
  trades: Asset360Trade[];
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

function parseRentalContract(value: Json | null | undefined): Asset360RentalContract | null {
  if (value === undefined || !isJsonRecord(value)) return null;
  const id = readNullableString(value.id);
  if (!id) return null;
  return {
    id,
    contract_number: readNullableString(value.contract_number),
    status: readNullableString(value.status),
    lifecycle_state: readNullableString(value.lifecycle_state),
    approved_start_date: readNullableString(value.approved_start_date),
    approved_end_date: readNullableString(value.approved_end_date),
    on_rent_at: readNullableString(value.on_rent_at),
    off_rent_at: readNullableString(value.off_rent_at),
    returned_at: readNullableString(value.returned_at),
    closed_at: readNullableString(value.closed_at),
    agreed_daily_rate: readNullableNumber(value.agreed_daily_rate),
    agreed_weekly_rate: readNullableNumber(value.agreed_weekly_rate),
    agreed_monthly_rate: readNullableNumber(value.agreed_monthly_rate),
  };
}

function parseRental(value: Json | null | undefined): Asset360Rental | null {
  if (value === undefined || !isJsonRecord(value)) return null;
  const contracts = Array.isArray(value.contracts)
    ? value.contracts.map(parseRentalContract).filter((c): c is Asset360RentalContract => c !== null)
    : [];
  const invoices = Array.isArray(value.recent_invoices)
    ? value.recent_invoices.flatMap((row): Asset360RentalInvoice[] => {
        if (!isJsonRecord(row)) return [];
        const id = readNullableString(row.id);
        if (!id) return [];
        return [{
          id,
          invoice_number: readNullableString(row.invoice_number),
          period_start: readNullableString(row.period_start),
          period_end: readNullableString(row.period_end),
          total_cents: readNullableNumber(row.total_cents),
          balance_cents: readNullableNumber(row.balance_cents),
          status: readNullableString(row.status),
          due_date: readNullableString(row.due_date),
        }];
      })
    : [];
  return {
    contracts,
    open_contract: parseRentalContract(value.open_contract),
    recent_invoices: invoices,
  };
}

function parseIntake(value: Json | null | undefined): Asset360Intake | null {
  if (value === undefined || !isJsonRecord(value)) return null;
  const id = readNullableString(value.id);
  if (!id) return null;
  return {
    id,
    current_stage: readNullableNumber(value.current_stage),
    stock_number: readNullableString(value.stock_number),
    po_number: readNullableString(value.po_number),
    arrival_date: readNullableString(value.arrival_date),
    pdi_completed: typeof value.pdi_completed === "boolean" ? value.pdi_completed : null,
    photo_ready: typeof value.photo_ready === "boolean" ? value.photo_ready : null,
    pricing_verified: typeof value.pricing_verified === "boolean" ? value.pricing_verified : null,
    updated_at: readNullableString(value.updated_at),
  };
}

function parseInvoices(value: Json | null | undefined): Asset360Invoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): Asset360Invoice[] => {
    if (!isJsonRecord(row)) return [];
    const id = readNullableString(row.id);
    if (!id) return [];
    return [{
      id,
      invoice_number: readNullableString(row.invoice_number),
      invoice_type: readNullableString(row.invoice_type),
      status: readNullableString(row.status),
      total: readNullableNumber(row.total),
      amount_paid: readNullableNumber(row.amount_paid),
      created_at: readNullableString(row.created_at),
    }];
  });
}

function parseTrades(value: Json | null | undefined): Asset360Trade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): Asset360Trade[] => {
    if (!isJsonRecord(row)) return [];
    const id = readNullableString(row.id);
    if (!id) return [];
    return [{
      id,
      deal_id: readNullableString(row.deal_id),
      allowance_cents: readNullableNumber(row.allowance_cents),
      book_value_cents: readNullableNumber(row.book_value_cents),
      disposition: readNullableString(row.disposition),
      reconditioning_approval_status: readNullableString(row.reconditioning_approval_status),
      approved_at: readNullableString(row.approved_at),
      created_at: readNullableString(row.created_at),
    }];
  });
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
    rental: parseRental(value.rental),
    intake: parseIntake(value.intake),
    invoices: parseInvoices(value.invoices),
    trades: parseTrades(value.trades),
  };
}
