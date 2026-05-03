import type {
  FeedbackEventType,
  FeedbackPriority,
  FeedbackStatus,
  FeedbackType,
  HubChangelogRow,
  HubDecisionRow,
  HubFeedbackEventRow,
  HubFeedbackLinkRow,
  HubFeedbackRow,
  StakeholderBriefing,
} from "./brief-api";

export interface FeedbackSeenRow {
  id: string;
  last_seen_events_at: string | null;
}

export interface FeedbackSeenEventRow {
  id: string;
  feedback_id: string;
  created_at: string;
}

const FEEDBACK_TYPES = new Set<FeedbackType>(["bug", "suggestion", "question", "approval", "concern"]);
const FEEDBACK_STATUSES = new Set<FeedbackStatus>(["open", "triaged", "drafting", "awaiting_merge", "shipped", "wont_fix"]);
const FEEDBACK_PRIORITIES = new Set<FeedbackPriority>(["low", "medium", "high"]);
const FEEDBACK_EVENT_TYPES = new Set<FeedbackEventType>([
  "submitted",
  "triaged",
  "drafting_started",
  "pr_opened",
  "awaiting_merge",
  "merged",
  "shipped",
  "wont_fix",
  "reopened",
  "admin_note",
  "duplicate_linked",
  "preview_ready",
]);
const CHANGE_TYPES = new Set<HubChangelogRow["change_type"]>(["shipped", "updated", "fixed", "started"]);
const LINK_REASONS = new Set<HubFeedbackLinkRow["link_reason"]>(["semantic_dup", "manual_merge", "admin_link"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  const normalized = stringOrNull(value)?.trim();
  return normalized ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function feedbackTypeOrNull(value: unknown): FeedbackType | null {
  return typeof value === "string" && FEEDBACK_TYPES.has(value as FeedbackType) ? value as FeedbackType : null;
}

function feedbackStatusOrNull(value: unknown): FeedbackStatus | null {
  return typeof value === "string" && FEEDBACK_STATUSES.has(value as FeedbackStatus) ? value as FeedbackStatus : null;
}

function feedbackPriorityOrNull(value: unknown): FeedbackPriority | null {
  return typeof value === "string" && FEEDBACK_PRIORITIES.has(value as FeedbackPriority) ? value as FeedbackPriority : null;
}

function feedbackEventTypeOrNull(value: unknown): FeedbackEventType | null {
  return typeof value === "string" && FEEDBACK_EVENT_TYPES.has(value as FeedbackEventType) ? value as FeedbackEventType : null;
}

function changeTypeOrNull(value: unknown): HubChangelogRow["change_type"] | null {
  return typeof value === "string" && CHANGE_TYPES.has(value as HubChangelogRow["change_type"])
    ? value as HubChangelogRow["change_type"]
    : null;
}

function linkReasonOrNull(value: unknown): HubFeedbackLinkRow["link_reason"] | null {
  return typeof value === "string" && LINK_REASONS.has(value as HubFeedbackLinkRow["link_reason"])
    ? value as HubFeedbackLinkRow["link_reason"]
    : null;
}

export function normalizeStakeholderBriefing(value: unknown): StakeholderBriefing | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const content = requiredString(value.content);
  const briefingDate = requiredString(value.briefing_date);
  const createdAt = requiredString(value.created_at);
  if (!id || !content || !briefingDate || !createdAt) return null;
  return {
    id,
    content,
    briefing_date: briefingDate,
    created_at: createdAt,
    data: recordOrNull(value.data),
  };
}

export function normalizeHubChangelogRows(rows: unknown): HubChangelogRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const workspaceId = requiredString(value.workspace_id);
    const summary = requiredString(value.summary);
    const changeType = changeTypeOrNull(value.change_type);
    const createdAt = requiredString(value.created_at);
    if (!id || !workspaceId || !summary || !changeType || !createdAt) return [];
    return [{
      id,
      workspace_id: workspaceId,
      build_item_id: stringOrNull(value.build_item_id),
      feedback_id: stringOrNull(value.feedback_id),
      summary,
      details: stringOrNull(value.details),
      change_type: changeType,
      demo_url: stringOrNull(value.demo_url),
      commit_sha: stringOrNull(value.commit_sha),
      created_at: createdAt,
    }];
  });
}

export function normalizeHubDecisionRows(rows: unknown): HubDecisionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const workspaceId = requiredString(value.workspace_id);
    const title = requiredString(value.title);
    const context = requiredString(value.context);
    const decision = requiredString(value.decision);
    const createdAt = requiredString(value.created_at);
    const updatedAt = requiredString(value.updated_at);
    if (!id || !workspaceId || !title || !context || !decision || !createdAt || !updatedAt) return [];
    return [{
      id,
      workspace_id: workspaceId,
      title,
      context,
      decision,
      decided_by: stringArray(value.decided_by),
      affects_modules: stringArray(value.affects_modules),
      notebooklm_source_id: stringOrNull(value.notebooklm_source_id),
      related_build_item_ids: stringArray(value.related_build_item_ids),
      created_at: createdAt,
      updated_at: updatedAt,
    }];
  });
}

export function normalizeHubFeedbackRow(value: unknown): HubFeedbackRow | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const workspaceId = requiredString(value.workspace_id);
  const feedbackType = feedbackTypeOrNull(value.feedback_type);
  const body = requiredString(value.body);
  const priority = feedbackPriorityOrNull(value.priority) ?? "medium";
  const status = feedbackStatusOrNull(value.status);
  const createdAt = requiredString(value.created_at);
  const updatedAt = requiredString(value.updated_at);
  if (!id || !workspaceId || !feedbackType || !body || !status || !createdAt || !updatedAt) return null;
  return {
    id,
    workspace_id: workspaceId,
    build_item_id: stringOrNull(value.build_item_id),
    submitted_by: stringOrNull(value.submitted_by),
    feedback_type: feedbackType,
    body,
    voice_transcript: stringOrNull(value.voice_transcript),
    voice_audio_url: stringOrNull(value.voice_audio_url),
    screenshot_url: stringOrNull(value.screenshot_url),
    priority,
    status,
    ai_summary: stringOrNull(value.ai_summary),
    ai_suggested_action: stringOrNull(value.ai_suggested_action),
    claude_branch_name: stringOrNull(value.claude_branch_name),
    claude_pr_url: stringOrNull(value.claude_pr_url),
    claude_preview_url: stringOrNull(value.claude_preview_url),
    claude_preview_ready_at: stringOrNull(value.claude_preview_ready_at),
    created_at: createdAt,
    updated_at: updatedAt,
    resolved_at: stringOrNull(value.resolved_at),
    last_seen_events_at: stringOrNull(value.last_seen_events_at),
  };
}

export function normalizeHubFeedbackRows(rows: unknown): HubFeedbackRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    const row = normalizeHubFeedbackRow(value);
    return row ? [row] : [];
  });
}

export function normalizeHubFeedbackLinkRows(rows: unknown): HubFeedbackLinkRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const primaryId = requiredString(value.primary_id);
    const duplicateId = requiredString(value.duplicate_id);
    const workspaceId = requiredString(value.workspace_id);
    const linkReason = linkReasonOrNull(value.link_reason);
    const createdAt = requiredString(value.created_at);
    if (!primaryId || !duplicateId || !workspaceId || !linkReason || !createdAt) return [];
    return [{
      primary_id: primaryId,
      duplicate_id: duplicateId,
      workspace_id: workspaceId,
      similarity: numberOrZero(value.similarity),
      link_reason: linkReason,
      created_at: createdAt,
    }];
  });
}

export function normalizeHubFeedbackEventRows(rows: unknown): HubFeedbackEventRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const feedbackId = requiredString(value.feedback_id);
    const workspaceId = requiredString(value.workspace_id);
    const eventType = feedbackEventTypeOrNull(value.event_type);
    const actorRole = requiredString(value.actor_role);
    const createdAt = requiredString(value.created_at);
    const fromStatus = value.from_status == null ? null : feedbackStatusOrNull(value.from_status);
    const toStatus = value.to_status == null ? null : feedbackStatusOrNull(value.to_status);
    if (!id || !feedbackId || !workspaceId || !eventType || !actorRole || !createdAt) return [];
    if (value.from_status != null && !fromStatus) return [];
    if (value.to_status != null && !toStatus) return [];
    return [{
      id,
      feedback_id: feedbackId,
      workspace_id: workspaceId,
      event_type: eventType,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: stringOrNull(value.actor_id),
      actor_role: actorRole,
      payload: recordOrEmpty(value.payload),
      notified_submitter_at: stringOrNull(value.notified_submitter_at),
      created_at: createdAt,
    }];
  });
}

export function normalizeFeedbackSeenRows(rows: unknown): FeedbackSeenRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    if (!id) return [];
    return [{ id, last_seen_events_at: stringOrNull(value.last_seen_events_at) }];
  });
}

export function normalizeFeedbackSeenEventRows(rows: unknown): FeedbackSeenEventRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const feedbackId = requiredString(value.feedback_id);
    const createdAt = requiredString(value.created_at);
    if (!id || !feedbackId || !createdAt) return [];
    return [{ id, feedback_id: feedbackId, created_at: createdAt }];
  });
}
