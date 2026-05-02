import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  buildPipelineHealthByRep,
  type DealStageRow,
  type PipelineDealRow,
  type PipelineHealthRow,
  type RepProfileRow,
} from "../lib/pipeline-health";
import type {
  DealEquipmentLinkRow,
  ExpiringIncentiveRow,
  ForecastDealRow,
  PredictionLedgerRow,
} from "../lib/ownership-intel";

/** Fleet / registry rows older than this many days surface as aging inventory (punch list: Iron Manager). */
const INVENTORY_AGING_DAYS = 90;

/** Open deals sampled for manager pipeline health (per-rep swim lanes). */
const PIPELINE_DEALS_SAMPLE = 250;

type PublicSchema = Database["public"];
type TableRow<TableName extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][TableName]["Row"];
type ViewRow<ViewName extends keyof PublicSchema["Views"]> = PublicSchema["Views"][ViewName]["Row"];
type FunctionRows<FunctionName extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][FunctionName]["Returns"] extends Array<infer Row> ? Row : never;

export type PendingDemoRow = Pick<TableRow<"demos">, "id" | "deal_id" | "status" | "equipment_category" | "created_at">;
export type PendingTradeRow = Pick<TableRow<"trade_valuations">, "id" | "deal_id" | "make" | "model" | "status" | "preliminary_value">;
export type ProspectingKpiRow = Pick<TableRow<"prospecting_kpis">, "rep_id" | "positive_visits" | "target" | "target_met" | "kpi_date">;

export interface MarginFlagRow {
  id: string;
  name: string | null;
  margin_pct: number | null;
  margin_check_status: string | null;
}

export interface AgingEquipmentRow {
  id: string;
  name: string;
  created_at: string;
  company_id: string;
  crm_companies?: { name: string | null } | { name: string | null }[] | null;
}

export type MarginAnalyticsRow = Pick<
  ViewRow<"margin_analytics_view">,
  "rep_id" | "rep_name" | "equipment_category" | "month_bucket" | "deal_count" | "total_pipeline" | "avg_margin_pct" | "flagged_deal_count"
>;
export type PipelineVelocityRow = FunctionRows<"pipeline_velocity_rpc">;

export interface IronManagerData {
  pendingDemos: PendingDemoRow[];
  pendingTrades: PendingTradeRow[];
  marginFlags: MarginFlagRow[];
  kpis: ProspectingKpiRow[];
  pipelineDeals: PipelineDealRow[];
  dealStages: DealStageRow[];
  pipelineHealthByRep: PipelineHealthRow[];
  repProfiles: RepProfileRow[];
  agingEquipment: AgingEquipmentRow[];
  approvalCount: number;
  marginAnalytics: MarginAnalyticsRow[];
  pipelineVelocity: PipelineVelocityRow[];
  forecastDeals: ForecastDealRow[];
  expiringIncentives: ExpiringIncentiveRow[];
  dealEquipmentLinks: DealEquipmentLinkRow[];
  resolvedPredictions: PredictionLedgerRow[];
}

export interface AdvisorDealRow {
  id: string;
  name: string | null;
  stage_id?: string | null;
  amount?: number | null;
  sla_deadline_at: string | null;
  next_follow_up_at?: string | null;
}

export interface AdvisorNewLeadRow {
  id: string;
  name: string | null;
  created_at: string;
}

export type AdvisorKpiRow = Pick<
  TableRow<"prospecting_kpis">,
  "positive_visits" | "target" | "target_met" | "consecutive_days_met"
>;

export type DueTouchpointRow = Pick<
  TableRow<"follow_up_touchpoints">,
  "id" | "touchpoint_type" | "scheduled_date" | "purpose" | "suggested_message" | "status"
> & {
  follow_up_cadences?:
    | { deal_id: string | null; assigned_to?: string | null }
    | Array<{ deal_id: string | null; assigned_to?: string | null }>
    | null;
};

export interface IronAdvisorData {
  myDeals: AdvisorDealRow[];
  dueTouchpoints: DueTouchpointRow[];
  newLeads: AdvisorNewLeadRow[];
  kpi: AdvisorKpiRow;
  todayStr: string;
}

export interface JoinedDealStage {
  sort_order: number | null;
  name: string | null;
}

export interface IronWomanDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  stage_id?: string | null;
  crm_deal_stages?: JoinedDealStage | JoinedDealStage[] | null;
}

export type PendingDepositRow = Pick<TableRow<"deposits">, "id" | "deal_id" | "required_amount" | "status" | "created_at">;
export type IntakeItemRow = Pick<TableRow<"equipment_intake">, "id" | "stock_number" | "current_stage" | "created_at">;

export interface IronWomanData {
  orderProcessing: IronWomanDealRow[];
  pendingDeposits: PendingDepositRow[];
  intakeItems: IntakeItemRow[];
  creditApps: IronWomanDealRow[];
}

export type PrepQueueRow = Pick<TableRow<"equipment_intake">, "id" | "stock_number" | "current_stage" | "created_at">;
export type PdiItemRow = Pick<TableRow<"equipment_intake">, "id" | "stock_number" | "pdi_checklist" | "pdi_completed">;
export type UpcomingDemoRow = Pick<TableRow<"demos">, "id" | "deal_id" | "scheduled_date" | "equipment_category" | "max_hours" | "status">;
export type ReturnInspectionRow = Pick<TableRow<"rental_returns">, "id" | "equipment_id" | "status" | "inspection_date">;

export interface IronManData {
  prepQueue: PrepQueueRow[];
  pdiItems: PdiItemRow[];
  upcomingDemos: UpcomingDemoRow[];
  returnInspections: ReturnInspectionRow[];
}

function rowsOrEmpty<Row>(rows: Row[] | null | undefined): Row[] {
  return rows ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMarginFlags(rows: unknown): MarginFlagRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): MarginFlagRow | null => {
      if (!isRecord(row) || typeof row.id !== "string") return null;
      return {
        id: row.id,
        name: nullableString(row.name),
        margin_pct: nullableNumber(row.margin_pct),
        margin_check_status: nullableString(row.margin_check_status),
      };
    })
    .filter((row): row is MarginFlagRow => row !== null);
}

function normalizeAgingEquipment(rows: unknown): AgingEquipmentRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): AgingEquipmentRow | null => {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.created_at !== "string") return null;
      return {
        id: row.id,
        name: nullableString(row.name) ?? "Unnamed equipment",
        created_at: row.created_at,
        company_id: nullableString(row.company_id) ?? "",
        crm_companies: normalizeJoinedCompany(row.crm_companies),
      };
    })
    .filter((row): row is AgingEquipmentRow => row !== null);
}

function normalizeJoinedCompany(value: unknown): AgingEquipmentRow["crm_companies"] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecord(item) ? { name: nullableString(item.name) } : null))
      .filter((item): item is { name: string | null } => item !== null);
  }
  return isRecord(value) ? { name: nullableString(value.name) } : null;
}

function normalizeAdvisorDeals(rows: unknown): AdvisorDealRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): AdvisorDealRow | null => {
      if (!isRecord(row) || typeof row.id !== "string") return null;
      return {
        id: row.id,
        name: nullableString(row.name),
        stage_id: nullableString(row.stage_id),
        amount: nullableNumber(row.amount),
        sla_deadline_at: nullableString(row.sla_deadline_at),
        next_follow_up_at: nullableString(row.next_follow_up_at),
      };
    })
    .filter((row): row is AdvisorDealRow => row !== null);
}

function normalizeAdvisorNewLeads(rows: unknown): AdvisorNewLeadRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): AdvisorNewLeadRow | null => {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.created_at !== "string") return null;
      return {
        id: row.id,
        name: nullableString(row.name),
        created_at: row.created_at,
      };
    })
    .filter((row): row is AdvisorNewLeadRow => row !== null);
}

function normalizeIronWomanDeals(rows: unknown): IronWomanDealRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): IronWomanDealRow | null => {
      if (!isRecord(row) || typeof row.id !== "string") return null;
      return {
        id: row.id,
        name: nullableString(row.name),
        amount: nullableNumber(row.amount),
        stage_id: nullableString(row.stage_id),
        crm_deal_stages: normalizeJoinedDealStage(row.crm_deal_stages),
      };
    })
    .filter((row): row is IronWomanDealRow => row !== null);
}

function normalizeJoinedDealStage(value: unknown): IronWomanDealRow["crm_deal_stages"] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        isRecord(item)
          ? { name: nullableString(item.name), sort_order: nullableNumber(item.sort_order) }
          : null,
      )
      .filter((item): item is JoinedDealStage => item !== null);
  }
  return isRecord(value)
    ? { name: nullableString(value.name), sort_order: nullableNumber(value.sort_order) }
    : null;
}

function defaultAdvisorKpi(): AdvisorKpiRow {
  return { positive_visits: 0, target: 10, target_met: false, consecutive_days_met: 0 };
}

export function useIronManagerData() {
  return useQuery<IronManagerData>({
    queryKey: ["dashboard", "iron-manager"],
    queryFn: async (): Promise<IronManagerData> => {
      const sb = supabase;
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      const agingCutoff = new Date();
      agingCutoff.setDate(agingCutoff.getDate() - INVENTORY_AGING_DAYS);

      const [
        { data: pendingDemos },
        { data: pendingTrades },
        { data: marginFlags },
        { data: kpis },
        { data: pipelineDeals },
        { data: dealStages },
        { data: agingEquipment },
        { data: marginAnalytics },
        { data: pipelineVelocity },
        { data: forecastDeals },
        { data: expiringIncentives },
        { data: dealEquipmentLinks },
        { data: resolvedPredictions },
      ] = await Promise.all([
        sb.from("demos").select("id, deal_id, status, equipment_category, created_at").eq("status", "requested"),
        sb.from("trade_valuations").select("id, deal_id, make, model, status, preliminary_value").eq("status", "manager_review"),
        sb.from("crm_deals").select("id, name, margin_pct, margin_check_status").eq("margin_check_status", "flagged"),
        sb.from("prospecting_kpis").select("rep_id, positive_visits, target, target_met, kpi_date").eq("kpi_date", new Date().toISOString().split("T")[0]),
        sb
          .from("crm_deals")
          .select("id, name, stage_id, amount, assigned_rep_id, last_activity_at")
          .is("deleted_at", null)
          .order("last_activity_at", { ascending: false })
          .limit(PIPELINE_DEALS_SAMPLE),
        sb.from("crm_deal_stages").select("id, sort_order, name").order("sort_order", { ascending: true }),
        sb
          .from("crm_equipment")
          .select("id, name, created_at, company_id, crm_companies(name)")
          .is("deleted_at", null)
          .lte("created_at", agingCutoff.toISOString())
          .order("created_at", { ascending: true })
          .limit(40),
        sb
          .from("margin_analytics_view")
          .select("rep_id, rep_name, equipment_category, month_bucket, deal_count, total_pipeline, avg_margin_pct, flagged_deal_count")
          .order("month_bucket", { ascending: false })
          .order("total_pipeline", { ascending: false })
          .limit(24),
        sb.rpc("pipeline_velocity_rpc", { p_threshold_days: 14 }),
        sb
          .from("crm_deals_weighted")
          .select("id, name, amount, weighted_amount, expected_close_on, stage_name")
          .order("expected_close_on", { ascending: true, nullsFirst: false })
          .limit(250),
        sb
          .from("manufacturer_incentives")
          .select("id, manufacturer, program_name, expiration_date, discount_type, discount_value")
          .gte("expiration_date", todayStr)
          .lte("expiration_date", tomorrowStr)
          .order("expiration_date", { ascending: true })
          .limit(20),
        sb
          .from("crm_deal_equipment")
          .select("deal_id, role, crm_equipment!inner(make, category)")
          .limit(400),
        sb
          .from("qrm_predictions")
          .select("id, predicted_at, outcome")
          .eq("subject_type", "deal")
          .not("outcome", "is", null)
          .order("predicted_at", { ascending: false })
          .limit(200),
      ]);

      const deals: PipelineDealRow[] = rowsOrEmpty(pipelineDeals);
      const stages: DealStageRow[] = rowsOrEmpty(dealStages);
      const repIds = [...new Set(deals.map((d) => d.assigned_rep_id).filter((id): id is string => Boolean(id)))];

      let repProfiles: RepProfileRow[] = [];
      if (repIds.length > 0) {
        const { data: profiles } = await sb.from("profiles").select("id, full_name, email").in("id", repIds);
        repProfiles = rowsOrEmpty(profiles);
      }

      const normalizedMarginFlags = normalizeMarginFlags(marginFlags);
      const normalizedAgingEquipment = normalizeAgingEquipment(agingEquipment);
      const pipelineHealthByRep = buildPipelineHealthByRep(deals, stages, repProfiles);

      return {
        pendingDemos: rowsOrEmpty(pendingDemos),
        pendingTrades: rowsOrEmpty(pendingTrades),
        marginFlags: normalizedMarginFlags,
        kpis: rowsOrEmpty(kpis),
        pipelineDeals: deals,
        dealStages: stages,
        pipelineHealthByRep,
        repProfiles,
        agingEquipment: normalizedAgingEquipment,
        approvalCount: (pendingDemos?.length ?? 0) + (pendingTrades?.length ?? 0) + normalizedMarginFlags.length,
        marginAnalytics: rowsOrEmpty(marginAnalytics),
        pipelineVelocity: rowsOrEmpty(pipelineVelocity),
        forecastDeals: rowsOrEmpty(forecastDeals),
        expiringIncentives: rowsOrEmpty(expiringIncentives),
        dealEquipmentLinks: rowsOrEmpty(dealEquipmentLinks),
        resolvedPredictions: rowsOrEmpty(resolvedPredictions),
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useIronAdvisorData(userId: string) {
  return useQuery<IronAdvisorData>({
    queryKey: ["dashboard", "iron-advisor", userId],
    queryFn: async (): Promise<IronAdvisorData> => {
      const sb = supabase;
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const end = new Date(today);
      end.setDate(end.getDate() + 3);
      const followUpWindowEndStr = end.toISOString().split("T")[0];
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [
        { data: myDeals },
        { data: dueTouchpoints },
        { data: kpi },
        { data: newLeads },
      ] = await Promise.all([
        sb
          .from("crm_deals")
          .select("id, name, stage_id, amount, sla_deadline_at, next_follow_up_at")
          .eq("assigned_rep_id", userId)
          .is("deleted_at", null)
          .order("sla_deadline_at", { ascending: true, nullsFirst: false })
          .limit(20),
        sb
          .from("follow_up_touchpoints")
          .select(
            "id, touchpoint_type, scheduled_date, purpose, suggested_message, status, follow_up_cadences!inner(deal_id, assigned_to)",
          )
          .eq("status", "pending")
          .lte("scheduled_date", followUpWindowEndStr)
          .eq("follow_up_cadences.assigned_to", userId)
          .order("scheduled_date", { ascending: true })
          .limit(25),
        sb.from("prospecting_kpis").select("*").eq("rep_id", userId).eq("kpi_date", todayStr).maybeSingle(),
        sb
          .from("crm_deals")
          .select("id, name, created_at, crm_deal_stages!inner(sort_order)")
          .eq("assigned_rep_id", userId)
          .is("deleted_at", null)
          .lte("crm_deal_stages.sort_order", 3)
          .gte("created_at", weekAgo.toISOString())
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      return {
        myDeals: normalizeAdvisorDeals(myDeals),
        dueTouchpoints: rowsOrEmpty(dueTouchpoints),
        newLeads: normalizeAdvisorNewLeads(newLeads),
        kpi: kpi ?? defaultAdvisorKpi(),
        todayStr,
      };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useIronWomanData() {
  return useQuery<IronWomanData>({
    queryKey: ["dashboard", "iron-woman"],
    queryFn: async (): Promise<IronWomanData> => {
      const sb = supabase;

      const [
        { data: orderProcessing },
        { data: pendingDeposits },
        { data: intakeItems },
        { data: creditApps },
      ] = await Promise.all([
        sb.from("crm_deals").select("id, name, amount, stage_id, crm_deal_stages!inner(sort_order, name)").gte("crm_deal_stages.sort_order", 13).lte("crm_deal_stages.sort_order", 16).is("deleted_at", null),
        sb.from("deposits").select("id, deal_id, required_amount, status, created_at").in("status", ["pending", "requested", "received"]),
        sb.from("equipment_intake").select("id, stock_number, current_stage, created_at").lt("current_stage", 8).order("current_stage"),
        sb
          .from("crm_deals")
          .select("id, name, amount, crm_deal_stages!inner(sort_order, name)")
          .eq("crm_deal_stages.sort_order", 14)
          .is("deleted_at", null),
      ]);

      return {
        orderProcessing: normalizeIronWomanDeals(orderProcessing),
        pendingDeposits: rowsOrEmpty(pendingDeposits),
        intakeItems: rowsOrEmpty(intakeItems),
        creditApps: normalizeIronWomanDeals(creditApps),
      };
    },
    staleTime: 30_000,
  });
}

export function useIronManData() {
  return useQuery<IronManData>({
    queryKey: ["dashboard", "iron-man"],
    queryFn: async (): Promise<IronManData> => {
      const sb = supabase;

      const [
        { data: prepQueue },
        { data: pdiItems },
        { data: upcomingDemos },
        { data: returnInspections },
      ] = await Promise.all([
        sb.from("equipment_intake").select("id, stock_number, current_stage, created_at").gte("current_stage", 2).lte("current_stage", 4).order("created_at"),
        sb.from("equipment_intake").select("id, stock_number, pdi_checklist, pdi_completed").eq("current_stage", 3).eq("pdi_completed", false),
        sb.from("demos").select("id, deal_id, scheduled_date, equipment_category, max_hours, status").in("status", ["approved", "scheduled"]).order("scheduled_date"),
        sb.from("rental_returns").select("id, equipment_id, status, inspection_date").eq("status", "inspection_pending"),
      ]);

      return {
        prepQueue: rowsOrEmpty(prepQueue),
        pdiItems: rowsOrEmpty(pdiItems),
        upcomingDemos: rowsOrEmpty(upcomingDemos),
        returnInspections: rowsOrEmpty(returnInspections),
      };
    },
    staleTime: 30_000,
  });
}
