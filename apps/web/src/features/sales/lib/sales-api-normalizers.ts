import type {
  BriefingContent,
  CustomerActivity,
  CustomerEquipment,
  CustomerEquipmentSummary,
  DailyBriefing,
  HeatStatus,
  MorningBriefingMetadata,
  ManagerPendingApproval,
  PendingApprovals,
  RepCustomer,
  RepPipelineDeal,
  RepStuckApproval,
  TodayBriefing,
} from "./types";

export interface DealStageOption {
  id: string;
  name: string;
  sort_order: number;
}

const HEAT_STATUSES = new Set<HeatStatus>(["warm", "cooling", "cold"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteNumberOrDefault(value: unknown, fallback = 0): number {
  return finiteNumberOrNull(value) ?? fallback;
}

function integerOrNull(value: unknown): number | null {
  const parsed = finiteNumberOrNull(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function validDateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePendingApprovals(value: unknown): PendingApprovals | undefined {
  // Tolerate missing field (legacy briefings generated before Phase 2C).
  if (!isRecord(value)) return undefined;

  const repStuck: RepStuckApproval[] = Array.isArray(value.rep_stuck)
    ? value.rep_stuck.flatMap((item) => {
        if (!isRecord(item)) return [];
        const quotePackageId = stringOrNull(item.quote_package_id);
        const submittedAt = validDateStringOrNull(item.submitted_at);
        if (!quotePackageId || !submittedAt) return [];
        return [{
          quote_package_id: quotePackageId,
          quote_number: stringOrNull(item.quote_number),
          customer_name: stringOrNull(item.customer_name),
          total_amount: finiteNumberOrNull(item.total_amount),
          submitted_at: submittedAt,
          hours_pending: finiteNumberOrDefault(item.hours_pending),
          assigned_role: stringOrNull(item.assigned_role),
        }];
      })
    : [];

  const managerPending: ManagerPendingApproval[] = Array.isArray(value.manager_pending)
    ? value.manager_pending.flatMap((item) => {
        if (!isRecord(item)) return [];
        const caseId = stringOrNull(item.approval_case_id);
        const quotePackageId = stringOrNull(item.quote_package_id);
        const submittedAt = validDateStringOrNull(item.submitted_at);
        if (!caseId || !quotePackageId || !submittedAt) return [];
        return [{
          approval_case_id: caseId,
          quote_package_id: quotePackageId,
          quote_number: stringOrNull(item.quote_number),
          customer_name: stringOrNull(item.customer_name),
          total_amount: finiteNumberOrNull(item.total_amount),
          margin_pct: finiteNumberOrNull(item.margin_pct),
          submitted_at: submittedAt,
          submitted_by_name: stringOrNull(item.submitted_by_name),
          hours_pending: finiteNumberOrDefault(item.hours_pending),
        }];
      })
    : [];

  return {
    rep_stuck: repStuck,
    manager_pending: managerPending,
    manager_pending_count: finiteNumberOrDefault(value.manager_pending_count),
  };
}

function normalizeBriefingContent(value: unknown): BriefingContent {
  const record = isRecord(value) ? value : {};
  const stats = isRecord(record.stats) ? record.stats : {};
  const pendingApprovals = normalizePendingApprovals(record.pending_approvals);

  return {
    greeting: stringOrNull(record.greeting) ?? "",
    priority_actions: Array.isArray(record.priority_actions)
      ? record.priority_actions.flatMap((item) => {
          if (!isRecord(item)) return [];
          const summary = stringOrNull(item.summary);
          if (!summary) return [];
          return [{
            type: stringOrNull(item.type) ?? "general",
            customer_name: stringOrNull(item.customer_name),
            deal_id: stringOrNull(item.deal_id),
            summary,
          }];
        })
      : [],
    expiring_quotes: Array.isArray(record.expiring_quotes)
      ? record.expiring_quotes.flatMap((item) => {
          if (!isRecord(item)) return [];
          const quoteId = stringOrNull(item.quote_id);
          if (!quoteId) return [];
          return [{
            quote_id: quoteId,
            customer_name: stringOrNull(item.customer_name),
            equipment: stringOrNull(item.equipment),
            status: stringOrNull(item.status) ?? "unknown",
          }];
        })
      : [],
    opportunities: Array.isArray(record.opportunities)
      ? record.opportunities.flatMap((item) => {
          if (!isRecord(item)) return [];
          const summary = stringOrNull(item.summary);
          if (!summary) return [];
          return [{ type: stringOrNull(item.type) ?? "general", summary }];
        })
      : [],
    prep_cards: Array.isArray(record.prep_cards)
      ? record.prep_cards.flatMap((item) => {
          if (!isRecord(item)) return [];
          return [{
            customer_id: stringOrNull(item.customer_id),
            customer_name: stringOrNull(item.customer_name),
            meeting_time: validDateStringOrNull(item.meeting_time) ?? stringOrNull(item.meeting_time),
            fleet_summary: stringOrNull(item.fleet_summary),
            last_interaction: stringOrNull(item.last_interaction),
            talking_points: stringArray(item.talking_points),
          }];
        })
      : [],
    stats: {
      deals_in_pipeline: finiteNumberOrDefault(stats.deals_in_pipeline),
      quotes_sent_this_week: finiteNumberOrDefault(stats.quotes_sent_this_week),
      total_pipeline_value: finiteNumberOrDefault(stats.total_pipeline_value),
    },
    ...(pendingApprovals ? { pending_approvals: pendingApprovals } : {}),
  };
}

export function normalizeMorningBriefingMetadata(value: unknown): MorningBriefingMetadata {
  return isRecord(value) ? { ...value } as MorningBriefingMetadata : {};
}

export function normalizeBriefingContentFromMorningData(
  data: MorningBriefingMetadata,
): BriefingContent {
  if (isRecord(data.sales_today)) {
    return normalizeBriefingContent(data.sales_today);
  }

  return normalizeBriefingContent({
    stats: {
      deals_in_pipeline: data.open_deal_count,
      quotes_sent_this_week: data.quotes_sent_this_week,
      total_pipeline_value: data.pipeline_total,
    },
  });
}

export function normalizeTodayBriefing(row: unknown): TodayBriefing | null {
  if (!isRecord(row)) return null;
  const id = stringOrNull(row.id);
  const briefingDate = stringOrNull(row.briefing_date);
  const createdAt = validDateStringOrNull(row.created_at);
  const content = typeof row.content === "string" ? row.content : "";
  if (!id || !briefingDate || !createdAt) return null;

  const data = normalizeMorningBriefingMetadata(row.data);
  return {
    id,
    briefing_date: briefingDate,
    content,
    data,
    briefing_content: normalizeBriefingContentFromMorningData(data),
    created_at: createdAt,
  };
}

/** @deprecated Sales Today now reads morning_briefings via normalizeTodayBriefing. */
export function normalizeDailyBriefing(row: unknown): DailyBriefing | null {
  if (!isRecord(row)) return null;
  const id = stringOrNull(row.id);
  const briefingDate = stringOrNull(row.briefing_date);
  const createdAt = validDateStringOrNull(row.created_at);
  if (!id || !briefingDate || !createdAt) return null;

  return {
    id,
    briefing_date: briefingDate,
    content: "",
    data: {},
    briefing_content: normalizeBriefingContent(row.briefing_content),
    created_at: createdAt,
  };
}

export function normalizeRepPipelineDeals(rows: unknown): RepPipelineDeal[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const dealId = stringOrNull(row.deal_id);
    const companyId = stringOrNull(row.company_id);
    const customerName = stringOrNull(row.customer_name);
    const dealName = stringOrNull(row.deal_name);
    const createdAt = validDateStringOrNull(row.created_at);
    const updatedAt = validDateStringOrNull(row.updated_at);
    if (!dealId || !companyId || !customerName || !dealName || !createdAt || !updatedAt) return [];

    const heatStatus = stringOrNull(row.heat_status);
    return [{
      deal_id: dealId,
      company_id: companyId,
      customer_name: customerName,
      primary_contact_name: stringOrNull(row.primary_contact_name),
      primary_contact_phone: stringOrNull(row.primary_contact_phone),
      stage: stringOrNull(row.stage) ?? "Unknown",
      stage_sort: finiteNumberOrDefault(row.stage_sort),
      amount: finiteNumberOrNull(row.amount),
      deal_name: dealName,
      created_at: createdAt,
      updated_at: updatedAt,
      expected_close_on: validDateStringOrNull(row.expected_close_on),
      last_activity_at: validDateStringOrNull(row.last_activity_at),
      next_follow_up_at: validDateStringOrNull(row.next_follow_up_at),
      days_since_activity: finiteNumberOrNull(row.days_since_activity),
      heat_status: heatStatus && HEAT_STATUSES.has(heatStatus as HeatStatus) ? heatStatus as HeatStatus : "cold",
      deal_score: finiteNumberOrNull(row.deal_score),
    }];
  });
}

function normalizeEquipmentSummary(value: unknown): CustomerEquipmentSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      make: stringOrNull(item.make),
      model: stringOrNull(item.model),
      year: integerOrNull(item.year),
      category: stringOrNull(item.category),
      name: stringOrNull(item.name),
    }];
  });
}

export function normalizeRepCustomers(rows: unknown): RepCustomer[] {
  if (!Array.isArray(rows)) return [];

  const normalized = rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const customerId = stringOrNull(row.customer_id);
    const companyName = stringOrNull(row.company_name);
    if (!customerId || !companyName) return [];

    return [{
      customer_id: customerId,
      company_name: companyName,
      search_1: stringOrNull(row.search_1),
      search_2: stringOrNull(row.search_2),
      primary_contact_name: stringOrNull(row.primary_contact_name),
      primary_contact_phone: stringOrNull(row.primary_contact_phone),
      primary_contact_email: stringOrNull(row.primary_contact_email),
      city: stringOrNull(row.city),
      state: stringOrNull(row.state),
      open_deals: finiteNumberOrDefault(row.open_deals),
      active_quotes: finiteNumberOrDefault(row.active_quotes),
      last_interaction: validDateStringOrNull(row.last_interaction),
      days_since_contact: finiteNumberOrNull(row.days_since_contact),
      opportunity_score: finiteNumberOrDefault(row.opportunity_score),
      equipment_summary: normalizeEquipmentSummary(row.equipment_summary),
    }];
  });

  const byCustomerId = new Map<string, RepCustomer>();
  for (const row of normalized) {
    if (!byCustomerId.has(row.customer_id)) byCustomerId.set(row.customer_id, row);
  }
  return [...byCustomerId.values()];
}

export function normalizeCustomerEquipmentRows(rows: unknown): CustomerEquipment[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    if (!id) return [];

    return [{
      id,
      make: stringOrNull(row.make),
      model: stringOrNull(row.model),
      year: integerOrNull(row.year),
      serial_number: stringOrNull(row.serial_number),
      engine_hours: finiteNumberOrNull(row.engine_hours),
      condition: stringOrNull(row.condition),
      name: stringOrNull(row.name),
    }];
  });
}

export function normalizeCustomerActivityRows(rows: unknown): CustomerActivity[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const activityType = stringOrNull(row.activity_type);
    const occurredAt = validDateStringOrNull(row.occurred_at);
    if (!id || !activityType || !occurredAt) return [];

    return [{
      id,
      activity_type: activityType,
      body: stringOrNull(row.body),
      occurred_at: occurredAt,
      metadata: isRecord(row.metadata) ? row.metadata : null,
    }];
  });
}

export function normalizeDealStageOptions(rows: unknown): DealStageOption[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const name = stringOrNull(row.name);
    if (!id || !name) return [];
    return [{ id, name, sort_order: finiteNumberOrDefault(row.sort_order) }];
  });
}
