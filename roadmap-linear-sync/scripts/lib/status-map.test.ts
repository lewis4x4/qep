import { describe, expect, it } from "bun:test";
import { deriveLabelNamesFromTask, resolveStateId } from "./status-map.mjs";

const workflowStates = [
  { id: "state-todo", name: "Todo", type: "unstarted" },
  { id: "state-decision", name: "Decision", type: "unstarted" },
  { id: "state-done", name: "Done", type: "completed" },
];

describe("resolveStateId", () => {
  it("lands the July 3 reconciliation statuses on the intended Linear states", () => {
    expect(resolveStateId("shipped", workflowStates)).toBe("state-done");
    expect(resolveStateId("not_started", workflowStates)).toBe("state-todo");
    expect(resolveStateId("pending_decision", workflowStates)).toBe("state-decision");
  });
});

describe("deriveLabelNamesFromTask", () => {
  it("does not carry decision labels onto the closed and unblocked July 3 mirrors", () => {
    expect(deriveLabelNamesFromTask({
      task_id: "D3.7",
      stream: "D",
      wave: "D3",
      owner: "Norman",
      ship_state: "shipped",
      blocking_decision: null,
    })).toEqual(["stream:D", "wave:D3", "owner:Norman"]);

    expect(deriveLabelNamesFromTask({
      task_id: "K1.1",
      stream: "K",
      wave: "K1",
      owner: "Engineer",
      ship_state: "not_started",
      blocking_decision: null,
    })).toEqual(["stream:K", "wave:K1", "owner:Engineer"]);
  });
});
