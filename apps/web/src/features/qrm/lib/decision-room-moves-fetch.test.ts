import { describe, expect, it } from "bun:test";
import {
  normalizeDealDbRow,
  normalizeMoveDbRow,
  normalizeNeedsAssessmentDbRow,
  normalizeProfileDbRow,
  normalizeStageDbRow,
} from "./decision-room-moves-fetch";

describe("decision-room move fetch normalizers", () => {
  it("filters malformed move rows and cleans enum/numeric fields", () => {
    expect(normalizeMoveDbRow(null)).toBeNull();
    expect(normalizeMoveDbRow({ id: "move-1", created_at: "2026-05-03T10:00:00Z" })).toBeNull();

    expect(
      normalizeMoveDbRow({
        id: "move-1",
        move_text: "Surface the economic buyer",
        mood: "excited",
        velocity_delta: "4.5",
        created_at: "2026-05-03T10:00:00Z",
        user_id: 42,
        deal_id: "deal-1",
      }),
    ).toEqual({
      id: "move-1",
      move_text: "Surface the economic buyer",
      mood: null,
      velocity_delta: 4.5,
      created_at: "2026-05-03T10:00:00Z",
      user_id: null,
      deal_id: "deal-1",
    });
  });

  it("keeps valid related rows and rejects missing required ids", () => {
    expect(
      normalizeProfileDbRow({
        id: "user-1",
        full_name: "Dana Rep",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({
      id: "user-1",
      full_name: "Dana Rep",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(normalizeProfileDbRow({ full_name: "No id" })).toBeNull();

    expect(
      normalizeDealDbRow({
        id: "deal-1",
        name: "Valid Deal",
        amount: "125000",
        stage_id: "stage-1",
      }),
    ).toEqual({
      id: "deal-1",
      name: "Valid Deal",
      amount: 125000,
      stage_id: "stage-1",
    });
    expect(normalizeDealDbRow({ id: "", amount: 25 })).toBeNull();

    expect(
      normalizeStageDbRow({
        id: "stage-1",
        is_closed_won: true,
        is_closed_lost: "false",
      }),
    ).toEqual({
      id: "stage-1",
      is_closed_won: true,
      is_closed_lost: null,
    });
    expect(normalizeStageDbRow({ is_closed_won: true })).toBeNull();

    expect(
      normalizeNeedsAssessmentDbRow({
        deal_id: "deal-1",
        machine_interest: "compact tractor",
      }),
    ).toEqual({
      deal_id: "deal-1",
      machine_interest: "compact tractor",
    });
    expect(normalizeNeedsAssessmentDbRow({ machine_interest: "loader" })).toBeNull();
  });
});
