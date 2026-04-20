import { describe, expect, it } from "bun:test";
import {
  buildHistoryPayload,
  extractProposedMoves,
  humanizeToolName,
  oneLinePreview,
  SUGGESTED_STARTERS,
  summarizeToolTrace,
} from "../src/features/qrm/components/askIronHelpers";
import type {
  AskIronMessage,
  AskIronToolTraceEntry,
} from "../src/features/qrm/lib/ask-iron-types";

describe("buildHistoryPayload", () => {
  it("returns empty array for empty messages", () => {
    expect(buildHistoryPayload([])).toEqual([]);
  });

  it("drops tool traces and keeps role + content", () => {
    const messages: AskIronMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "hello",
        toolTrace: [{ tool: "list_my_moves", input: {}, result: {}, ok: true }],
      },
    ];
    expect(buildHistoryPayload(messages)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("caps the tail at the `max` parameter", () => {
    const messages: AskIronMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const out = buildHistoryPayload(messages, 4);
    expect(out).toHaveLength(4);
    expect(out[0].content).toBe("m16");
    expect(out[3].content).toBe("m19");
  });

  it("filters out messages with empty content", () => {
    const messages: AskIronMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "" },
      { role: "user", content: "there" },
    ];
    expect(buildHistoryPayload(messages)).toEqual([
      { role: "user", content: "hi" },
      { role: "user", content: "there" },
    ]);
  });
});

describe("oneLinePreview", () => {
  it("collapses multiple whitespace runs into a single space", () => {
    expect(oneLinePreview("hello\n\nworld    here")).toBe("hello world here");
  });

  it("truncates past maxChars with a trailing ellipsis", () => {
    const long = "a".repeat(200);
    const out = oneLinePreview(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns the original string if under maxChars", () => {
    expect(oneLinePreview("short", 100)).toBe("short");
  });
});

describe("humanizeToolName", () => {
  it("maps list_my_moves to Checked moves", () => {
    expect(humanizeToolName("list_my_moves")).toBe("Checked moves");
  });
  it("maps list_recent_signals to Checked signals", () => {
    expect(humanizeToolName("list_recent_signals")).toBe("Checked signals");
  });
  it("maps search_entities to Searched graph", () => {
    expect(humanizeToolName("search_entities")).toBe("Searched graph");
  });
  it("maps propose_move to Queued a move", () => {
    expect(humanizeToolName("propose_move")).toBe("Queued a move");
  });
  it("falls back to 'Called <tool>' for unknown tools", () => {
    expect(humanizeToolName("some_future_tool")).toBe("Called some_future_tool");
  });
});

describe("SUGGESTED_STARTERS", () => {
  it("exposes at least three starter questions", () => {
    expect(SUGGESTED_STARTERS.length).toBeGreaterThanOrEqual(3);
  });
  it("starters are short enough to fit a mobile card", () => {
    for (const s of SUGGESTED_STARTERS) {
      expect(s.length).toBeLessThanOrEqual(80);
    }
  });
});

describe("summarizeToolTrace", () => {
  it("returns zeroes for an undefined trace", () => {
    expect(summarizeToolTrace(undefined)).toEqual({
      moves: 0,
      signals: 0,
      entities: 0,
      proposed: 0,
    });
  });

  it("sums moves from list_my_moves results", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "list_my_moves",
        input: {},
        result: { moves: [{}, {}, {}] },
        ok: true,
      },
    ];
    expect(summarizeToolTrace(trace).moves).toBe(3);
  });

  it("sums signals from list_recent_signals results", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "list_recent_signals",
        input: {},
        result: { signals: [{}, {}] },
        ok: true,
      },
    ];
    expect(summarizeToolTrace(trace).signals).toBe(2);
  });

  it("sums entities from search_entities and get_*_detail (found)", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "search_entities",
        input: {},
        result: { matches: [{}, {}] },
        ok: true,
      },
      {
        tool: "get_deal_detail",
        input: {},
        result: { found: true },
        ok: true,
      },
      {
        tool: "get_company_detail",
        input: {},
        result: { found: false },
        ok: true,
      },
    ];
    expect(summarizeToolTrace(trace).entities).toBe(3);
  });

  it("counts successful propose_move entries", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "propose_move",
        input: { kind: "call_now", title: "x" },
        result: { move: { id: "m-1", kind: "call_now", title: "x", priority: 55 } },
        ok: true,
      },
      {
        tool: "propose_move",
        input: { kind: "send_quote", title: "y" },
        result: { error: "budget exhausted" },
        ok: false,
      },
    ];
    const summary = summarizeToolTrace(trace);
    // Only the successful propose counts.
    expect(summary.proposed).toBe(1);
  });

  it("skips failed tool calls entirely", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "list_my_moves",
        input: {},
        result: { error: "boom" },
        ok: false,
      },
    ];
    expect(summarizeToolTrace(trace)).toEqual({
      moves: 0,
      signals: 0,
      entities: 0,
      proposed: 0,
    });
  });
});

describe("extractProposedMoves", () => {
  it("returns [] for undefined trace", () => {
    expect(extractProposedMoves(undefined)).toEqual([]);
  });

  it("returns [] when there are no propose_move entries", () => {
    const trace: AskIronToolTraceEntry[] = [
      { tool: "list_my_moves", input: {}, result: { moves: [] }, ok: true },
    ];
    expect(extractProposedMoves(trace)).toEqual([]);
  });

  it("pulls fields from a successful propose_move tool result", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "propose_move",
        input: { kind: "call_now", title: "Call Acme" },
        result: {
          move: {
            id: "m-1",
            kind: "call_now",
            title: "Call Acme about CAT 305",
            status: "suggested",
            priority: 55,
            entity: { type: "deal", id: "d-1" },
            due_at: "2026-04-21T15:00:00Z",
          },
        },
        ok: true,
      },
    ];
    const out = extractProposedMoves(trace);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("m-1");
    expect(out[0].title).toBe("Call Acme about CAT 305");
    expect(out[0].priority).toBe(55);
    expect(out[0].entity).toEqual({ type: "deal", id: "d-1" });
    expect(out[0].dueAt).toBe("2026-04-21T15:00:00Z");
  });

  it("skips propose_move entries that failed", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "propose_move",
        input: { kind: "call_now", title: "x" },
        result: { error: "budget exhausted" },
        ok: false,
      },
    ];
    expect(extractProposedMoves(trace)).toEqual([]);
  });

  it("tolerates malformed move payloads without throwing", () => {
    const trace: AskIronToolTraceEntry[] = [
      { tool: "propose_move", input: {}, result: { move: null }, ok: true },
      { tool: "propose_move", input: {}, result: { move: "not-an-object" }, ok: true },
      { tool: "propose_move", input: {}, result: { move: { id: 42 } }, ok: true },
    ];
    // Each malformed payload is dropped rather than crashing the UI.
    expect(extractProposedMoves(trace)).toEqual([]);
  });

  it("tolerates missing entity / due_at / priority", () => {
    const trace: AskIronToolTraceEntry[] = [
      {
        tool: "propose_move",
        input: {},
        result: {
          move: {
            id: "m-2",
            kind: "other",
            title: "Thinky thing",
          },
        },
        ok: true,
      },
    ];
    const out = extractProposedMoves(trace);
    expect(out).toHaveLength(1);
    expect(out[0].entity).toBeNull();
    expect(out[0].dueAt).toBeNull();
    // Priority defaults to 50 on missing payload per the spec.
    expect(out[0].priority).toBe(50);
  });
});
