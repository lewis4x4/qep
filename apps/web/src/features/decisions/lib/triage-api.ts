import { supabase } from "@/lib/supabase";

export type TriageDecisionStatus = "open" | "escalated" | "shadow_ship";
export type OwnerDecisionAction = "approve" | "block" | "need_info";

export interface OwnerDecisionActionInput {
  action: OwnerDecisionAction;
  ownerRole: string;
  recommendedOption: string | null;
  existingPacket: Record<string, unknown> | null;
  actorName?: string | null;
  nowIso?: string;
}

export interface OwnerDecisionActionResult {
  action: OwnerDecisionAction;
  status: "answered" | "escalated" | "open";
  actionAt: string;
  actor: string;
}

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
  ownerPresenceSignal: string | null;
  ownerPresenceAt: string | null;
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

function resolveOwnerPresence(packet: Record<string, unknown>): { signal: string | null; at: string | null } {
  const ownerLastAction = asRecord(packet.owner_web_last_action);
  const ownerLastOpen = asRecord(packet.owner_web_last_open);
  const atCandidates = [
    asString(ownerLastOpen.at),
    asString(ownerLastAction.at),
    asString(packet.owner_opened_at),
    asString(packet.owner_last_seen_at),
  ].map((value) => value.trim()).filter(Boolean);
  const signalCandidates = [
    asString(ownerLastOpen.summary),
    asString(ownerLastOpen.action),
    asString(ownerLastAction.action),
    asString(packet.owner_last_presence),
  ].map((value) => value.trim()).filter(Boolean);

  return {
    signal: signalCandidates[0] ?? null,
    at: atCandidates[0] ?? null,
  };
}

export function buildOwnerDecisionOpenPatch(input: {
  existingPacket: Record<string, unknown> | null;
  ownerRole: string;
  actorName?: string | null;
  nowIso?: string;
}): Record<string, unknown> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const ownerRole = input.ownerRole.trim() || "owner";
  const actorName = input.actorName?.trim() || ownerRole;
  const actor = `owner-web:${actorName}`;
  const existingPacket = input.existingPacket ?? {};
  const existingEvents = Array.isArray(existingPacket.owner_web_open_events)
    ? existingPacket.owner_web_open_events
    : [];
  const openEvent = {
    action: "opened",
    owner_role: ownerRole,
    actor,
    at: nowIso,
    surface: "/decisions",
  };

  return {
    ...existingPacket,
    owner_web_last_open: openEvent,
    owner_web_open_events: [...existingEvents.slice(-9), openEvent],
  };
}

export function buildBrianDecisionNudgePatch(input: {
  existingPacket: Record<string, unknown> | null;
  nudgedBy?: string | null;
  note?: string | null;
  nowIso?: string;
}): Record<string, unknown> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const nudgedBy = input.nudgedBy?.trim() || "brian";
  const note = input.note?.trim() || null;
  const existingPacket = input.existingPacket ?? {};
  const existingNudges = Array.isArray(existingPacket.brian_dm_nudges)
    ? existingPacket.brian_dm_nudges
    : [];
  const nudgeEvent = {
    requested_at: nowIso,
    requested_by: nudgedBy,
    note,
    state: "queued",
    surface: "/decisions/triage",
  };

  return {
    ...existingPacket,
    brian_dm_last_nudge: nudgeEvent,
    brian_dm_nudges: [...existingNudges, nudgeEvent],
  };
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

    const aiPrepPacket = asRecord(record.ai_prep_packet);
    const ownerPresence = resolveOwnerPresence(aiPrepPacket);

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
      aiPrepPacket,
      ownerPresenceSignal: ownerPresence.signal,
      ownerPresenceAt: ownerPresence.at,
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

export function buildOwnerDecisionActionPatch(input: OwnerDecisionActionInput): Record<string, unknown> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const ownerRole = input.ownerRole.trim() || "owner";
  const actorName = input.actorName?.trim() || ownerRole;
  const actor = `owner-web:${actorName}`;
  const actionStamp = {
    action: input.action,
    owner_role: ownerRole,
    actor,
    at: nowIso,
    surface: "/decisions",
  };
  const packet = {
    ...(input.existingPacket ?? {}),
    owner_web_last_action: actionStamp,
  };

  if (input.action === "approve") {
    const answeredOption = input.recommendedOption?.trim() || null;
    if (!answeredOption) {
      throw new Error("Approve requires a recommended option to answer the decision");
    }

    return {
      status: "answered",
      answered_by: actor,
      answered_at: nowIso,
      answered_option: answeredOption,
      answered_rationale: `Approved on /decisions by ${actorName} at ${nowIso}.`,
      ai_prep_packet: packet,
    };
  }

  if (input.action === "block") {
    return {
      status: "escalated",
      ai_prep_packet: packet,
    };
  }

  return {
    status: "open",
    ai_prep_packet: packet,
  };
}

export async function applyOwnerDecisionAction(input: {
  decisionId: string;
  action: OwnerDecisionAction;
  actorName?: string | null;
}): Promise<OwnerDecisionActionResult> {
  const actionAt = new Date().toISOString();

  const { data: current, error: readError } = await supabase
    .from("qep_decisions")
    .select("id, owner_role, recommended_option, ai_prep_packet")
    .eq("id", input.decisionId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message || "Failed to load decision before action");
  }
  if (!current?.id) {
    throw new Error("Decision not found");
  }

  const ownerRole = asString(current.owner_role) || "owner";
  const actorName = input.actorName?.trim() || ownerRole;
  const patch = buildOwnerDecisionActionPatch({
    action: input.action,
    ownerRole,
    recommendedOption:
      typeof current.recommended_option === "string" ? current.recommended_option : null,
    existingPacket: asRecord(current.ai_prep_packet),
    actorName,
    nowIso: actionAt,
  });

  const { data: updated, error: updateError } = await supabase
    .from("qep_decisions")
    .update(patch)
    .eq("id", input.decisionId)
    .select("id, status")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Failed to save decision action");
  }
  if (!updated?.id) {
    throw new Error("Decision action was not persisted");
  }

  return {
    action: input.action,
    status: patch.status as OwnerDecisionActionResult["status"],
    actionAt,
    actor: `owner-web:${actorName}`,
  };
}

export async function recordOwnerDecisionOpen(input: {
  decisionId: string;
  ownerRole: string;
  actorName?: string | null;
}) {
  const { data: current, error: readError } = await supabase
    .from("qep_decisions")
    .select("id, ai_prep_packet")
    .eq("id", input.decisionId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message || "Failed to load decision before open stamp");
  }
  if (!current?.id) {
    throw new Error("Decision not found");
  }

  const updatedPacket = buildOwnerDecisionOpenPatch({
    existingPacket: asRecord(current.ai_prep_packet),
    ownerRole: input.ownerRole,
    actorName: input.actorName,
  });

  const { error: updateError } = await supabase
    .from("qep_decisions")
    .update({ ai_prep_packet: updatedPacket })
    .eq("id", input.decisionId);

  if (updateError) {
    throw new Error(updateError.message || "Failed to record owner open presence");
  }

  return {
    actor: asString(asRecord(updatedPacket.owner_web_last_open).actor),
    at: asString(asRecord(updatedPacket.owner_web_last_open).at),
  };
}

export async function queueBrianDecisionNudge(input: {
  decisionId: string;
  nudgedBy?: string;
  note?: string | null;
}) {
  const { data: current, error: readError } = await supabase
    .from("qep_decisions")
    .select("id, ai_prep_packet")
    .eq("id", input.decisionId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message || "Failed to load decision before nudge");
  }
  if (!current?.id) {
    throw new Error("Decision not found");
  }

  const updatedPacket = buildBrianDecisionNudgePatch({
    existingPacket: asRecord(current.ai_prep_packet),
    nudgedBy: input.nudgedBy,
    note: input.note,
  });

  const { error: updateError } = await supabase
    .from("qep_decisions")
    .update({ ai_prep_packet: updatedPacket })
    .eq("id", input.decisionId);

  if (updateError) {
    throw new Error(updateError.message || "Failed to record DM nudge request");
  }

  return {
    requestedBy: input.nudgedBy?.trim() || "brian",
    requestedAt: asString(asRecord(updatedPacket.brian_dm_last_nudge).requested_at),
  };
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
