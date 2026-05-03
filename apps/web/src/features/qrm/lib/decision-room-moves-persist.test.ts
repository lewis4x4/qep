import { describe, expect, it } from "bun:test";
import {
  normalizeMoveDbRow,
  normalizeMoveReaction,
  normalizeTriedMove,
  rowToMove,
} from "./decision-room-moves-persist";

describe("decision-room move persistence normalizers", () => {
  it("filters malformed persisted moves and cleans nested reactions", () => {
    expect(normalizeTriedMove({ moveId: "move-1", move: "Missing aggregate" })).toBeNull();

    expect(
      normalizeTriedMove({
        moveId: "move-1",
        move: "Invite finance to the next call",
        reactions: [
          {
            seatId: "contact-1",
            sentiment: "delighted",
            concern: "Budget exposure",
            likelyNext: "Ask for numbers",
            confidence: "certain",
          },
          { seatId: "contact-2", sentiment: "positive" },
        ],
        aggregate: {
          velocityDelta: "3",
          mood: "great",
          summary: "Finance gets pulled in.",
        },
        generatedAt: "2026-05-03T11:00:00Z",
      }),
    ).toEqual({
      moveId: "move-1",
      move: "Invite finance to the next call",
      reactions: [
        {
          seatId: "contact-1",
          sentiment: "neutral",
          concern: "Budget exposure",
          likelyNext: "Ask for numbers",
          confidence: "medium",
        },
      ],
      aggregate: {
        velocityDelta: 3,
        mood: "mixed",
        summary: "Finance gets pulled in.",
      },
      generatedAt: "2026-05-03T11:00:00Z",
    });
  });

  it("normalizes db rows before mapping them to UI move history", () => {
    expect(normalizeMoveDbRow({ id: "db-1", move_text: "Missing deal" })).toBeNull();

    const row = normalizeMoveDbRow({
      id: "db-1",
      deal_id: "deal-1",
      move_text: "Quantify downtime cost",
      reactions: [
        {
          seatId: "ops",
          sentiment: "negative",
          concern: "Disruption",
          likelyNext: "Challenge the timeline",
          confidence: "low",
        },
      ],
      aggregate: {
        velocityDelta: "bad",
        mood: "positive",
        summary: "Operations has a clear objection.",
      },
      velocity_delta: "2",
      mood: "positive",
      generated_at: "2026-05-03T12:00:00Z",
      created_at: "2026-05-03T12:01:00Z",
    });

    expect(row).not.toBeNull();
    expect(rowToMove(row!)).toEqual({
      moveId: "db-1",
      move: "Quantify downtime cost",
      reactions: [
        {
          seatId: "ops",
          sentiment: "negative",
          concern: "Disruption",
          likelyNext: "Challenge the timeline",
          confidence: "low",
        },
      ],
      aggregate: {
        velocityDelta: 2,
        mood: "positive",
        summary: "Operations has a clear objection.",
      },
      generatedAt: "2026-05-03T12:00:00Z",
    });
  });

  it("rejects malformed reactions", () => {
    expect(normalizeMoveReaction({ seatId: "seat-1", concern: "No next step" })).toBeNull();
  });
});
