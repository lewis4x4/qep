import { describe, expect, it } from "bun:test";
import {
  normalizeDecisionRoomLostDealRows,
  normalizeDecisionRoomRecentLossRows,
  normalizeDecisionRoomStageRows,
  normalizeDecisionRoomWonDealRows,
} from "./decision-room-deal-rows";

describe("decision room deal row normalizers", () => {
  it("normalizes won stages and won deal rows", () => {
    expect(normalizeDecisionRoomStageRows([
      { id: "stage-1", is_closed_won: true },
      { id: "stage-2", is_closed_won: null },
      { name: "bad" },
    ])).toEqual([
      { id: "stage-1", is_closed_won: true },
      { id: "stage-2", is_closed_won: false },
    ]);

    expect(normalizeDecisionRoomWonDealRows([
      {
        id: "deal-1",
        name: "Won deal",
        amount: 125000,
        company_id: "company-1",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-10T00:00:00.000Z",
        expected_close_on: null,
        stage_id: "stage-1",
      },
      {
        id: "deal-2",
        name: 42,
        amount: Number.NaN,
        company_id: null,
        created_at: null,
        updated_at: null,
        expected_close_on: "2026-05-01",
        stage_id: null,
      },
    ])).toEqual([
      {
        id: "deal-1",
        name: "Won deal",
        amount: 125000,
        company_id: "company-1",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-10T00:00:00.000Z",
        expected_close_on: null,
        stage_id: "stage-1",
      },
      {
        id: "deal-2",
        name: null,
        amount: null,
        company_id: null,
        created_at: null,
        updated_at: null,
        expected_close_on: "2026-05-01",
        stage_id: null,
      },
    ]);
  });

  it("normalizes loss lens and gym rows", () => {
    expect(normalizeDecisionRoomLostDealRows([
      {
        id: "loss-1",
        name: "Lost deal",
        amount: 90000,
        loss_reason: "price",
        competitor: "Competitor A",
        company_id: "company-1",
        expected_close_on: "2026-04-30",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
    ])[0]).toMatchObject({
      id: "loss-1",
      amount: 90000,
      loss_reason: "price",
      competitor: "Competitor A",
    });

    expect(normalizeDecisionRoomRecentLossRows([
      {
        id: "gym-1",
        name: null,
        amount: Number.POSITIVE_INFINITY,
        loss_reason: "timing",
        competitor: 42,
        updated_at: "2026-04-15T00:00:00.000Z",
      },
    ])).toEqual([
      {
        id: "gym-1",
        name: null,
        amount: null,
        loss_reason: "timing",
        competitor: null,
        updated_at: "2026-04-15T00:00:00.000Z",
      },
    ]);
  });

  it("returns empty lists for non-array payloads and malformed rows", () => {
    expect(normalizeDecisionRoomStageRows(null)).toEqual([]);
    expect(normalizeDecisionRoomWonDealRows({ id: "deal-1" })).toEqual([]);
    expect(normalizeDecisionRoomLostDealRows(undefined)).toEqual([]);
    expect(normalizeDecisionRoomRecentLossRows([{ name: "missing id" }])).toEqual([]);
  });
});
