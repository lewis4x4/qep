import { describe, expect, it } from "bun:test";
import { buildFleetIntelligenceBoard } from "./fleet-intelligence";
import type { Account360FleetItem, Account360ServiceJob } from "./account-360-api";
import type { CustomerFleetUnit } from "@/features/dge/types";

const fleet: Account360FleetItem[] = [
  {
    id: "eq-1",
    name: "CAT 320",
    make: "CAT",
    model: "320",
    year: 2019,
    engine_hours: 4200,
    serial_number: "CAT320-01",
    asset_tag: null,
    stage_label: null,
    eta: null,
    stage_updated: null,
  },
  {
    id: "eq-2",
    name: "Bobcat T66",
    make: "Bobcat",
    model: "T66",
    year: 2023,
    engine_hours: 900,
    serial_number: "T66-9",
    asset_tag: null,
    stage_label: null,
    eta: null,
    stage_updated: null,
  },
];

const service: Account360ServiceJob[] = [
  {
    id: "job-1",
    current_stage: "in_progress",
    customer_problem_summary: "Hydraulic leak",
    scheduled_start_at: null,
    scheduled_end_at: null,
    completed_at: null,
    machine_id: "eq-1",
  },
  {
    id: "job-2",
    current_stage: "closed",
    customer_problem_summary: "Filter change",
    scheduled_start_at: null,
    scheduled_end_at: null,
    completed_at: "2026-03-10T12:00:00.000Z",
    machine_id: "eq-1",
  },
];

const predictions: CustomerFleetUnit[] = [
  {
    id: "fi-1",
    equipment_serial: "CAT320-01",
    make: "CAT",
    model: "320",
    year: 2019,
    current_hours: 4200,
    predicted_replacement_date: "2026-05-15",
    replacement_confidence: 0.82,
  },
  {
    id: "fi-2",
    equipment_serial: "T66-9",
    make: "Bobcat",
    model: "T66",
    year: 2023,
    current_hours: 900,
    predicted_replacement_date: null,
    replacement_confidence: null,
  },
];

describe("buildFleetIntelligenceBoard", () => {
  it("combines fleet, attachment, service, and replacement data into an account board", () => {
    const board = buildFleetIntelligenceBoard({
      fleet,
      service,
      predictions,
      equipmentMetadata: [
        { equipmentId: "eq-1", attachmentCount: 2 },
        { equipmentId: "eq-2", attachmentCount: 0 },
      ],
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(board.summary.ownedMachines).toBe(2);
    expect(board.summary.attachmentGaps).toBe(1);
    expect(board.summary.replacementWindowMachines).toBe(1);
    expect(Math.round(board.summary.avgHours ?? 0)).toBe(2550);
    expect(board.machines[0]?.equipmentId).toBe("eq-1");
    expect(board.machines[0]?.replacementWindow).toBe("60d");
    expect(board.machines[0]?.openServiceCount).toBe(1);
    expect(board.machines[1]?.hasAttachmentGap).toBe(true);
  });

  it("falls back when no replacement prediction exists", () => {
    const board = buildFleetIntelligenceBoard({
      fleet: [fleet[1]!],
      service: [],
      predictions: [],
      equipmentMetadata: [],
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(board.summary.replacementWindowMachines).toBe(0);
    expect(board.machines[0]?.replacementWindow).toBe("none");
    expect(board.machines[0]?.hasAttachmentGap).toBe(true);
  });
});
