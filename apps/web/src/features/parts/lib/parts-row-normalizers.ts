export type CoverageStatus = "action_required" | "watch" | "covered" | "no_inventory";

export type ForecastRow = {
  workspace_id: string;
  part_number: string;
  branch_id: string;
  forecast_month: string;
  predicted_qty: number;
  confidence_low: number;
  confidence_high: number;
  stockout_risk: string;
  qty_on_hand_at_forecast: number | null;
  current_qty_on_hand: number | null;
  consumption_velocity: number | null;
  current_reorder_point: number | null;
  coverage_status: CoverageStatus;
  days_of_stock_remaining: number | null;
  drivers: Record<string, unknown>;
  computed_at: string;
};

export type OrderEvent = {
  id: string;
  event_type: string;
  source: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name?: string;
};

export type CategoryRevenue = {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  line_count: number;
};

export type SourceRevenue = {
  order_source: string;
  revenue: number;
  order_count: number;
};

export type TopCustomer = {
  company_id: string;
  company_name: string;
  revenue: number;
  order_count: number;
};

export type FastMovingPart = {
  part_number: string;
  description: string;
  total_qty: number;
  total_revenue: number;
};

export type AnalyticsSnapshot = {
  id: string;
  snapshot_date: string;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  order_count: number;
  line_count: number;
  revenue_by_category: CategoryRevenue[];
  revenue_by_source: SourceRevenue[];
  top_customers: TopCustomer[];
  fastest_moving: FastMovingPart[];
  total_inventory_value: number;
  dead_stock_value: number;
  dead_stock_count: number;
};

export type VendorTrend = {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  composite_score: number | null;
  machine_down_priority: boolean;
};

export type PartActivityRow = {
  id: string;
  order_id: string;
  order_status: string;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
  created_at: string;
  customer_label: string | null;
};

export type SubstituteRow = {
  xref_id: string;
  substitute_part_number: string;
  relationship: string;
  confidence: number;
  source: string;
  fitment_notes: string | null;
  price_delta: number | null;
  lead_time_delta_days: number | null;
  qty_available: number;
  available_branch: string | null;
  catalog_description: string | null;
};

export type CustomerPartsIntel = {
  id: string;
  crm_company_id: string;
  total_spend_12m: number;
  total_spend_prior_12m: number;
  spend_trend: string;
  monthly_spend: Array<{ month: string; revenue: number }>;
  order_count_12m: number;
  avg_order_value: number;
  last_order_date: string | null;
  days_since_last_order: number | null;
  fleet_count: number;
  machines_approaching_service: number;
  predicted_next_quarter_spend: number;
  top_categories: Array<{ category: string; revenue: number; pct: number }>;
  churn_risk: string;
  recommended_outreach: string | null;
  opportunity_value: number;
  computed_at: string;
};

export type TransferRecommendation = {
  id: string;
  part_number: string;
  from_branch_id: string;
  to_branch_id: string;
  recommended_qty: number;
  from_qty_on_hand: number;
  to_qty_on_hand: number;
  to_reorder_point: number | null;
  to_forecast_demand: number | null;
  estimated_transfer_cost: number | null;
  estimated_stockout_cost_avoided: number | null;
  net_savings: number | null;
  priority: string;
  confidence: number;
  reason: string;
  status: string;
  created_at: string;
};

export type SlowMovingPart = {
  part_number: string;
  description: string;
  qty_on_hand: number;
  updated_at: string;
};

export type PredictiveKit = {
  id: string;
  fleet_id: string | null;
  crm_company_id: string | null;
  equipment_make: string | null;
  equipment_model: string | null;
  equipment_serial: string | null;
  current_hours: number | null;
  predicted_service_window: string;
  predicted_failure_type: string | null;
  confidence: number;
  kit_parts: Array<{
    part_number: string;
    description: string | null;
    quantity: number;
    unit_cost: number | null;
    in_stock: boolean;
  }>;
  kit_value: number;
  kit_part_count: number;
  stock_status: string;
  parts_in_stock: number;
  parts_total: number;
  status: string;
  nearest_branch_id: string | null;
  created_at: string;
  company_name?: string;
};

export type ReplenishQueueRow = {
  id: string;
  workspace_id: string;
  part_number: string;
  branch_id: string;
  qty_on_hand: number;
  reorder_point: number;
  recommended_qty: number;
  economic_order_qty: number | null;
  selected_vendor_id: string | null;
  vendor_score: number | null;
  vendor_selection_reason: string | null;
  estimated_unit_cost: number | null;
  estimated_total: number | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  parts_order_id: string | null;
  rejection_reason: string | null;
  expires_at: string;
  computation_batch_id: string | null;
  created_at: string;
  vendor_name?: string;
};

export type StockStatus = "stockout" | "critical" | "reorder" | "healthy" | "no_profile";

export type InventoryHealthRow = {
  inventory_id: string;
  workspace_id: string;
  branch_id: string;
  part_number: string;
  qty_on_hand: number;
  bin_location: string | null;
  catalog_id: string | null;
  reorder_point: number | null;
  safety_stock: number | null;
  economic_order_qty: number | null;
  consumption_velocity: number | null;
  avg_lead_time_days: number | null;
  reorder_computed_at: string | null;
  stock_status: StockStatus;
  days_until_stockout: number | null;
};

export type VendorMetricsRow = {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  price_competitiveness: number | null;
  composite_score: number | null;
  machine_down_priority: boolean;
};

export type PartsOrderListRow = {
  id: string;
  status: string;
  order_source: string;
  fulfillment_run_id: string | null;
  line_items: unknown;
  created_at: string;
  portal_customer_id: string | null;
  crm_company_id: string | null;
  portal_customers: { first_name: string; last_name: string; email: string } | null;
  crm_companies: { id: string; name: string } | null;
};

export type PartsOrderManagerOrderResult = {
  order: Record<string, unknown>;
};

export type PartsOrderManagerSubmitResult = {
  order: Record<string, unknown>;
  fulfillment_run_id: string;
};

export type PartsOrderManagerLinesResult = {
  lines: number;
};

export type PartsOrderManagerPickResult = {
  picked: {
    line_id: string;
    part_number: string;
    quantity: number;
    branch_id: string;
  };
};

export type VoicePartsOrderResult = {
  order_id: string;
  extraction: {
    parts: Array<{ description: string; quantity: number }>;
    is_machine_down: boolean;
    customer_name: string | null;
  };
  matches: Array<{
    input_description: string;
    matched_part: string | null;
    confidence: string;
  }>;
  is_machine_down: boolean;
  auto_submitted: boolean;
};

export type PhotoCatalogMatch = {
  part_number: string;
  description: string;
  category: string | null;
  list_price: number | null;
  match_score: number;
  match_reason: string;
  inventory: Array<{ branch_id: string; qty_on_hand: number }>;
  substitutes: Array<{ part_number: string; relationship: string }>;
};

export type PhotoPartIdentificationResult = {
  identification: {
    identified_parts: Array<{
      description: string;
      part_type: string | null;
      condition: string | null;
      wear_indicators: string[];
      confidence: number;
    }>;
    equipment_context: {
      make: string | null;
      model: string | null;
      system: string | null;
    } | null;
  };
  catalog_matches: PhotoCatalogMatch[];
  has_matches: boolean;
};

type CrossReferenceDirection = "outbound" | "inbound";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
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

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function coverageStatus(value: unknown, fallback: CoverageStatus): CoverageStatus {
  return value === "action_required" ||
    value === "watch" ||
    value === "covered" ||
    value === "no_inventory"
    ? value
    : fallback;
}

function stockStatus(value: unknown, fallback: StockStatus): StockStatus {
  return value === "stockout" ||
    value === "critical" ||
    value === "reorder" ||
    value === "healthy" ||
    value === "no_profile"
    ? value
    : fallback;
}

function coverageFromRisk(value: unknown): CoverageStatus {
  return value === "critical" ? "action_required" : "watch";
}

export function normalizeForecastRows(rows: unknown, options?: { fallbackFromRisk?: boolean }): ForecastRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => normalizeForecastRow(value, options)).filter((row): row is ForecastRow => row !== null);
}

function normalizeForecastRow(value: unknown, options?: { fallbackFromRisk?: boolean }): ForecastRow | null {
  if (!isRecord(value)) return null;
  const workspaceId = nullableString(value.workspace_id);
  const partNumber = nullableString(value.part_number);
  const branchId = nullableString(value.branch_id);
  const forecastMonth = nullableString(value.forecast_month);
  const computedAt = nullableString(value.computed_at);
  if (!workspaceId || !partNumber || !branchId || !forecastMonth || !computedAt) return null;
  const fallbackCoverage = options?.fallbackFromRisk ? coverageFromRisk(value.stockout_risk) : "covered";
  return {
    workspace_id: workspaceId,
    part_number: partNumber,
    branch_id: branchId,
    forecast_month: forecastMonth,
    predicted_qty: numberValue(value.predicted_qty) ?? 0,
    confidence_low: numberValue(value.confidence_low) ?? 0,
    confidence_high: numberValue(value.confidence_high) ?? 0,
    stockout_risk: stringValue(value.stockout_risk, "unknown"),
    qty_on_hand_at_forecast: numberValue(value.qty_on_hand_at_forecast),
    current_qty_on_hand: numberValue(value.current_qty_on_hand),
    consumption_velocity: numberValue(value.consumption_velocity),
    current_reorder_point: numberValue(value.current_reorder_point),
    coverage_status: coverageStatus(value.coverage_status, fallbackCoverage),
    days_of_stock_remaining: numberValue(value.days_of_stock_remaining),
    drivers: recordValue(value.drivers),
    computed_at: computedAt,
  };
}

export function normalizeOrderEvents(rows: unknown): OrderEvent[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeOrderEvent).filter((row): row is OrderEvent => row !== null);
}

function normalizeOrderEvent(value: unknown): OrderEvent | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const eventType = nullableString(value.event_type);
  const source = nullableString(value.source);
  const createdAt = nullableString(value.created_at);
  if (!id || !eventType || !source || !createdAt) return null;
  const profile = firstRecord(value.profiles);
  const actorName = nullableString(profile?.full_name);
  return {
    id,
    event_type: eventType,
    source,
    actor_id: nullableString(value.actor_id),
    from_status: nullableString(value.from_status),
    to_status: nullableString(value.to_status),
    metadata: recordValue(value.metadata),
    created_at: createdAt,
    ...(actorName ? { actor_name: actorName } : {}),
  };
}

export function normalizeAnalyticsSnapshot(value: unknown): AnalyticsSnapshot | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const snapshotDate = nullableString(value.snapshot_date);
  if (!id || !snapshotDate) return null;
  return {
    id,
    snapshot_date: snapshotDate,
    total_revenue: numberValue(value.total_revenue) ?? 0,
    total_cost: numberValue(value.total_cost) ?? 0,
    total_margin: numberValue(value.total_margin) ?? 0,
    order_count: numberValue(value.order_count) ?? 0,
    line_count: numberValue(value.line_count) ?? 0,
    revenue_by_category: normalizeCategoryRevenueRows(value.revenue_by_category),
    revenue_by_source: normalizeSourceRevenueRows(value.revenue_by_source),
    top_customers: normalizeTopCustomerRows(value.top_customers),
    fastest_moving: normalizeFastMovingParts(value.fastest_moving),
    total_inventory_value: numberValue(value.total_inventory_value) ?? 0,
    dead_stock_value: numberValue(value.dead_stock_value) ?? 0,
    dead_stock_count: numberValue(value.dead_stock_count) ?? 0,
  };
}

function normalizeCategoryRevenueRows(rows: unknown): CategoryRevenue[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): CategoryRevenue | null => {
    if (!isRecord(value)) return null;
    const category = nullableString(value.category);
    if (!category) return null;
    return {
      category,
      revenue: numberValue(value.revenue) ?? 0,
      cost: numberValue(value.cost) ?? 0,
      margin: numberValue(value.margin) ?? 0,
      line_count: numberValue(value.line_count) ?? 0,
    };
  }).filter((row): row is CategoryRevenue => row !== null);
}

function normalizeSourceRevenueRows(rows: unknown): SourceRevenue[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): SourceRevenue | null => {
    if (!isRecord(value)) return null;
    const orderSource = nullableString(value.order_source);
    if (!orderSource) return null;
    return {
      order_source: orderSource,
      revenue: numberValue(value.revenue) ?? 0,
      order_count: numberValue(value.order_count) ?? 0,
    };
  }).filter((row): row is SourceRevenue => row !== null);
}

function normalizeTopCustomerRows(rows: unknown): TopCustomer[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): TopCustomer | null => {
    if (!isRecord(value)) return null;
    const companyId = nullableString(value.company_id);
    const companyName = nullableString(value.company_name);
    if (!companyId || !companyName) return null;
    return {
      company_id: companyId,
      company_name: companyName,
      revenue: numberValue(value.revenue) ?? 0,
      order_count: numberValue(value.order_count) ?? 0,
    };
  }).filter((row): row is TopCustomer => row !== null);
}

export function normalizeFastMovingParts(rows: unknown): FastMovingPart[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): FastMovingPart | null => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    if (!partNumber) return null;
    return {
      part_number: partNumber,
      description: stringValue(value.description),
      total_qty: numberValue(value.total_qty) ?? 0,
      total_revenue: numberValue(value.total_revenue) ?? 0,
    };
  }).filter((row): row is FastMovingPart => row !== null);
}

export function normalizeSlowMovingParts(rows: unknown): SlowMovingPart[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): SlowMovingPart | null => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    const updatedAt = nullableString(value.updated_at);
    if (!partNumber || !updatedAt) return null;
    return {
      part_number: partNumber,
      description: stringValue(value.description),
      qty_on_hand: numberValue(value.qty_on_hand) ?? 0,
      updated_at: updatedAt,
    };
  }).filter((row): row is SlowMovingPart => row !== null);
}

export function normalizeVendorTrends(rows: unknown): VendorTrend[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): VendorTrend | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const name = nullableString(value.name);
    if (!id || !name) return null;
    return {
      id,
      name,
      avg_lead_time_hours: numberValue(value.avg_lead_time_hours),
      responsiveness_score: numberValue(value.responsiveness_score),
      fill_rate: numberValue(value.fill_rate),
      composite_score: numberValue(value.composite_score),
      machine_down_priority: value.machine_down_priority === true,
    };
  }).filter((row): row is VendorTrend => row !== null);
}

export function normalizePartActivityRows(rows: unknown): PartActivityRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePartActivityRow).filter((row): row is PartActivityRow => row !== null);
}

function normalizePartActivityRow(value: unknown): PartActivityRow | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const createdAt = nullableString(value.created_at);
  const order = firstRecord(value.parts_orders);
  const orderId = nullableString(order?.id);
  const status = nullableString(order?.status);
  if (!id || !createdAt || !orderId || !status) return null;
  const portalCustomer = firstRecord(order?.portal_customers);
  const company = firstRecord(order?.crm_companies);
  const portalName = portalCustomer
    ? `${nullableString(portalCustomer.first_name) ?? ""} ${nullableString(portalCustomer.last_name) ?? ""}`.trim()
    : "";
  return {
    id,
    order_id: orderId,
    order_status: status,
    quantity: numberValue(value.quantity) ?? 0,
    unit_price: numberValue(value.unit_price),
    line_total: numberValue(value.line_total),
    created_at: createdAt,
    customer_label: nullableString(company?.name) ?? (portalName.length > 0 ? portalName : null),
  };
}

export function normalizeSubstituteRows(rows: unknown): SubstituteRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeSubstituteRow).filter((row): row is SubstituteRow => row !== null);
}

function normalizeSubstituteRow(value: unknown): SubstituteRow | null {
  if (!isRecord(value)) return null;
  const xrefId = nullableString(value.xref_id) ?? nullableString(value.id);
  const substitutePartNumber = nullableString(value.substitute_part_number);
  const relationship = nullableString(value.relationship);
  const source = nullableString(value.source);
  if (!xrefId || !substitutePartNumber || !relationship || !source) return null;
  return {
    xref_id: xrefId,
    substitute_part_number: substitutePartNumber,
    relationship,
    confidence: numberValue(value.confidence) ?? 0,
    source,
    fitment_notes: nullableString(value.fitment_notes),
    price_delta: numberValue(value.price_delta),
    lead_time_delta_days: numberValue(value.lead_time_delta_days),
    qty_available: numberValue(value.qty_available) ?? 0,
    available_branch: nullableString(value.available_branch),
    catalog_description: nullableString(value.catalog_description),
  };
}

export function normalizeCrossReferenceFallbackRows(
  rows: unknown,
  direction: CrossReferenceDirection,
): SubstituteRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): SubstituteRow | null => {
    if (!isRecord(value)) return null;
    const xrefId = nullableString(value.id);
    const substitutePartNumber = direction === "outbound"
      ? nullableString(value.part_number_b)
      : nullableString(value.part_number_a);
    const relationship = nullableString(value.relationship);
    const source = nullableString(value.source);
    if (!xrefId || !substitutePartNumber || !relationship || !source) return null;
    const priceDelta = numberValue(value.price_delta);
    const leadTimeDelta = numberValue(value.lead_time_delta_days);
    return {
      xref_id: xrefId,
      substitute_part_number: substitutePartNumber,
      relationship,
      confidence: numberValue(value.confidence) ?? 0,
      source,
      fitment_notes: nullableString(value.fitment_notes),
      price_delta: direction === "inbound" && priceDelta !== null ? -priceDelta : priceDelta,
      lead_time_delta_days: direction === "inbound" && leadTimeDelta !== null ? -leadTimeDelta : leadTimeDelta,
      qty_available: 0,
      available_branch: null,
      catalog_description: null,
    };
  }).filter((row): row is SubstituteRow => row !== null);
}

export function normalizeCustomerPartsIntel(value: unknown): CustomerPartsIntel | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const crmCompanyId = nullableString(value.crm_company_id);
  const computedAt = nullableString(value.computed_at);
  if (!id || !crmCompanyId || !computedAt) return null;
  return {
    id,
    crm_company_id: crmCompanyId,
    total_spend_12m: numberValue(value.total_spend_12m) ?? 0,
    total_spend_prior_12m: numberValue(value.total_spend_prior_12m) ?? 0,
    spend_trend: stringValue(value.spend_trend, "unknown"),
    monthly_spend: normalizeMonthlySpend(value.monthly_spend),
    order_count_12m: numberValue(value.order_count_12m) ?? 0,
    avg_order_value: numberValue(value.avg_order_value) ?? 0,
    last_order_date: nullableString(value.last_order_date),
    days_since_last_order: numberValue(value.days_since_last_order),
    fleet_count: numberValue(value.fleet_count) ?? 0,
    machines_approaching_service: numberValue(value.machines_approaching_service) ?? 0,
    predicted_next_quarter_spend: numberValue(value.predicted_next_quarter_spend) ?? 0,
    top_categories: normalizeTopCategories(value.top_categories),
    churn_risk: stringValue(value.churn_risk, "unknown"),
    recommended_outreach: nullableString(value.recommended_outreach),
    opportunity_value: numberValue(value.opportunity_value) ?? 0,
    computed_at: computedAt,
  };
}

function normalizeMonthlySpend(rows: unknown): CustomerPartsIntel["monthly_spend"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const month = nullableString(value.month);
    if (!month) return null;
    return {
      month,
      revenue: numberValue(value.revenue) ?? 0,
    };
  }).filter((row): row is CustomerPartsIntel["monthly_spend"][number] => row !== null);
}

function normalizeTopCategories(rows: unknown): CustomerPartsIntel["top_categories"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const category = nullableString(value.category);
    if (!category) return null;
    return {
      category,
      revenue: numberValue(value.revenue) ?? 0,
      pct: numberValue(value.pct) ?? 0,
    };
  }).filter((row): row is CustomerPartsIntel["top_categories"][number] => row !== null);
}

export function normalizeTransferRecommendations(rows: unknown): TransferRecommendation[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): TransferRecommendation | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const partNumber = nullableString(value.part_number);
    const fromBranchId = nullableString(value.from_branch_id);
    const toBranchId = nullableString(value.to_branch_id);
    const priority = nullableString(value.priority);
    const status = nullableString(value.status);
    const createdAt = nullableString(value.created_at);
    if (!id || !partNumber || !fromBranchId || !toBranchId || !priority || !status || !createdAt) return null;
    return {
      id,
      part_number: partNumber,
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      recommended_qty: numberValue(value.recommended_qty) ?? 0,
      from_qty_on_hand: numberValue(value.from_qty_on_hand) ?? 0,
      to_qty_on_hand: numberValue(value.to_qty_on_hand) ?? 0,
      to_reorder_point: numberValue(value.to_reorder_point),
      to_forecast_demand: numberValue(value.to_forecast_demand),
      estimated_transfer_cost: numberValue(value.estimated_transfer_cost),
      estimated_stockout_cost_avoided: numberValue(value.estimated_stockout_cost_avoided),
      net_savings: numberValue(value.net_savings),
      priority,
      confidence: numberValue(value.confidence) ?? 0,
      reason: stringValue(value.reason),
      status,
      created_at: createdAt,
    };
  }).filter((row): row is TransferRecommendation => row !== null);
}

export function normalizePredictiveKits(rows: unknown): PredictiveKit[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PredictiveKit | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const predictedServiceWindow = nullableString(value.predicted_service_window);
    const stock = nullableString(value.stock_status);
    const status = nullableString(value.status);
    const createdAt = nullableString(value.created_at);
    if (!id || !predictedServiceWindow || !stock || !status || !createdAt) return null;
    const company = firstRecord(value.crm_companies);
    return {
      id,
      fleet_id: nullableString(value.fleet_id),
      crm_company_id: nullableString(value.crm_company_id),
      equipment_make: nullableString(value.equipment_make),
      equipment_model: nullableString(value.equipment_model),
      equipment_serial: nullableString(value.equipment_serial),
      current_hours: numberValue(value.current_hours),
      predicted_service_window: predictedServiceWindow,
      predicted_failure_type: nullableString(value.predicted_failure_type),
      confidence: numberValue(value.confidence) ?? 0,
      kit_parts: normalizeKitParts(value.kit_parts),
      kit_value: numberValue(value.kit_value) ?? 0,
      kit_part_count: numberValue(value.kit_part_count) ?? 0,
      stock_status: stock,
      parts_in_stock: numberValue(value.parts_in_stock) ?? 0,
      parts_total: numberValue(value.parts_total) ?? 0,
      status,
      nearest_branch_id: nullableString(value.nearest_branch_id),
      created_at: createdAt,
      ...(nullableString(company?.name) ? { company_name: nullableString(company?.name) ?? undefined } : {}),
    };
  }).filter((row): row is PredictiveKit => row !== null);
}

function normalizeKitParts(rows: unknown): PredictiveKit["kit_parts"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    if (!partNumber) return null;
    return {
      part_number: partNumber,
      description: nullableString(value.description),
      quantity: numberValue(value.quantity) ?? 1,
      unit_cost: numberValue(value.unit_cost),
      in_stock: value.in_stock === true,
    };
  }).filter((row): row is PredictiveKit["kit_parts"][number] => row !== null);
}

export function normalizeReplenishQueueRows(rows: unknown): ReplenishQueueRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): ReplenishQueueRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const workspaceId = nullableString(value.workspace_id);
    const partNumber = nullableString(value.part_number);
    const branchId = nullableString(value.branch_id);
    const status = nullableString(value.status);
    const expiresAt = nullableString(value.expires_at);
    const createdAt = nullableString(value.created_at);
    if (!id || !workspaceId || !partNumber || !branchId || !status || !expiresAt || !createdAt) return null;
    const vendor = firstRecord(value.vendor_profiles);
    return {
      id,
      workspace_id: workspaceId,
      part_number: partNumber,
      branch_id: branchId,
      qty_on_hand: numberValue(value.qty_on_hand) ?? 0,
      reorder_point: numberValue(value.reorder_point) ?? 0,
      recommended_qty: numberValue(value.recommended_qty) ?? 0,
      economic_order_qty: numberValue(value.economic_order_qty),
      selected_vendor_id: nullableString(value.selected_vendor_id),
      vendor_score: numberValue(value.vendor_score),
      vendor_selection_reason: nullableString(value.vendor_selection_reason),
      estimated_unit_cost: numberValue(value.estimated_unit_cost),
      estimated_total: numberValue(value.estimated_total),
      status,
      approved_by: nullableString(value.approved_by),
      approved_at: nullableString(value.approved_at),
      parts_order_id: nullableString(value.parts_order_id),
      rejection_reason: nullableString(value.rejection_reason),
      expires_at: expiresAt,
      computation_batch_id: nullableString(value.computation_batch_id),
      created_at: createdAt,
      ...(nullableString(vendor?.name) ? { vendor_name: nullableString(vendor?.name) ?? undefined } : {}),
    };
  }).filter((row): row is ReplenishQueueRow => row !== null);
}

export function normalizeInventoryHealthRows(rows: unknown): InventoryHealthRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): InventoryHealthRow | null => {
    if (!isRecord(value)) return null;
    const inventoryId = nullableString(value.inventory_id) ?? nullableString(value.id);
    const branchId = nullableString(value.branch_id);
    const partNumber = nullableString(value.part_number);
    if (!inventoryId || !branchId || !partNumber) return null;
    const qtyOnHand = numberValue(value.qty_on_hand) ?? 0;
    return {
      inventory_id: inventoryId,
      workspace_id: stringValue(value.workspace_id),
      branch_id: branchId,
      part_number: partNumber,
      qty_on_hand: qtyOnHand,
      bin_location: nullableString(value.bin_location),
      catalog_id: nullableString(value.catalog_id),
      reorder_point: numberValue(value.reorder_point),
      safety_stock: numberValue(value.safety_stock),
      economic_order_qty: numberValue(value.economic_order_qty),
      consumption_velocity: numberValue(value.consumption_velocity),
      avg_lead_time_days: numberValue(value.avg_lead_time_days),
      reorder_computed_at: nullableString(value.reorder_computed_at),
      stock_status: stockStatus(value.stock_status, qtyOnHand <= 0 ? "stockout" : "critical"),
      days_until_stockout: numberValue(value.days_until_stockout),
    };
  }).filter((row): row is InventoryHealthRow => row !== null);
}

export function normalizeVendorMetricsRows(rows: unknown): VendorMetricsRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): VendorMetricsRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const name = nullableString(value.name);
    if (!id || !name) return null;
    return {
      id,
      name,
      avg_lead_time_hours: numberValue(value.avg_lead_time_hours),
      responsiveness_score: numberValue(value.responsiveness_score),
      fill_rate: numberValue(value.fill_rate),
      price_competitiveness: numberValue(value.price_competitiveness),
      composite_score: numberValue(value.composite_score),
      machine_down_priority: value.machine_down_priority === true,
    };
  }).filter((row): row is VendorMetricsRow => row !== null);
}

export function normalizePartsOrderListRows(rows: unknown): PartsOrderListRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PartsOrderListRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const status = nullableString(value.status);
    const orderSource = nullableString(value.order_source);
    const createdAt = nullableString(value.created_at);
    if (!id || !status || !orderSource || !createdAt) return null;
    const portalCustomer = firstRecord(value.portal_customers);
    const company = firstRecord(value.crm_companies);
    return {
      id,
      status,
      order_source: orderSource,
      fulfillment_run_id: nullableString(value.fulfillment_run_id),
      line_items: value.line_items,
      created_at: createdAt,
      portal_customer_id: nullableString(value.portal_customer_id),
      crm_company_id: nullableString(value.crm_company_id),
      portal_customers: portalCustomer
        ? {
            first_name: stringValue(portalCustomer.first_name),
            last_name: stringValue(portalCustomer.last_name),
            email: stringValue(portalCustomer.email),
          }
        : null,
      crm_companies: company && nullableString(company.id) && nullableString(company.name)
        ? {
            id: nullableString(company.id) ?? "",
            name: nullableString(company.name) ?? "",
          }
        : null,
    };
  }).filter((row): row is PartsOrderListRow => row !== null);
}

function malformedEdgeResponse(message: string): Error {
  return new Error(message);
}

export function normalizeOrderManagerOrderResult(value: unknown): PartsOrderManagerOrderResult {
  if (!isRecord(value) || !isRecord(value.order)) {
    throw malformedEdgeResponse("Malformed parts order manager response: missing order.");
  }
  return { order: value.order };
}

export function normalizeOrderManagerSubmitResult(value: unknown): PartsOrderManagerSubmitResult {
  const base = normalizeOrderManagerOrderResult(value);
  if (!isRecord(value)) {
    throw malformedEdgeResponse("Malformed parts order manager response.");
  }
  const fulfillmentRunId = nullableString(value.fulfillment_run_id);
  if (!fulfillmentRunId) {
    throw malformedEdgeResponse("Malformed parts order manager response: missing fulfillment run.");
  }
  return { ...base, fulfillment_run_id: fulfillmentRunId };
}

export function normalizeOrderManagerLinesResult(value: unknown): PartsOrderManagerLinesResult {
  if (!isRecord(value)) {
    throw malformedEdgeResponse("Malformed parts order manager response.");
  }
  const lines = numberValue(value.lines);
  if (lines === null) {
    throw malformedEdgeResponse("Malformed parts order manager response: missing line count.");
  }
  return { lines };
}

export function normalizeOrderManagerPickResult(value: unknown): PartsOrderManagerPickResult {
  if (!isRecord(value) || !isRecord(value.picked)) {
    throw malformedEdgeResponse("Malformed parts order manager response: missing picked line.");
  }
  const lineId = nullableString(value.picked.line_id);
  const partNumber = nullableString(value.picked.part_number);
  const branchId = nullableString(value.picked.branch_id);
  const quantity = numberValue(value.picked.quantity);
  if (!lineId || !partNumber || !branchId || quantity === null) {
    throw malformedEdgeResponse("Malformed parts order manager response: invalid picked line.");
  }
  return {
    picked: {
      line_id: lineId,
      part_number: partNumber,
      quantity,
      branch_id: branchId,
    },
  };
}

export function normalizeVoicePartsOrderResult(value: unknown): VoicePartsOrderResult {
  const record = recordValue(value);
  const extraction = recordValue(record.extraction);
  return {
    order_id: stringValue(record.order_id),
    extraction: {
      parts: normalizeVoiceExtractedParts(extraction.parts),
      is_machine_down: extraction.is_machine_down === true,
      customer_name: nullableString(extraction.customer_name),
    },
    matches: normalizeVoiceMatches(record.matches),
    is_machine_down: record.is_machine_down === true,
    auto_submitted: record.auto_submitted === true,
  };
}

function normalizeVoiceExtractedParts(rows: unknown): VoicePartsOrderResult["extraction"]["parts"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const description = nullableString(value.description);
    if (!description) return null;
    return {
      description,
      quantity: numberValue(value.quantity) ?? 1,
    };
  }).filter((row): row is VoicePartsOrderResult["extraction"]["parts"][number] => row !== null);
}

function normalizeVoiceMatches(rows: unknown): VoicePartsOrderResult["matches"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const inputDescription = nullableString(value.input_description);
    if (!inputDescription) return null;
    return {
      input_description: inputDescription,
      matched_part: nullableString(value.matched_part),
      confidence: stringValue(value.confidence, "unknown"),
    };
  }).filter((row): row is VoicePartsOrderResult["matches"][number] => row !== null);
}

export function normalizePhotoPartIdentificationResult(value: unknown): PhotoPartIdentificationResult {
  const record = recordValue(value);
  const identification = recordValue(record.identification);
  const equipmentContext = firstRecord(identification.equipment_context);
  const catalogMatches = normalizePhotoCatalogMatches(record.catalog_matches);
  return {
    identification: {
      identified_parts: normalizeIdentifiedPhotoParts(identification.identified_parts),
      equipment_context: equipmentContext
        ? {
            make: nullableString(equipmentContext.make),
            model: nullableString(equipmentContext.model),
            system: nullableString(equipmentContext.system),
          }
        : null,
    },
    catalog_matches: catalogMatches,
    has_matches: record.has_matches === true || catalogMatches.length > 0,
  };
}

function normalizeIdentifiedPhotoParts(rows: unknown): PhotoPartIdentificationResult["identification"]["identified_parts"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const description = nullableString(value.description);
    if (!description) return null;
    return {
      description,
      part_type: nullableString(value.part_type),
      condition: nullableString(value.condition),
      wear_indicators: stringArray(value.wear_indicators),
      confidence: numberValue(value.confidence) ?? 0,
    };
  }).filter((row): row is PhotoPartIdentificationResult["identification"]["identified_parts"][number] => row !== null);
}

function normalizePhotoCatalogMatches(rows: unknown): PhotoCatalogMatch[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PhotoCatalogMatch | null => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    const description = nullableString(value.description);
    if (!partNumber || !description) return null;
    return {
      part_number: partNumber,
      description,
      category: nullableString(value.category),
      list_price: numberValue(value.list_price),
      match_score: numberValue(value.match_score) ?? 0,
      match_reason: stringValue(value.match_reason),
      inventory: normalizePhotoInventoryRows(value.inventory),
      substitutes: normalizePhotoSubstitutes(value.substitutes),
    };
  }).filter((row): row is PhotoCatalogMatch => row !== null);
}

function normalizePhotoInventoryRows(rows: unknown): PhotoCatalogMatch["inventory"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const branchId = nullableString(value.branch_id);
    if (!branchId) return null;
    return {
      branch_id: branchId,
      qty_on_hand: numberValue(value.qty_on_hand) ?? 0,
    };
  }).filter((row): row is PhotoCatalogMatch["inventory"][number] => row !== null);
}

function normalizePhotoSubstitutes(rows: unknown): PhotoCatalogMatch["substitutes"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    const relationship = nullableString(value.relationship);
    if (!partNumber || !relationship) return null;
    return { part_number: partNumber, relationship };
  }).filter((row): row is PhotoCatalogMatch["substitutes"][number] => row !== null);
}
