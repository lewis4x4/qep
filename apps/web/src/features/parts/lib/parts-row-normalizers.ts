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

function coverageStatus(value: unknown, fallback: CoverageStatus): CoverageStatus {
  return value === "action_required" ||
    value === "watch" ||
    value === "covered" ||
    value === "no_inventory"
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
