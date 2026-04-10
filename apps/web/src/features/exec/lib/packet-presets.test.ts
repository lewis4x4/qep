import { describe, expect, test } from "bun:test";
import { EXEC_PACKET_PRESETS, getPacketPreset } from "./packet-presets";

describe("packet presets", () => {
  test("exposes presets for each executive role", () => {
    expect(EXEC_PACKET_PRESETS.ceo.length).toBeGreaterThan(0);
    expect(EXEC_PACKET_PRESETS.cfo.length).toBeGreaterThan(0);
    expect(EXEC_PACKET_PRESETS.coo.length).toBeGreaterThan(0);
  });

  test("falls back to the first preset when the id is unknown", () => {
    expect(getPacketPreset("ceo", "missing").id).toBe("daily-brief");
  });

  test("resolves the board-ready preset", () => {
    expect(getPacketPreset("coo", "weekly-board").boardReady).toBe(true);
  });
});
