import type {
  EligibleDeal,
  GenerationResult,
  PlaybookPart,
  PlaybookPayload,
  PlaybookRow,
  PlaybookSummary,
  PlaybookWindow,
} from "./post-sale-api";

export type PlaybookDetail = {
  id: string;
  status: string;
  payload: PlaybookPayload;
  total_revenue: number;
  created_at: string;
  sent_at: string | null;
  deal_id: string;
  equipment_id: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function playbookStatus(value: unknown): PlaybookRow["status"] {
  return value === "draft" ||
    value === "reviewed" ||
    value === "sent" ||
    value === "accepted" ||
    value === "dismissed" ||
    value === "expired"
    ? value
    : "draft";
}

function windowValue(value: unknown): PlaybookWindow["window"] {
  return value === "30d" || value === "60d" || value === "90d" ? value : "30d";
}

export function normalizePlaybookSummary(value: unknown): PlaybookSummary {
  const record = objectValue(value);
  return {
    counts: numericRecord(record.counts),
    open_revenue_usd: numberValue(record.open_revenue_usd) ?? 0,
    recent: normalizePlaybookRows(record.recent),
    generated_at: stringValue(record.generated_at),
  };
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, numberValue(item)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== null),
  );
}

export function normalizePlaybookRows(rows: unknown): PlaybookRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePlaybookRow).filter((row): row is PlaybookRow => row !== null);
}

function normalizePlaybookRow(value: unknown): PlaybookRow | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const dealId = nullableString(value.deal_id);
  const createdAt = nullableString(value.created_at);
  if (!id || !dealId || !createdAt) return null;
  return {
    id,
    deal_id: dealId,
    equipment_id: nullableString(value.equipment_id),
    status: playbookStatus(value.status),
    total_revenue: numberValue(value.total_revenue) ?? 0,
    generated_by: nullableString(value.generated_by),
    created_at: createdAt,
    sent_at: nullableString(value.sent_at),
    deal_name: nullableString(value.deal_name),
    company_name: nullableString(value.company_name),
    make: nullableString(value.make),
    model: nullableString(value.model),
    year: numberValue(value.year),
    rep_name: nullableString(value.rep_name),
  };
}

export function normalizeEligibleDeals(rows: unknown): EligibleDeal[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeEligibleDeal).filter((row): row is EligibleDeal => row !== null);
}

function normalizeEligibleDeal(value: unknown): EligibleDeal | null {
  if (!isRecord(value)) return null;
  const dealId = nullableString(value.deal_id);
  const equipmentId = nullableString(value.equipment_id);
  const closedAt = nullableString(value.closed_at);
  if (!dealId || !equipmentId || !closedAt) return null;
  return {
    deal_id: dealId,
    company_id: nullableString(value.company_id),
    assigned_rep_id: nullableString(value.assigned_rep_id),
    equipment_id: equipmentId,
    make: nullableString(value.make),
    model: nullableString(value.model),
    closed_at: closedAt,
  };
}

export function normalizeGenerationResult(value: unknown): GenerationResult {
  const record = objectValue(value);
  const totalRevenue = numberValue(record.total_revenue);
  const windowCount = numberValue(record.window_count);
  const partsCount = numberValue(record.parts_count);
  const elapsedMs = numberValue(record.elapsed_ms);
  return {
    ok: booleanValue(record.ok),
    ...(nullableString(record.playbook_id) ? { playbook_id: nullableString(record.playbook_id) ?? undefined } : {}),
    ...(nullableString(record.status) ? { status: nullableString(record.status) ?? undefined } : {}),
    ...(totalRevenue !== null ? { total_revenue: totalRevenue } : {}),
    ...(windowCount !== null ? { window_count: windowCount } : {}),
    ...(partsCount !== null ? { parts_count: partsCount } : {}),
    ...(typeof record.cached === "boolean" ? { cached: record.cached } : {}),
    ...(elapsedMs !== null ? { elapsed_ms: elapsedMs } : {}),
    ...(nullableString(record.error) ? { error: nullableString(record.error) ?? undefined } : {}),
  };
}

export function normalizePlaybookPayload(value: unknown): PlaybookPayload {
  const record = objectValue(value);
  return {
    windows: Array.isArray(record.windows)
      ? record.windows.map(normalizePlaybookWindow).filter((row): row is PlaybookWindow => row !== null)
      : [],
    grand_total_revenue: numberValue(record.grand_total_revenue) ?? 0,
    assumptions: objectValue(record.assumptions),
    generated_at: stringValue(record.generated_at),
    machine_profile_id: nullableString(record.machine_profile_id),
    model_family: nullableString(record.model_family),
    customer_name: nullableString(record.customer_name),
  };
}

function normalizePlaybookWindow(value: unknown): PlaybookWindow | null {
  if (!isRecord(value)) return null;
  return {
    window: windowValue(value.window),
    narrative: stringValue(value.narrative),
    service_description: stringValue(value.service_description),
    parts: Array.isArray(value.parts)
      ? value.parts.map(normalizePlaybookPart).filter((row): row is PlaybookPart => row !== null)
      : [],
    total_revenue: numberValue(value.total_revenue) ?? 0,
  };
}

function normalizePlaybookPart(value: unknown): PlaybookPart | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  const matchScore = numberValue(value.match_score);
  return {
    part_number: partNumber,
    description: stringValue(value.description),
    qty: numberValue(value.qty) ?? 0,
    unit_price: numberValue(value.unit_price) ?? 0,
    total: numberValue(value.total) ?? 0,
    on_hand: numberValue(value.on_hand) ?? 0,
    probability: numberValue(value.probability) ?? 0,
    reason: stringValue(value.reason),
    ...(matchScore !== null ? { match_score: matchScore } : {}),
  };
}

export function normalizePlaybookDetail(value: unknown): PlaybookDetail | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const status = nullableString(value.status);
  const createdAt = nullableString(value.created_at);
  const dealId = nullableString(value.deal_id);
  if (!id || !status || !createdAt || !dealId) return null;
  return {
    id,
    status,
    payload: normalizePlaybookPayload(value.payload),
    total_revenue: numberValue(value.total_revenue) ?? 0,
    created_at: createdAt,
    sent_at: nullableString(value.sent_at),
    deal_id: dealId,
    equipment_id: nullableString(value.equipment_id),
  };
}
