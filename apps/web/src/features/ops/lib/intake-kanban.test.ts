import { describe, expect, test } from "bun:test";
import {
  getChecklistProgress,
  getEquipmentLabel,
  getPhotoCount,
  validateIntakeStageAdvance,
  type IntakeCardRecord,
} from "./intake-kanban";

function makeRecord(overrides: Partial<IntakeCardRecord> = {}): IntakeCardRecord {
  return {
    id: "intake-1",
    current_stage: 1,
    stock_number: "STK-1",
    ship_to_branch: "Lake City",
    arrival_photos: [],
    pdi_checklist: [],
    pdi_completed: false,
    photo_ready: false,
    listing_photos: [],
    crm_equipment: { name: "Bandit Chipper" },
    ...overrides,
  };
}

describe("intake-kanban helpers", () => {
  test("returns the joined equipment name when present", () => {
    expect(getEquipmentLabel(makeRecord())).toBe("Bandit Chipper");
  });

  test("counts arrival and listing photos together", () => {
    expect(
      getPhotoCount(
        makeRecord({
          arrival_photos: ["a"],
          listing_photos: ["b", "c"],
        }),
      ),
    ).toBe(3);
  });

  test("counts completed checklist results", () => {
    expect(
      getChecklistProgress(
        makeRecord({
          pdi_checklist: [
            { id: "oil", status: "pass" },
            { id: "lights", status: "fail" },
            { id: "notes-only" },
          ],
        }),
      ),
    ).toEqual({ completed: 2, total: 3 });
  });
});

describe("validateIntakeStageAdvance", () => {
  test("blocks stage 2 exits when arrival photos are missing", () => {
    const result = validateIntakeStageAdvance(makeRecord({ current_stage: 2 }), 3);
    expect(result.allowed).toBe(false);
  });

  test("blocks stage 3 exits when PDI is incomplete", () => {
    const result = validateIntakeStageAdvance(makeRecord({ current_stage: 3, pdi_completed: false }), 4);
    expect(result.allowed).toBe(false);
  });

  test("allows stage 3 exit after PDI completion", () => {
    const result = validateIntakeStageAdvance(makeRecord({ current_stage: 3, pdi_completed: true }), 4);
    expect(result.allowed).toBe(true);
  });

  test("blocks stage 6 exits when listing photos are missing", () => {
    const result = validateIntakeStageAdvance(makeRecord({ current_stage: 6, photo_ready: true }), 7);
    expect(result.allowed).toBe(false);
  });
});
