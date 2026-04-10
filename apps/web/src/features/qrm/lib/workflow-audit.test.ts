import { describe, expect, it } from "bun:test";
import { buildWorkflowAuditBoard } from "./workflow-audit";

describe("buildWorkflowAuditBoard", () => {
  it("splits workflow evidence into breaks, stalls, reroutes, and silent fails", () => {
    const board = buildWorkflowAuditBoard({
      runs: [
        {
          id: "run-break",
          workflowSlug: "quote-expiry",
          status: "dead_lettered",
          startedAt: "2026-04-10T10:00:00.000Z",
          finishedAt: "2026-04-10T10:05:00.000Z",
          errorText: "failed",
          deadLetterId: "ex-1",
        },
        {
          id: "run-stall",
          workflowSlug: "approval-path",
          status: "awaiting_approval",
          startedAt: "2026-04-10T09:00:00.000Z",
          finishedAt: null,
          errorText: null,
          deadLetterId: null,
        },
      ],
      steps: [
        { runId: "run-break", stepIndex: 1, status: "failed", actionKey: "send_email", errorText: "boom" },
      ],
      approvals: [
        { id: "approval-1", runId: "run-stall", status: "pending", requestedAt: "2026-04-10T09:05:00.000Z", dueAt: null },
      ],
      exceptions: [
        { id: "ex-1", source: "workflow_dead_letter", status: "open", title: "Workflow dead letter", createdAt: "2026-04-10T10:05:00.000Z" },
      ],
      actions: [
        { actionType: "workflow_replay", createdAt: "2026-04-10T11:00:00.000Z", metadata: { run_id: "run-break" } },
      ],
    });

    expect(board.summary.breaks).toBe(1);
    expect(board.summary.stalls).toBe(1);
    expect(board.summary.reroutes).toBe(1);
    expect(board.summary.silentFails).toBe(1);
    expect(board.breaks[0]?.id).toBe("run-break");
    expect(board.stalls[0]?.id).toBe("run-stall");
    expect(board.reroutes[0]?.actionType).toBe("workflow_replay");
    expect(board.silentFails[0]?.id).toBe("ex-1");
  });
});
