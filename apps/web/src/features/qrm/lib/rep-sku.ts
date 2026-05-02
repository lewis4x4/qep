import { buildPipelineHealthByRep, type DealStageRow, type PipelineDealRow, type RepProfileRow } from "@/features/dashboards/lib/pipeline-health";
import { aggregateTimeBankByRep, type TimeBankRow } from "./time-bank";

export type RepSkuConfidence = "high" | "medium" | "low";

export interface RepSkuKpiRow {
  repId: string;
  positiveVisits: number | null;
  targetMet: boolean | null;
  opportunitiesCreated: number | null;
  quotesGenerated: number | null;
}

export interface RepSkuBoardRow {
  repId: string;
  repName: string;
  packageLabel: string;
  confidence: RepSkuConfidence;
  bestFor: string;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface RepSkuBoard {
  summary: {
    reps: number;
    loadedReps: number;
    overloadedReps: number;
    fieldSignalReps: number;
  };
  reps: RepSkuBoardRow[];
}

interface RepSkuInternalRow extends RepSkuBoardRow {
  hasDeals: boolean;
  hasOverload: boolean;
  hasFieldSignal: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeRepSkuDealRows(rows: unknown): PipelineDealRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      stage_id: requiredString(row.stage_id, "__missing_stage__"),
      amount: nullableNumber(row.amount),
      assigned_rep_id: nullableString(row.assigned_rep_id),
      last_activity_at: nullableString(row.last_activity_at),
    }];
  });
}

export function normalizeRepSkuStageRows(rows: unknown): DealStageRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      sort_order: requiredNumber(row.sort_order, 0),
      name: requiredString(row.name, "Unnamed stage"),
    }];
  });
}

export function normalizeRepSkuProfileRows(rows: unknown): RepProfileRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      full_name: nullableString(row.full_name),
      email: nullableString(row.email),
    }];
  });
}

export function normalizeRepSkuTimeBankRows(rows: unknown): TimeBankRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.deal_id !== "string") return [];

    return [{
      deal_id: row.deal_id,
      deal_name: requiredString(row.deal_name, "Unnamed deal"),
      company_id: nullableString(row.company_id),
      company_name: nullableString(row.company_name),
      assigned_rep_id: nullableString(row.assigned_rep_id),
      assigned_rep_name: nullableString(row.assigned_rep_name),
      stage_id: requiredString(row.stage_id, "__missing_stage__"),
      stage_name: requiredString(row.stage_name, "Unnamed stage"),
      days_in_stage: requiredNumber(row.days_in_stage, 0),
      stage_age_days: requiredNumber(row.stage_age_days, 0),
      budget_days: requiredNumber(row.budget_days, 0),
      has_explicit_budget: requiredBoolean(row.has_explicit_budget, false),
      remaining_days: requiredNumber(row.remaining_days, 0),
      pct_used: requiredNumber(row.pct_used, 0),
      is_over: requiredBoolean(row.is_over, false),
    }];
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function packageLabelFor(input: {
  preSale: number;
  close: number;
  postSale: number;
  positiveVisits: number;
  quotesGenerated: number;
  voiceNotes: number;
  avgDaysIdle: number | null;
}): { label: string; bestFor: string; confidence: RepSkuConfidence } {
  if (input.positiveVisits >= 8 && input.preSale >= input.close) {
    return {
      label: "Prospecting Package",
      bestFor: "new accounts, territory build, and early-pipeline creation",
      confidence: "high",
    };
  }
  if (input.close >= input.preSale && input.close >= input.postSale && input.quotesGenerated >= 2) {
    return {
      label: "Closer Package",
      bestFor: "late-stage commercial motion, quote recovery, and commitment pushes",
      confidence: "high",
    };
  }
  if (input.postSale > input.close || input.voiceNotes >= 4) {
    return {
      label: "Relationship Package",
      bestFor: "installed-base growth, account continuity, and operator-led follow-through",
      confidence: input.voiceNotes >= 4 ? "high" : "medium",
    };
  }
  if ((input.avgDaysIdle ?? 0) <= 5 && input.quotesGenerated > 0) {
    return {
      label: "Rhythm Package",
      bestFor: "steady multi-touch accounts that need consistent coordination more than heroics",
      confidence: "medium",
    };
  }
  return {
    label: "Generalist Package",
    bestFor: "mixed-book accounts where coverage and adaptability matter more than a single specialty",
    confidence: "low",
  };
}

export function buildRepSkuBoard(input: {
  deals: PipelineDealRow[];
  stages: DealStageRow[];
  repProfiles: RepProfileRow[];
  timeBankRows: TimeBankRow[];
  kpis: RepSkuKpiRow[];
  voiceByRepId: Map<string, number>;
  activityByRepId: Map<string, number>;
}): RepSkuBoard {
  const pipeline = buildPipelineHealthByRep(input.deals, input.stages, input.repProfiles);
  const timeByRep = new Map(aggregateTimeBankByRep(input.timeBankRows).map((row) => [row.id, row]));
  const kpiByRep = new Map(input.kpis.map((row) => [row.repId, row]));

  const reps: RepSkuInternalRow[] = pipeline
    .filter((row) => row.repKey !== "__unassigned__")
    .map((row) => {
      const kpi = kpiByRep.get(row.repKey);
      const voiceNotes = input.voiceByRepId.get(row.repKey) ?? 0;
      const touches = input.activityByRepId.get(row.repKey) ?? 0;
      const time = timeByRep.get(row.repKey);
      const pack = packageLabelFor({
        preSale: row.preSale,
        close: row.close,
        postSale: row.postSale,
        positiveVisits: kpi?.positiveVisits ?? 0,
        quotesGenerated: kpi?.quotesGenerated ?? 0,
        voiceNotes,
        avgDaysIdle: row.avgDaysIdle,
      });

      const confidence: RepSkuConfidence =
        pack.confidence === "high" && (kpi?.targetMet || voiceNotes > 0 || touches > 0)
          ? "high"
          : pack.confidence === "medium" || row.dealCount >= 3
            ? "medium"
            : "low";

      return {
        repId: row.repKey,
        repName: row.displayName,
        packageLabel: pack.label,
        confidence,
        bestFor: pack.bestFor,
        trace: [
          `${row.dealCount} active deals · $${Math.round(row.totalValue).toLocaleString()} pipeline.`,
          `${row.preSale} pre-sale · ${row.close} close-stage · ${row.postSale} post-sale deals.`,
          row.avgDaysIdle != null ? `${row.avgDaysIdle} average idle days across current deals.` : "No last-activity rhythm is available yet.",
          `${touches} CRM touches in the last 14 days · ${voiceNotes} voice notes in the last 30 days.`,
          kpi
            ? `${kpi.positiveVisits ?? 0} positive visits · ${kpi.opportunitiesCreated ?? 0} opportunities · ${kpi.quotesGenerated ?? 0} quotes generated.`
            : "No recent prospecting KPI row is available.",
          time
            ? `${time.overCount} over-time deal${time.overCount === 1 ? "" : "s"} · ${Math.round(time.avgPctUsed * 100)}% average time used.`
            : "No time-bank pressure is currently recorded.",
        ],
        actionLabel: "Open deals",
        href: "/qrm/deals",
        hasDeals: row.dealCount > 0,
        hasOverload: (time?.overCount ?? 0) > 0,
        hasFieldSignal: voiceNotes > 0,
      } satisfies RepSkuInternalRow;
    })
    .sort((a, b) => {
      const weight: Record<RepSkuConfidence, number> = { high: 3, medium: 2, low: 1 };
      if (weight[b.confidence] !== weight[a.confidence]) return weight[b.confidence] - weight[a.confidence];
      return a.repName.localeCompare(b.repName);
    });

  const overloadedReps = reps.filter((row) => row.hasOverload).length;
  const fieldSignalReps = reps.filter((row) => row.hasFieldSignal).length;
  const loadedReps = reps.filter((row) => row.hasDeals).length;

  return {
    summary: {
      reps: reps.length,
      loadedReps,
      overloadedReps,
      fieldSignalReps,
    },
    reps: reps.map(({ hasDeals: _hasDeals, hasOverload: _hasOverload, hasFieldSignal: _hasFieldSignal, ...row }) => row),
  };
}
