/**
 * Client API for the Stakeholder Build Hub.
 *
 * Wraps the Supabase edge functions + table reads used by the /brief
 * routes. Types mirror the schema in migrations 310-315; when
 * `bun run supabase:gen-types` regenerates database.types.ts these can be
 * narrowed to the generated Row types.
 */
import { supabase } from "@/lib/supabase";

export type FeedbackType = "bug" | "suggestion" | "question" | "approval" | "concern";
export type FeedbackStatus =
  | "open"
  | "triaged"
  | "drafting"
  | "awaiting_merge"
  | "shipped"
  | "wont_fix";
export type FeedbackPriority = "low" | "medium" | "high";

export interface HubFeedbackRow {
  id: string;
  workspace_id: string;
  build_item_id: string | null;
  submitted_by: string | null;
  feedback_type: FeedbackType;
  body: string;
  voice_transcript: string | null;
  voice_audio_url: string | null;
  screenshot_url: string | null;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  ai_summary: string | null;
  ai_suggested_action: string | null;
  claude_branch_name: string | null;
  claude_pr_url: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface IntakePayload {
  body: string;
  feedback_type?: FeedbackType;
  build_item_id?: string;
  voice_audio_url?: string;
  voice_transcript?: string;
  screenshot_url?: string;
}

export interface IntakeResult {
  feedback: HubFeedbackRow;
  triage_model: string;
  elapsed_ms: number;
}

export async function submitHubFeedback(payload: IntakePayload): Promise<IntakeResult> {
  const { data, error } = await supabase.functions.invoke<IntakeResult>("hub-feedback-intake", {
    body: payload,
  });
  if (error) {
    throw new Error(error.message || "feedback intake failed");
  }
  if (!data?.feedback) {
    throw new Error("feedback intake returned empty payload");
  }
  return data;
}

export interface ListFeedbackOpts {
  scope: "mine" | "all";
  userId?: string | null;
  limit?: number;
}

export interface DraftFixResult {
  feedback: HubFeedbackRow;
  proposal: {
    branch_slug: string;
    pr_title: string;
    pr_body_markdown: string;
    affected_paths: string[];
    risk_level: "low" | "medium" | "high";
  };
  branch: string | null;
  pr_url: string | null;
  github_configured: boolean;
  github_error: string | null;
}

export async function draftFeedbackFix(feedbackId: string): Promise<DraftFixResult> {
  const { data, error } = await supabase.functions.invoke<DraftFixResult>("hub-feedback-draft-fix", {
    body: { feedback_id: feedbackId },
  });
  if (error) throw new Error(error.message || "draft-fix failed");
  if (!data?.feedback) throw new Error("draft-fix returned empty payload");
  return data;
}

export interface MergeResult {
  feedback: HubFeedbackRow;
  pr_number: number;
  merge_sha: string;
  merge_method: "merge" | "squash" | "rebase";
}

export async function mergeFeedbackPr(feedbackId: string): Promise<MergeResult> {
  const { data, error } = await supabase.functions.invoke<MergeResult>("hub-merge-pr", {
    body: { feedback_id: feedbackId },
  });
  if (error) throw new Error(error.message || "merge failed");
  if (!data?.feedback) throw new Error("merge returned empty payload");
  return data;
}

export interface HubBuildItemRow {
  id: string;
  workspace_id: string;
  module: string;
  title: string;
  description: string | null;
  status: "planned" | "in_progress" | "needs_feedback" | "in_review" | "shipped";
  sprint_number: number | null;
  demo_url: string | null;
  shipped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HubChangelogRow {
  id: string;
  workspace_id: string;
  build_item_id: string | null;
  feedback_id: string | null;
  summary: string;
  details: string | null;
  change_type: "shipped" | "updated" | "fixed" | "started";
  demo_url: string | null;
  commit_sha: string | null;
  created_at: string;
}

export interface StakeholderBriefing {
  id: string;
  content: string;
  briefing_date: string;
  created_at: string;
  data: Record<string, unknown> | null;
}

export interface DashboardTiles {
  shipped_this_week: number;
  in_progress: number;
  needs_your_input: number;
  open_feedback: number;
}

export interface DashboardBundle {
  tiles: DashboardTiles;
  briefing: StakeholderBriefing | null;
  feed: HubChangelogRow[];
}

export async function loadDashboardBundle(userId: string): Promise<DashboardBundle> {
  const today = new Date().toISOString().split("T")[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();

  const [shippedRes, inProgressRes, needsInputRes, openFbRes, briefingRes, feedRes] =
    await Promise.all([
      supabase
        .from("hub_build_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "shipped")
        .gte("shipped_at", oneWeekAgo)
        .is("deleted_at", null),
      supabase
        .from("hub_build_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "in_progress")
        .is("deleted_at", null),
      supabase
        .from("hub_build_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "needs_feedback")
        .is("deleted_at", null),
      supabase
        .from("hub_feedback")
        .select("id", { count: "exact", head: true })
        .eq("submitted_by", userId)
        .in("status", ["open", "triaged", "drafting", "awaiting_merge"])
        .is("deleted_at", null),
      supabase
        .from("morning_briefings")
        .select("id, content, briefing_date, created_at, data")
        .eq("user_id", userId)
        .eq("briefing_date", today)
        .maybeSingle(),
      supabase
        .from("hub_changelog")
        .select(
          "id, workspace_id, build_item_id, feedback_id, summary, details, change_type, demo_url, commit_sha, created_at",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  if (shippedRes.error) throw new Error(shippedRes.error.message);
  if (inProgressRes.error) throw new Error(inProgressRes.error.message);
  if (needsInputRes.error) throw new Error(needsInputRes.error.message);
  if (openFbRes.error) throw new Error(openFbRes.error.message);
  if (feedRes.error) throw new Error(feedRes.error.message);

  return {
    tiles: {
      shipped_this_week: shippedRes.count ?? 0,
      in_progress: inProgressRes.count ?? 0,
      needs_your_input: needsInputRes.count ?? 0,
      open_feedback: openFbRes.count ?? 0,
    },
    briefing: (briefingRes.data ?? null) as StakeholderBriefing | null,
    feed: (feedRes.data ?? []) as HubChangelogRow[],
  };
}

export interface HubDecisionRow {
  id: string;
  workspace_id: string;
  title: string;
  context: string;
  decision: string;
  decided_by: string[];
  affects_modules: string[];
  notebooklm_source_id: string | null;
  related_build_item_ids: string[];
  created_at: string;
  updated_at: string;
}

export async function listHubDecisions(limit = 50): Promise<HubDecisionRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const { data, error } = await supabase
    .from("hub_decisions")
    .select(
      "id, workspace_id, title, context, decision, decided_by, affects_modules, notebooklm_source_id, related_build_item_ids, created_at, updated_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(error.message);
  return (data ?? []) as HubDecisionRow[];
}

export interface AskBrainCitation {
  index: number;
  source_id: string;
  chunk_index: number;
  source_title: string;
  source_type: string;
  notebooklm_source_id: string | null;
  related_build_item_id: string | null;
  related_decision_id: string | null;
  similarity: number;
  body: string;
}

export interface AskBrainResponse {
  answer: string;
  citations: AskBrainCitation[];
  model: string;
  elapsed_ms: number;
  no_matches: boolean;
}

export async function askProjectBrain(query: string): Promise<AskBrainResponse> {
  const { data, error } = await supabase.functions.invoke<AskBrainResponse>("hub-ask-brain", {
    body: { query },
  });
  if (error) throw new Error(error.message || "ask-brain failed");
  if (!data) throw new Error("ask-brain returned empty payload");
  return data;
}

export async function refreshStakeholderBrief(): Promise<StakeholderBriefing | null> {
  const { data, error } = await supabase.functions.invoke<{
    brief: StakeholderBriefing | null;
  }>("stakeholder-morning-brief", {
    body: { regenerate: true },
  });
  if (error) throw new Error(error.message || "brief refresh failed");
  return data?.brief ?? null;
}

export async function listHubFeedback(opts: ListFeedbackOpts): Promise<HubFeedbackRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let q = supabase
    .from("hub_feedback")
    .select(
      "id, workspace_id, build_item_id, submitted_by, feedback_type, body, voice_transcript, voice_audio_url, screenshot_url, priority, status, ai_summary, ai_suggested_action, claude_branch_name, claude_pr_url, created_at, updated_at, resolved_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.scope === "mine" && opts.userId) {
    q = q.eq("submitted_by", opts.userId);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as HubFeedbackRow[];
}
