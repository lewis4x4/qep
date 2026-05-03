import { describe, expect, test } from "bun:test";

import {
  isAbortError,
  normalizeCopilotDraftPatch,
  normalizeCopilotSignals,
  normalizeCopilotTurnRows,
  normalizeDealCopilotSseEvent,
  parseDealCopilotSseEvent,
} from "../deal-copilot-normalizers";

describe("deal copilot normalizers", () => {
  test("normalizes persisted turn rows and filters malformed rows", () => {
    const rows = normalizeCopilotTurnRows([
      {
        id: "turn-1",
        turn_index: "2",
        input_source: "voice",
        raw_input: "Customer wants cash.",
        extracted_signals: {
          customer_signals: {
            objections: ["price", "", 42],
            timeline_pressure: "weeks",
            competitor_mentions: ["Deere"],
          },
          financing_pref: "cash",
          customer_warmth: "warm",
        },
        copilot_reply: "Captured cash preference.",
        score_before: "55",
        score_after: 61,
        created_at: "2026-05-03T12:00:00Z",
      },
      null,
      {},
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("turn-1");
    expect(rows[0]?.turnIndex).toBe(2);
    expect(rows[0]?.inputSource).toBe("voice");
    expect(rows[0]?.extractedSignals.customerSignals?.objections).toEqual(["price"]);
    expect(rows[0]?.extractedSignals.customerSignals?.competitorMentions).toEqual(["Deere"]);
    expect(rows[0]?.extractedSignals.financingPref).toBe("cash");
    expect(rows[0]?.scoreBefore).toBe(55);
  });

  test("normalizes extracted signals with enum fallbacks", () => {
    expect(normalizeCopilotSignals({
      customerSignals: {
        objections: ["needs owner approval"],
        timelinePressure: "bad",
      },
      financingPref: "bad",
      customerWarmth: "cool",
      notes: ["Follow up Friday", ""],
    })).toEqual({
      customerSignals: { objections: ["needs owner approval"] },
      customerWarmth: "cool",
      notes: ["Follow up Friday"],
    });
  });

  test("allow-lists draft patch fields", () => {
    expect(normalizeCopilotDraftPatch({
      customerSignals: {
        objections: ["price"],
        competitorMentions: ["CAT"],
        timelinePressure: "immediate",
      },
      financingPref: "financing",
      customerWarmth: "dormant",
      quoteStatus: "approved",
    })).toEqual({
      customerSignals: {
        openDeals: 0,
        openDealValueCents: 0,
        lastContactDaysAgo: null,
        pastQuoteCount: 0,
        pastQuoteValueCents: 0,
        objections: ["price"],
        competitorMentions: ["CAT"],
        timelinePressure: "immediate",
      },
      financingPref: "financing",
      customerWarmth: "dormant",
    });
  });

  test("normalizes SSE events and rejects malformed score frames", () => {
    expect(normalizeDealCopilotSseEvent({
      type: "score",
      before: "50",
      after: "58",
      factors: [{ label: "Warm customer", weight: "8", rationale: "Recent contact", kind: "relationship" }],
      lifts: [{ id: "address_objection", label: "Address objection", delta_pts: "4", rationale: "Price", action_hint: "Ask why" }],
    })).toEqual({
      type: "score",
      before: 50,
      after: 58,
      factors: [{ label: "Warm customer", weight: 8, rationale: "Recent contact", kind: "relationship" }],
      lifts: [{ id: "address_objection", label: "Address objection", deltaPts: 4, rationale: "Price", actionHint: "Ask why" }],
    });

    expect(normalizeDealCopilotSseEvent({ type: "score", before: 50 })).toBeNull();
  });

  test("parses SSE JSON without throwing", () => {
    expect(parseDealCopilotSseEvent(JSON.stringify({ type: "reply", text: "Done" }))).toEqual({
      type: "reply",
      text: "Done",
    });
    expect(parseDealCopilotSseEvent("{not-json")).toBeNull();
  });

  test("detects abort errors without casting", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("Other"))).toBe(false);
  });
});
