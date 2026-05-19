import { describe, expect, test } from "bun:test";
import {
  formatExtractedAmount,
  isExtractionEmpty,
  pickSmartActions,
  titleCaseTopic,
} from "./voice-extraction-presentation";
import { EMPTY_VOICE_EXTRACTION, type VoiceExtractionResult } from "@/lib/iron/voice/extract";

function ext(overrides: Partial<VoiceExtractionResult> = {}): VoiceExtractionResult {
  return { ...EMPTY_VOICE_EXTRACTION, ...overrides };
}

describe("formatExtractedAmount", () => {
  test("returns null for null/zero/negative", () => {
    expect(formatExtractedAmount(null)).toBeNull();
    expect(formatExtractedAmount(0)).toBeNull();
    expect(formatExtractedAmount(-100)).toBeNull();
  });

  test("formats under-1K as plain dollars", () => {
    expect(formatExtractedAmount(50_000)).toBe("$500");
  });

  test("formats round thousands", () => {
    expect(formatExtractedAmount(186_00_000)).toBe("$186K");
  });

  test("formats decimal thousands to 1 decimal", () => {
    expect(formatExtractedAmount(1_250_000)).toBe("$12.5K");
  });

  test("formats round millions", () => {
    expect(formatExtractedAmount(2_000_000_00)).toBe("$2M");
  });

  test("formats decimal millions to 1 decimal", () => {
    expect(formatExtractedAmount(2_500_000_00)).toBe("$2.5M");
  });
});

describe("titleCaseTopic", () => {
  test("renders compound topics readably", () => {
    expect(titleCaseTopic("quote_followup")).toBe("Quote follow-up");
    expect(titleCaseTopic("trade_in")).toBe("Trade-in");
  });

  test("falls back to Note for other", () => {
    expect(titleCaseTopic("other")).toBe("Note");
  });
});

describe("isExtractionEmpty", () => {
  test("true for null", () => {
    expect(isExtractionEmpty(null)).toBe(true);
  });

  test("true for fully-empty result with default topic", () => {
    expect(isExtractionEmpty(ext())).toBe(true);
  });

  test("false when next_step present", () => {
    expect(isExtractionEmpty(ext({ next_step: "Call Frank" }))).toBe(false);
  });

  test("false when equipment present", () => {
    expect(isExtractionEmpty(ext({ equipment_mentioned: ["5T forklift"] }))).toBe(false);
  });

  test("false when topic is non-default", () => {
    expect(isExtractionEmpty(ext({ topic: "visit" }))).toBe(false);
  });
});

describe("pickSmartActions", () => {
  test("always includes log_activity action default-on", () => {
    const actions = pickSmartActions({
      extraction: null,
      selectedCustomerId: null,
      selectedDealId: null,
    });
    expect(actions.length).toBe(1);
    expect(actions[0]?.id).toBe("log_activity");
    expect(actions[0]?.defaultOn).toBe(true);
  });

  test("adds schedule_follow_up when next_step + due present", () => {
    const actions = pickSmartActions({
      extraction: ext({ next_step: "Send revised quote", next_step_due: "2026-05-23" }),
      selectedCustomerId: "cust-1",
      selectedDealId: null,
    });
    const followUp = actions.find((a) => a.id === "schedule_follow_up");
    expect(followUp).toBeDefined();
    expect(followUp?.defaultOn).toBe(true);
    expect(followUp?.label).toContain("2026-05-23");
  });

  test("does not add schedule_follow_up without a due date", () => {
    const actions = pickSmartActions({
      extraction: ext({ next_step: "Call back", next_step_due: null }),
      selectedCustomerId: null,
      selectedDealId: null,
    });
    expect(actions.find((a) => a.id === "schedule_follow_up")).toBeUndefined();
  });

  test("adds open_quote_builder default-off when equipment present", () => {
    const actions = pickSmartActions({
      extraction: ext({ equipment_mentioned: ["5T forklift", "boom lift"] }),
      selectedCustomerId: null,
      selectedDealId: null,
    });
    const qb = actions.find((a) => a.id === "open_quote_builder");
    expect(qb).toBeDefined();
    expect(qb?.defaultOn).toBe(false);
    expect(qb?.label).toContain("5T forklift");
  });

  test("mark_deal_cooling requires sentiment cooling AND deal selected", () => {
    const noDeal = pickSmartActions({
      extraction: ext({ sentiment: "cooling" }),
      selectedCustomerId: "cust-1",
      selectedDealId: null,
    });
    expect(noDeal.find((a) => a.id === "mark_deal_cooling")).toBeUndefined();

    const withDeal = pickSmartActions({
      extraction: ext({ sentiment: "cooling" }),
      selectedCustomerId: "cust-1",
      selectedDealId: "deal-1",
    });
    expect(withDeal.find((a) => a.id === "mark_deal_cooling")).toBeDefined();
  });

  test("log_activity label reflects extracted topic", () => {
    const actions = pickSmartActions({
      extraction: ext({ topic: "quote_followup" }),
      selectedCustomerId: null,
      selectedDealId: null,
    });
    expect(actions[0]?.label.toLowerCase()).toContain("quote follow-up");
  });
});
