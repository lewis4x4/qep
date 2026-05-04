/**
 * Shared types for Parts Intelligence Engine imports.
 */

export type PartsImportFileType =
  | "partmast"
  | "vendor_price"
  | "vendor_contacts"
  | "unknown";

export type PartsImportStatus =
  | "pending"
  | "parsing"
  | "previewing"
  | "awaiting_conflicts"
  | "committing"
  | "committed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export interface PreviewStats {
  rows_scanned: number;
  rows_to_insert: number;
  rows_to_update: number;
  rows_unchanged: number;
  rows_errored: number;
  rows_conflicted: number;
  sample_inserts: Array<Record<string, unknown>>;
  sample_updates: Array<{
    key: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changed_fields: string[];
  }>;
  errors: Array<{ row: number; part_number?: string; reason: string }>;
}

export interface ImportOptions {
  commit: boolean;
  dry_run?: boolean;
  branch_scope?: string | null;
  vendor_id?: string | null;
  vendor_code?: string | null;
  resolve_conflicts_on_commit?: boolean;
  /** Auto-resolve conflicts for a set of field names to take-incoming. */
  auto_take_incoming_fields?: string[];
}

/**
 * Field classification for conflict priority (plan §1.2b).
 *   high   = physical-world / money (price, bin, ROP, EOQ)
 *   normal = descriptive / classification
 *   low    = historical counters / computed
 */
export const FIELD_PRIORITY: Record<string, "high" | "normal" | "low"> = {
  // high priority — always preview, never silent
  list_price: "high",
  cost_price: "high",
  pricing_level_1: "high",
  pricing_level_2: "high",
  pricing_level_3: "high",
  pricing_level_4: "high",
  bin_location: "high",
  reorder_point: "high",
  eoq: "high",
  safety_stock_qty: "high",
  // normal priority
  description: "normal",
  category: "normal",
  class_code: "normal",
  movement_code: "normal",
  activity_code: "normal",
  stocking_code: "normal",
  // low priority (facts, not opinions)
  on_hand: "low",
  on_order: "low",
  back_ordered: "low",
  last_sale_date: "low",
  average_cost: "low",
  ytd_sales_dollars: "low",
};

/**
 * Fields where a manual-override flag exists on parts_catalog.
 * If the `{field}_manual_override` flag is true AND incoming differs,
 * it becomes a conflict instead of a silent overwrite.
 */
export const MANUAL_OVERRIDE_FIELDS = [
  "bin_location",
  "reorder_point",
  "eoq",
  "safety_stock_qty",
  "list_price",
  "pricing_level_1",
  "pricing_level_2",
  "pricing_level_3",
  "pricing_level_4",
  "description",
  "category",
  "class_code",
] as const;

export type ManualOverrideField = typeof MANUAL_OVERRIDE_FIELDS[number];

/**
 * Parse CDK date format (YYYYMMDD integer/string → ISO date) or
 * Excel date strings to ISO date. Returns null for 0 / invalid.
 */
export function parseCdkDate(raw: unknown): string | null {
  if (raw == null || raw === "" || raw === 0 || raw === "0") return null;
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    if (y === "0000" || m === "00" || d === "00") return null;
    return `${y}-${m}-${d}`;
  }
  // Try Date parse fallback
  const parsed = new Date(s);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/** Parse a number cell, returning null for empty/invalid. */
export function parseNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse an integer cell, null for empty/invalid. */
export function parseInt32(raw: unknown): number | null {
  const n = parseNumber(raw);
  return n == null ? null : Math.trunc(n);
}

/** Trim + null-if-empty string. */
export function parseStr(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/** SHA-256 hash of a buffer → hex string. */
export async function sha256(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const digestInput = new Uint8Array(data.byteLength);
  digestInput.set(data);
  const hash = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
