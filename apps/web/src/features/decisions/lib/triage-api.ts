import { supabase } from "@/lib/supabase";

export type TriageDecisionStatus = "open" | "escalated" | "shadow_ship";

export interface TriageCitation {
  source: string;
  ref: string;
  excerpt: string;
}

export interface TriageDecisionRow {
  id: string;
  code: string;
  questionPlain: string;
  lane: string;
  ownerRole: string;
  recommendedOption: string | null;
  recommendedRationale: string | null;
  options: unknown[];
  citations: TriageCitation[];
  reversalCost: string | null;
  status: TriageDecisionStatus;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  gatedTaskCount: number;
  gatedStreams: string[];
  aiPrepPacket: Record<string, unknown>;
}

interface QueryError {
  message?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeCitation(value: unknown): TriageCitation | null {
  const record = asRecord(value);
  const source = asString(record.source).trim();
  const ref = asString(record.ref).trim();
  const excerpt = asString(record.excerpt).trim();
  if (!source && !ref && !excerpt) return null;
  return { source, ref, excerpt };
}

export function normalizeTriageDecisionRows(rows: unknown): TriageDecisionRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    const record = asRecord(row);
    const id = asString(record.id);
    const code = asString(record.code);
    const questionPlain = asString(record.question_plain);
    const lane = asString(record.lane);
    const ownerRole = asString(record.owner_role);
    const status = asString(record.status);
    const createdAt = asString(record.created_at);
    const updatedAt = asString(record.updated_at);

    if (!id || !code || !questionPlain || !lane || !ownerRole || !createdAt || !updatedAt) {
      return [];
    }

    if (status !== "open" && status !== "escalated" && status !== "shadow_ship") {
      return [];
    }

    return [{
      id,
      code,
      questionPlain,
      lane,
      ownerRole,
      recommendedOption:
        typeof record.recommended_option === "string" ? record.recommended_option : null,
      recommendedRationale:
        typeof record.recommended_rationale === "string" ? record.recommended_rationale : null,
      options: Array.isArray(record.options) ? record.options : [],
      citations: Array.isArray(record.citations)
        ? record.citations.map(normalizeCitation).filter((row): row is TriageCitation => Boolean(row))
        : [],
      reversalCost: typeof record.reversal_cost === "string" ? record.reversal_cost : null,
      status,
      createdAt,
      updatedAt,
      ageDays: asNumber(record.age_days),
      gatedTaskCount: asNumber(record.gated_task_count),
      gatedStreams: asStringArray(record.gated_streams),
      aiPrepPacket: asRecord(record.ai_prep_packet),
    }];
  });
}

export async function listDecisionTriageQueue(limit = 100): Promise<TriageDecisionRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const { data, error } = await supabase
    .from("v_qep_decisions_owner_inbox")
    .select(
      "id, code, question_plain, lane, owner_role, recommended_option, recommended_rationale, options, citations, reversal_cost, status, created_at, updated_at, age_days, gated_task_count, gated_streams, ai_prep_packet",
    )
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error((error as QueryError).message || "Failed to load triage queue");
  }

  return normalizeTriageDecisionRows(data);
}

export async function approveDecisionTriage(input: { decisionId: string; approvedBy?: string }) {
  const approvedBy = input.approvedBy?.trim() || "brian";
  const approvedAt = new Date().toISOString();

  const { data: current, error: readError } = await supabase
    .from("qep_decisions")
    .select("id, ai_prep_packet")
    .eq("id", input.decisionId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message || "Failed to load decision before approval");
  }
  if (!current?.id) {
    throw new Error("Decision not found");
  }

  const currentPacket = asRecord(current.ai_prep_packet);
  const nextPacket: Record<string, unknown> = {
    ...currentPacket,
    brian_triage_approved_at: approvedAt,
    brian_triage_approved_by: approvedBy,
  };

  const { error: updateError } = await supabase
    .from("qep_decisions")
    .update({ ai_prep_packet: nextPacket })
    .eq("id", input.decisionId);

  if (updateError) {
    throw new Error(updateError.message || "Failed to save triage approval");
  }

  return { approvedAt, approvedBy };
}
