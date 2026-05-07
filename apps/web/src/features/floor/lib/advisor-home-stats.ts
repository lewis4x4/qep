import { supabase } from "@/lib/supabase";

export interface AdvisorFollowUpStats {
  dueTodayCount: number;
  overdueCount: number;
  tiedUpValueCents: number;
  stalest: { customer: string; daysStale: number } | null;
}

export interface AdvisorPipelineStats {
  activeDealCount: number;
  totalValueCents: number;
  decisionCount: number;
}

interface NormalizedFollowUpRow {
  scheduledDate: string;
  amountCents: number;
  customer: string;
}

const DECISION_STAGE_PATTERN = /(decision|negotiat|proposal|quote)/i;

export function formatCompactUsd(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "$0";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}

export async function fetchAdvisorFollowUpStats(userId: string): Promise<AdvisorFollowUpStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const { data, error } = await supabase
    .from("follow_up_touchpoints")
    .select(
      `
      id, scheduled_date, status,
      cadence:follow_up_cadences!inner (
        deal_id, assigned_to,
        deal:qrm_deals (
          id, name, amount,
          company:qrm_companies ( name, dba )
        )
      )
    `,
    )
    .in("status", ["pending", "scheduled"])
    .eq("cadence.assigned_to", userId)
    .limit(80);

  if (error) throw new Error(error.message);

  const now = Date.now();
  let dueToday = 0;
  let overdue = 0;
  let tiedUp = 0;
  let stalest: AdvisorFollowUpStats["stalest"] = null;

  for (const row of normalizeFollowUpRows(data ?? [])) {
    const scheduledMs = new Date(row.scheduledDate).getTime();

    if (scheduledMs < todayStart.getTime()) {
      overdue += 1;
      const daysStale = Math.floor((now - scheduledMs) / 86_400_000);
      if (!stalest || daysStale > stalest.daysStale) stalest = { customer: row.customer, daysStale };
    } else if (scheduledMs < tomorrowStart.getTime()) {
      dueToday += 1;
    }
    tiedUp += row.amountCents;
  }

  return {
    dueTodayCount: dueToday,
    overdueCount: overdue,
    tiedUpValueCents: tiedUp,
    stalest,
  };
}

export async function fetchAdvisorPipelineStats(userId: string): Promise<AdvisorPipelineStats> {
  const [stagesRes, dealsRes] = await Promise.all([
    supabase.from("qrm_deal_stages").select("id, name"),
    supabase
      .from("qrm_deals")
      .select("id, amount, stage_id, closed_at")
      .eq("assigned_rep_id", userId)
      .is("deleted_at", null)
      .is("closed_at", null),
  ]);

  if (stagesRes.error) throw new Error(stagesRes.error.message);
  if (dealsRes.error) throw new Error(dealsRes.error.message);

  const decisionStageIds = new Set(
    (stagesRes.data ?? [])
      .filter((stage) => DECISION_STAGE_PATTERN.test(String(stage.name ?? "")))
      .map((stage) => stage.id)
      .filter((stageId): stageId is string => typeof stageId === "string"),
  );

  let totalCents = 0;
  let decisionCount = 0;
  for (const row of dealsRes.data ?? []) {
    totalCents += parseAmountCents(row.amount);
    if (typeof row.stage_id === "string" && decisionStageIds.has(row.stage_id)) {
      decisionCount += 1;
    }
  }

  return {
    activeDealCount: (dealsRes.data ?? []).length,
    totalValueCents: totalCents,
    decisionCount,
  };
}

function normalizeFollowUpRows(rows: unknown[]): NormalizedFollowUpRow[] {
  return rows.map(normalizeFollowUpRow).filter((row): row is NormalizedFollowUpRow => row !== null);
}

function normalizeFollowUpRow(row: unknown): NormalizedFollowUpRow | null {
  if (!isRecord(row)) return null;
  const scheduledDate = nullableString(row.scheduled_date);
  if (!scheduledDate || !Number.isFinite(new Date(scheduledDate).getTime())) return null;
  const cadence = firstRecord(row.cadence);
  const deal = firstRecord(cadence?.deal);
  const company = firstRecord(deal?.company);
  const customer = nullableString(company?.dba) ?? nullableString(company?.name) ?? nullableString(deal?.name) ?? "Customer";
  return {
    scheduledDate,
    amountCents: parseAmountCents(deal?.amount),
    customer,
  };
}

function parseAmountCents(value: unknown): number {
  if (value == null) return 0;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
