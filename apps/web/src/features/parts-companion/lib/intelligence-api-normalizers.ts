import type {
  ActionPlayResult,
  AiPredictionResult,
  DeadCapitalRow,
  EmbedBackfillResult,
  HotMoverRow,
  IntelligenceSummary,
  MarginErosionRow,
  PredictivePlay,
  PredictivePlaysSummary,
  StockoutRow,
} from "./intelligence-api";

export type SeededForecastResult = {
  ok: boolean;
  forecasts_written: number;
  batch_id: string;
  elapsed_ms: number;
};

export type PredictivePredictionResult = {
  ok: boolean;
  plays_written: number;
  machines_scanned: number;
  elapsed_ms: number;
};

export type LlmInferenceRunRow = {
  plays_proposed: number | null;
  plays_grounded: number | null;
  plays_written: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd_cents: number | null;
  elapsed_ms: number | null;
  fleet_id: string | null;
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

function deadPattern(value: unknown): DeadCapitalRow["dead_pattern"] {
  return value === "cooling_down" || value === "truly_dead" ? value : "truly_dead";
}

function projectionWindow(value: unknown): PredictivePlay["projection_window"] {
  return value === "7d" || value === "14d" || value === "30d" || value === "60d" || value === "90d"
    ? value
    : "30d";
}

function signalType(value: unknown): PredictivePlay["signal_type"] {
  return value === "hours_based_interval" ||
    value === "date_based_schedule" ||
    value === "common_wear_pattern" ||
    value === "yoy_demand_spike" ||
    value === "manual_curation" ||
    value === "ai_inferred"
    ? value
    : "manual_curation";
}

function playStatus(value: unknown): PredictivePlay["status"] {
  return value === "open" ||
    value === "actioned" ||
    value === "dismissed" ||
    value === "expired" ||
    value === "fulfilled"
    ? value
    : "open";
}

function queueAction(value: unknown): ActionPlayResult["queue_action"] {
  return value === "created" || value === "reused_existing" || value === "none" ? value : "none";
}

export function normalizeIntelligenceSummary(value: unknown): IntelligenceSummary {
  const record = objectValue(value);
  const kpis = objectValue(record.kpis);
  return {
    kpis: {
      total_parts: numberValue(kpis.total_parts) ?? 0,
      hot_parts: numberValue(kpis.hot_parts) ?? 0,
      dead_parts: numberValue(kpis.dead_parts) ?? 0,
      stockout_critical: numberValue(kpis.stockout_critical) ?? 0,
      dead_capital_usd: numberValue(kpis.dead_capital_usd) ?? 0,
      margin_erosion_parts: numberValue(kpis.margin_erosion_parts) ?? 0,
      forecast_coverage: numberValue(kpis.forecast_coverage) ?? 0,
    },
    stockout_heat: normalizeStockoutRows(record.stockout_heat),
    hot_movers: normalizeHotMoverRows(record.hot_movers),
    dead_capital: normalizeDeadCapitalRows(record.dead_capital),
    margin_erosion: normalizeMarginErosionRows(record.margin_erosion),
  };
}

export function normalizeStockoutRows(rows: unknown): StockoutRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeStockoutRow).filter((row): row is StockoutRow => row !== null);
}

function normalizeStockoutRow(value: unknown): StockoutRow | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  return {
    part_number: partNumber,
    branch_code: nullableString(value.branch_code),
    description: nullableString(value.description),
    on_hand: numberValue(value.on_hand),
    days_of_stock: numberValue(value.days_of_stock),
    stockout_risk: stringValue(value.stockout_risk, "unknown"),
    daily_velocity: numberValue(value.daily_velocity),
    list_price: numberValue(value.list_price),
  };
}

export function normalizeHotMoverRows(rows: unknown): HotMoverRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeHotMoverRow).filter((row): row is HotMoverRow => row !== null);
}

function normalizeHotMoverRow(value: unknown): HotMoverRow | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  return {
    part_number: partNumber,
    branch_code: nullableString(value.branch_code),
    description: nullableString(value.description),
    history_12mo_sales: numberValue(value.history_12mo_sales) ?? 0,
    yoy_growth_pct: numberValue(value.yoy_growth_pct),
    on_hand: numberValue(value.on_hand),
    capital_on_hand: numberValue(value.capital_on_hand) ?? 0,
  };
}

export function normalizeDeadCapitalRows(rows: unknown): DeadCapitalRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeDeadCapitalRow).filter((row): row is DeadCapitalRow => row !== null);
}

function normalizeDeadCapitalRow(value: unknown): DeadCapitalRow | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  return {
    part_number: partNumber,
    branch_code: nullableString(value.branch_code),
    description: nullableString(value.description),
    on_hand: numberValue(value.on_hand),
    cost_price: numberValue(value.cost_price),
    capital_on_hand: numberValue(value.capital_on_hand) ?? 0,
    dead_pattern: deadPattern(value.dead_pattern),
  };
}

export function normalizeMarginErosionRows(rows: unknown): MarginErosionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeMarginErosionRow).filter((row): row is MarginErosionRow => row !== null);
}

function normalizeMarginErosionRow(value: unknown): MarginErosionRow | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  return {
    part_number: partNumber,
    branch_code: nullableString(value.branch_code),
    list_price: numberValue(value.list_price),
    cost_price: numberValue(value.cost_price),
    vendor_list_price: numberValue(value.vendor_list_price),
    margin_pct_on_cost: numberValue(value.margin_pct_on_cost),
    margin_pct_on_vendor_list: numberValue(value.margin_pct_on_vendor_list),
  };
}

export function normalizeSeededForecastResult(value: unknown): SeededForecastResult {
  const record = objectValue(value);
  return {
    ok: booleanValue(record.ok),
    forecasts_written: numberValue(record.forecasts_written) ?? 0,
    batch_id: stringValue(record.batch_id),
    elapsed_ms: numberValue(record.elapsed_ms) ?? 0,
  };
}

export function normalizePredictivePlaysSummary(value: unknown): PredictivePlaysSummary {
  const record = objectValue(value);
  const kpis = objectValue(record.kpis);
  return {
    kpis: {
      open_plays: numberValue(kpis.open_plays) ?? 0,
      plays_due_7d: numberValue(kpis.plays_due_7d) ?? 0,
      plays_needing_order: numberValue(kpis.plays_needing_order) ?? 0,
      projected_revenue_90d: numberValue(kpis.projected_revenue_90d) ?? 0,
      customers_touched: numberValue(kpis.customers_touched) ?? 0,
    },
    plays: normalizePredictivePlays(record.plays),
  };
}

export function normalizePredictivePlays(rows: unknown): PredictivePlay[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePredictivePlay).filter((row): row is PredictivePlay => row !== null);
}

function normalizePredictivePlay(value: unknown): PredictivePlay | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const partNumber = nullableString(value.part_number);
  const projectedDueDate = nullableString(value.projected_due_date);
  if (!id || !partNumber || !projectedDueDate) return null;
  return {
    id,
    part_number: partNumber,
    part_description: nullableString(value.part_description),
    projection_window: projectionWindow(value.projection_window),
    projected_due_date: projectedDueDate,
    days_until_due: numberValue(value.days_until_due) ?? 0,
    probability: numberValue(value.probability) ?? 0,
    reason: stringValue(value.reason),
    signal_type: signalType(value.signal_type),
    recommended_order_qty: numberValue(value.recommended_order_qty) ?? 0,
    projected_revenue: numberValue(value.projected_revenue),
    status: playStatus(value.status),
    suggested_order_by: nullableString(value.suggested_order_by),
    customer_name: nullableString(value.customer_name),
    machine_make: nullableString(value.machine_make),
    machine_model: nullableString(value.machine_model),
    machine_hours: numberValue(value.machine_hours),
    current_on_hand_across_branches: numberValue(value.current_on_hand_across_branches),
    suggested_vendor_name: nullableString(value.suggested_vendor_name),
  };
}

export function normalizePredictivePredictionResult(value: unknown): PredictivePredictionResult {
  const record = objectValue(value);
  return {
    ok: booleanValue(record.ok),
    plays_written: numberValue(record.plays_written) ?? 0,
    machines_scanned: numberValue(record.machines_scanned) ?? 0,
    elapsed_ms: numberValue(record.elapsed_ms) ?? 0,
  };
}

export function normalizeAiPredictionResult(value: unknown): AiPredictionResult {
  const record = objectValue(value);
  return {
    ok: booleanValue(record.ok),
    machines_processed: numberValue(record.machines_processed) ?? 0,
    plays_proposed: numberValue(record.plays_proposed) ?? 0,
    plays_grounded: numberValue(record.plays_grounded) ?? 0,
    plays_written: numberValue(record.plays_written) ?? 0,
    llm_errors: numberValue(record.llm_errors) ?? 0,
    grounding_rejections: numberValue(record.grounding_rejections) ?? 0,
    cost_cents: numberValue(record.cost_cents) ?? 0,
    total_tokens_in: numberValue(record.total_tokens_in) ?? 0,
    total_tokens_out: numberValue(record.total_tokens_out) ?? 0,
    elapsed_ms: numberValue(record.elapsed_ms) ?? 0,
    batch_id: stringValue(record.batch_id),
  };
}

export function normalizeLlmInferenceRunRows(rows: unknown): LlmInferenceRunRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    return {
      plays_proposed: numberValue(value.plays_proposed),
      plays_grounded: numberValue(value.plays_grounded),
      plays_written: numberValue(value.plays_written),
      tokens_in: numberValue(value.tokens_in),
      tokens_out: numberValue(value.tokens_out),
      cost_usd_cents: numberValue(value.cost_usd_cents),
      elapsed_ms: numberValue(value.elapsed_ms),
      fleet_id: nullableString(value.fleet_id),
    };
  }).filter((row): row is LlmInferenceRunRow => row !== null);
}

export function recoveredAiPredictionResultFromRuns(rows: LlmInferenceRunRow[]): AiPredictionResult {
  const machines = new Set<string>();
  const agg = rows.reduce(
    (acc, row) => {
      if (row.fleet_id) machines.add(row.fleet_id);
      acc.proposed += row.plays_proposed ?? 0;
      acc.grounded += row.plays_grounded ?? 0;
      acc.written += row.plays_written ?? 0;
      acc.tokens_in += row.tokens_in ?? 0;
      acc.tokens_out += row.tokens_out ?? 0;
      acc.cost_cents += row.cost_usd_cents ?? 0;
      acc.elapsed = Math.max(acc.elapsed, row.elapsed_ms ?? 0);
      return acc;
    },
    { proposed: 0, grounded: 0, written: 0, tokens_in: 0, tokens_out: 0, cost_cents: 0, elapsed: 0 },
  );
  return {
    ok: true,
    machines_processed: machines.size,
    plays_proposed: agg.proposed,
    plays_grounded: agg.grounded,
    plays_written: agg.written,
    llm_errors: 0,
    grounding_rejections: agg.proposed - agg.grounded,
    cost_cents: agg.cost_cents,
    total_tokens_in: agg.tokens_in,
    total_tokens_out: agg.tokens_out,
    elapsed_ms: agg.elapsed,
    batch_id: "recovered-from-gateway-timeout",
  };
}

export function normalizeEmbedBackfillResult(value: unknown): EmbedBackfillResult {
  const record = objectValue(value);
  return {
    ok: booleanValue(record.ok),
    called_by: stringValue(record.called_by),
    elapsed_ms: numberValue(record.elapsed_ms) ?? 0,
    batches: numberValue(record.batches) ?? 0,
    rows_embedded: numberValue(record.rows_embedded) ?? 0,
    rows_skipped: numberValue(record.rows_skipped) ?? 0,
    rows_errored: numberValue(record.rows_errored) ?? 0,
    api_calls: numberValue(record.api_calls) ?? 0,
    rows_remaining: numberValue(record.rows_remaining),
  };
}

export function normalizeActionPlayResult(value: unknown): ActionPlayResult {
  const record = objectValue(value);
  return {
    ok: booleanValue(record.ok),
    play_id: stringValue(record.play_id),
    status: stringValue(record.status, "open"),
    queue_action: queueAction(record.queue_action),
    queue_row_id: nullableString(record.queue_row_id),
  };
}
