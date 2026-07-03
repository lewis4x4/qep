import { describe, expect, it } from "bun:test";
import {
  buildLinearCommentInput,
  formatProgressComment,
  normalizeRunnerCompletion,
} from "./progress-comments.mjs";

const workOrder = {
  id: "wo-123",
  task_id: "F2.8",
  command: "build",
  requested_by: "Brian",
  source_issue_id: "lin-issue-123",
  source_issue_identifier: "QEP-226",
  source_comment_id: "lin-comment-456",
  source_comment_url: "https://linear.app/qep/issue/QEP-226#comment-456",
  attempt_count: 2,
  max_attempts: 3,
};

const task = {
  task_id: "F2.8",
  title: "Agent progress comments back to Linear",
};

describe("QEP agent progress comments", () => {
  it("targets the source Linear comment thread when a source comment id exists", () => {
    const input = buildLinearCommentInput(workOrder, "checkpoint body");

    expect(input).toEqual({
      issueId: "lin-issue-123",
      parentId: "lin-comment-456",
      body: "checkpoint body",
    });
  });

  it("formats claimed and terminal comments with handoff and result metadata", () => {
    const body = formatProgressComment({
      workOrder,
      task,
      runner: "claude_code",
      checkpoint: "blocked",
      details: {
        handoffPath: "/repo/test-results/agent-work-orders/wo-123.md",
        runnerResultPath: "/repo/test-results/agent-work-orders/wo-123.result.json",
        resultSummary: "Blocked on missing Linear owner decision.",
        blockingReason: "Need Brian to approve the runner handoff scope.",
        status: "blocked",
      },
      repoRoot: "/repo",
      env: {
        GITHUB_REPOSITORY: "quality/qep",
        GITHUB_RUN_ID: "789",
      },
    });

    expect(body).toContain("**QEP agent checkpoint: Blocked**");
    expect(body).toContain("Roadmap: F2.8 - Agent progress comments back to Linear");
    expect(body).toContain("Work order: wo-123");
    expect(body).toContain("Status: blocked");
    expect(body).toContain("Attempt: 2/3");
    expect(body).toContain("Linear issue: QEP-226");
    expect(body).toContain("Source thread: https://linear.app/qep/issue/QEP-226#comment-456");
    expect(body).toContain("Handoff artifact: test-results/agent-work-orders/wo-123.md");
    expect(body).toContain("Runner result: test-results/agent-work-orders/wo-123.result.json");
    expect(body).toContain("Artifact run: https://github.com/quality/qep/actions/runs/789");
    expect(body).toContain("Result summary:\nBlocked on missing Linear owner decision.");
    expect(body).toContain("Blocking reason:\nNeed Brian to approve the runner handoff scope.");
  });

  it("promotes runner result JSON into blocked completion state", () => {
    const completion = normalizeRunnerCompletion({
      workOrder,
      runner: "claude_code",
      runResult: { exitCode: 0, stdout: "", stderr: "" },
      runnerReport: {
        status: "blocked",
        result_summary: "Blocked waiting on a source document.",
        blocking_reason: "Vermeer price sheet is missing.",
        result: { missing: "vermeer_price_sheet" },
      },
    });

    expect(completion).toEqual({
      status: "blocked",
      checkpoint: "blocked",
      resultSummary: "Blocked waiting on a source document.",
      result: { missing: "vermeer_price_sheet" },
      blockingReason: "Vermeer price sheet is missing.",
      errorExcerpt: "Vermeer price sheet is missing.",
    });
  });
});
