import { describe, expect, test } from "bun:test";
import { buildIronNoDeadEndMessage } from "./no-dead-end";

describe("Iron no-dead-end messages", () => {
  test("turns auth failures into a concrete session recovery step", () => {
    const message = buildIronNoDeadEndMessage({
      surface: "knowledge",
      action: "answer the question",
      error: "Unauthorized: invalid JWT signature (HTTP 401)",
    });

    expect(message).toContain("verify your session");
    expect(message).toContain("Sign back in or refresh");
    expect(message).toContain("did not answer the question");
  });

  test("turns edge/network failures into retry plus direct-page guidance", () => {
    const message = buildIronNoDeadEndMessage({
      surface: "orchestrator",
      action: "route that request",
      error: "Failed to send a request to the Edge Function",
    });

    expect(message).toContain("connection problem");
    expect(message).toContain("Try once more");
    expect(message).toContain("matching QEP page directly");
  });

  test("never returns a bare error for unknown failures", () => {
    const message = buildIronNoDeadEndMessage({ error: "weird failure" });

    expect(message).toContain("I could not finish that request");
    expect(message).toContain("I did not make changes");
    expect(message).toContain("Detail: weird failure");
  });
});
