import { describe, expect, test } from "bun:test";
import {
  normalizeFeedbackSeenEventRows,
  normalizeFeedbackSeenRows,
  normalizeHubChangelogRows,
  normalizeHubDecisionRows,
  normalizeHubFeedbackEventRows,
  normalizeHubFeedbackLinkRows,
  normalizeHubFeedbackRows,
  normalizeStakeholderBriefing,
} from "./brief-normalizers";

describe("brief normalizers", () => {
  test("normalizes briefing and changelog rows", () => {
    expect(normalizeStakeholderBriefing({
      id: "brief-1",
      content: "Daily build brief",
      briefing_date: "2026-05-03",
      created_at: "2026-05-03T12:00:00.000Z",
      data: { model: "gpt" },
    })).toEqual({
      id: "brief-1",
      content: "Daily build brief",
      briefing_date: "2026-05-03",
      created_at: "2026-05-03T12:00:00.000Z",
      data: { model: "gpt" },
    });

    expect(normalizeHubChangelogRows([
      {
        id: "change-1",
        workspace_id: "workspace-1",
        build_item_id: null,
        feedback_id: "feedback-1",
        summary: "Preview shipped",
        details: null,
        change_type: "shipped",
        demo_url: "https://example.com",
        commit_sha: "abc123",
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad", workspace_id: "workspace-1", summary: "Bad", change_type: "unknown", created_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "change-1",
        workspace_id: "workspace-1",
        build_item_id: null,
        feedback_id: "feedback-1",
        summary: "Preview shipped",
        details: null,
        change_type: "shipped",
        demo_url: "https://example.com",
        commit_sha: "abc123",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes decisions and string arrays", () => {
    expect(normalizeHubDecisionRows([
      {
        id: "decision-1",
        workspace_id: "workspace-1",
        title: "Keep PR preview visible",
        context: "Stakeholder feedback",
        decision: "Show preview before PR",
        decided_by: ["Brian", 42],
        affects_modules: ["brief", null],
        notebooklm_source_id: null,
        related_build_item_ids: ["item-1", false],
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      },
    ])).toEqual([
      {
        id: "decision-1",
        workspace_id: "workspace-1",
        title: "Keep PR preview visible",
        context: "Stakeholder feedback",
        decision: "Show preview before PR",
        decided_by: ["Brian"],
        affects_modules: ["brief"],
        notebooklm_source_id: null,
        related_build_item_ids: ["item-1"],
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes feedback rows with preview fallback and enum guards", () => {
    expect(normalizeHubFeedbackRows([
      {
        id: "feedback-1",
        workspace_id: "workspace-1",
        build_item_id: "item-1",
        submitted_by: "user-1",
        feedback_type: "bug",
        body: "This broke",
        voice_transcript: null,
        voice_audio_url: null,
        screenshot_url: null,
        priority: "high",
        status: "open",
        ai_summary: "Bug report",
        ai_suggested_action: null,
        claude_branch_name: null,
        claude_pr_url: null,
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
        resolved_at: null,
        last_seen_events_at: null,
      },
      { id: "bad", workspace_id: "workspace-1", feedback_type: "urgent", body: "Bad", status: "open", created_at: "2026-05-03", updated_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "feedback-1",
        workspace_id: "workspace-1",
        build_item_id: "item-1",
        submitted_by: "user-1",
        feedback_type: "bug",
        body: "This broke",
        voice_transcript: null,
        voice_audio_url: null,
        screenshot_url: null,
        priority: "high",
        status: "open",
        ai_summary: "Bug report",
        ai_suggested_action: null,
        claude_branch_name: null,
        claude_pr_url: null,
        claude_preview_url: null,
        claude_preview_ready_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
        resolved_at: null,
        last_seen_events_at: null,
      },
    ]);
  });

  test("normalizes feedback links and events", () => {
    expect(normalizeHubFeedbackLinkRows([
      {
        primary_id: "feedback-1",
        duplicate_id: "feedback-2",
        workspace_id: "workspace-1",
        similarity: "0.91",
        link_reason: "semantic_dup",
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { primary_id: "bad", duplicate_id: "bad-2", workspace_id: "workspace-1", similarity: 1, link_reason: "bad", created_at: "2026-05-03" },
    ])).toEqual([
      {
        primary_id: "feedback-1",
        duplicate_id: "feedback-2",
        workspace_id: "workspace-1",
        similarity: 0.91,
        link_reason: "semantic_dup",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);

    expect(normalizeHubFeedbackEventRows([
      {
        id: "event-1",
        feedback_id: "feedback-1",
        workspace_id: "workspace-1",
        event_type: "triaged",
        from_status: "open",
        to_status: "triaged",
        actor_id: null,
        actor_role: "system",
        payload: { summary: "Triaged" },
        notified_submitter_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad", feedback_id: "feedback-1", workspace_id: "workspace-1", event_type: "unknown", actor_role: "system", created_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "event-1",
        feedback_id: "feedback-1",
        workspace_id: "workspace-1",
        event_type: "triaged",
        from_status: "open",
        to_status: "triaged",
        actor_id: null,
        actor_role: "system",
        payload: { summary: "Triaged" },
        notified_submitter_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes unseen feedback counters", () => {
    expect(normalizeFeedbackSeenRows([
      { id: "feedback-1", last_seen_events_at: null },
      { last_seen_events_at: "2026-05-03" },
    ])).toEqual([{ id: "feedback-1", last_seen_events_at: null }]);

    expect(normalizeFeedbackSeenEventRows([
      { id: "event-1", feedback_id: "feedback-1", created_at: "2026-05-03T12:00:00.000Z" },
      { id: "bad", created_at: "2026-05-03" },
    ])).toEqual([{ id: "event-1", feedback_id: "feedback-1", created_at: "2026-05-03T12:00:00.000Z" }]);
  });
});
