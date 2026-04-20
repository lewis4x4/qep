/**
 * Bun tests for the Slice 8 Pulse → Ask Iron handoff module.
 *
 * The type-guard is small but load-bearing: it's the only thing preventing a
 * stale router-state payload from re-firing a question on refresh. Each path
 * here corresponds to a real browser shape we've seen in practice.
 */

import { describe, expect, it } from "bun:test";
import {
  ASK_IRON_PATH,
  isAskIronSeedState,
} from "../src/features/qrm/components/askIronHandoff";

describe("ASK_IRON_PATH", () => {
  it("points at the operations-copilot route (shell_v2)", () => {
    expect(ASK_IRON_PATH).toBe("/qrm/operations-copilot");
  });
});

describe("isAskIronSeedState", () => {
  it("returns true for a well-formed seed payload", () => {
    expect(
      isAskIronSeedState({
        askIronSeed: { question: "Triage this", source: "pulse" },
      }),
    ).toBe(true);
  });

  it("accepts optional sourceId without complaint", () => {
    expect(
      isAskIronSeedState({
        askIronSeed: {
          question: "Triage this",
          source: "pulse",
          sourceId: "sig-42",
        },
      }),
    ).toBe(true);
  });

  it("returns false for an empty object (typical after refresh)", () => {
    expect(isAskIronSeedState({})).toBe(false);
  });

  it("returns false for null (router default when no state passed)", () => {
    expect(isAskIronSeedState(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAskIronSeedState(undefined)).toBe(false);
  });

  it("returns false when askIronSeed is missing", () => {
    expect(isAskIronSeedState({ other: "payload" })).toBe(false);
  });

  it("returns false when askIronSeed is null", () => {
    expect(isAskIronSeedState({ askIronSeed: null })).toBe(false);
  });

  it("returns false when question is missing", () => {
    expect(
      isAskIronSeedState({ askIronSeed: { source: "pulse" } }),
    ).toBe(false);
  });

  it("returns false when question is an empty string", () => {
    expect(
      isAskIronSeedState({
        askIronSeed: { question: "", source: "pulse" },
      }),
    ).toBe(false);
  });

  it("returns false when question is whitespace-only", () => {
    expect(
      isAskIronSeedState({
        askIronSeed: { question: "   \n  ", source: "pulse" },
      }),
    ).toBe(false);
  });

  it("returns false when question is a non-string", () => {
    expect(
      isAskIronSeedState({
        askIronSeed: { question: 42, source: "pulse" },
      }),
    ).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isAskIronSeedState("string")).toBe(false);
    expect(isAskIronSeedState(42)).toBe(false);
    expect(isAskIronSeedState(true)).toBe(false);
  });
});
