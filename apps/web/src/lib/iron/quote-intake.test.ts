import { describe, expect, test } from "bun:test";
import {
  buildIronQuoteIntakeQuestion,
  buildQuoteCustomerSearchCandidates,
  extractIronQuoteIntakeIntent,
  extractIronQuoteStructuredIntake,
  isIronQuoteIntakeReady,
  mergeIronQuoteIntakeIntent,
} from "./quote-intake";

describe("Iron quote intake intent", () => {
  test("routes short natural start quote phrase", () => {
    const intent = extractIronQuoteIntakeIntent("start a quote for big oak underbrushing");

    expect(intent).not.toBeNull();
    expect(intent?.rawText).toBe("start a quote for big oak underbrushing");
    expect(intent?.targetText).toBe("big oak underbrushing");
    expect(intent?.customerSearchCandidates).toContain("big oak");
    expect(intent?.structuredIntake.customerText).toBe("big oak");
    expect(intent?.structuredIntake.applicationText).toBe("underbrushing");
    expect(intent?.structuredIntake.missingFields).toContain("equipment");
  });

  test("routes messy spoken equipment/customer/options/timeframe phrase and preserves raw context", () => {
    const phrase = "I need to quote this piece of equipment for this customer and he wants these options in this timeframe";
    const intent = extractIronQuoteIntakeIntent(phrase);

    expect(intent).not.toBeNull();
    expect(intent?.rawText).toBe(phrase);
    expect(intent?.targetText).toBe("this customer and he wants these options in this timeframe");
    expect(intent?.confidence).toBe("high");
    expect(intent?.structuredIntake.customerText).toBeNull();
    expect(intent?.structuredIntake.equipmentText).toBeNull();
    expect(intent?.structuredIntake.missingFields).toEqual(["customer", "equipment", "options", "timeframe"]);
  });

  test("routes pricing/proposal creation phrases", () => {
    expect(extractIronQuoteIntakeIntent("put together pricing for Big Oak for a brush cutter")).not.toBeNull();
    expect(extractIronQuoteIntakeIntent("create proposal for Anderson next week")).not.toBeNull();
  });

  test("keeps single-token customer candidates before timeframe words", () => {
    const intent = extractIronQuoteIntakeIntent("create proposal for Anderson next week");

    expect(intent?.customerSearchCandidates).toContain("anderson");
  });

  test("extracts complete structured quote intake", () => {
    const structured = extractIronQuoteStructuredIntake(
      "quote a Bobcat T770 for Big Oak with forestry mulcher and beacon kit by next week",
    );

    expect(structured.customerText).toBe("Big Oak");
    expect(structured.equipmentText).toBe("Bobcat T770");
    expect(structured.optionsText).toBe("forestry mulcher and beacon kit");
    expect(structured.timeframeText).toBe("by next week");
    expect(structured.missingFields).toEqual([]);
  });

  test("asks for missing intake fields before opening Quote Builder", () => {
    const intent = extractIronQuoteIntakeIntent("start a quote for big oak underbrushing");

    expect(intent).not.toBeNull();
    expect(isIronQuoteIntakeReady(intent!)).toBe(false);
    expect(buildIronQuoteIntakeQuestion(intent!)).toContain("What machine");
  });

  test("merges follow-up answers into a ready structured intake", () => {
    const intent = extractIronQuoteIntakeIntent("start a quote for big oak underbrushing");
    const merged = mergeIronQuoteIntakeIntent(
      intent!,
      "Bobcat T770 with forestry mulcher, needs it next week",
    );

    expect(merged.structuredIntake.equipmentText).toBe("Bobcat T770");
    expect(merged.structuredIntake.optionsText).toBe("forestry mulcher");
    expect(merged.structuredIntake.timeframeText).toBe("next week");
    expect(isIronQuoteIntakeReady(merged)).toBe(true);
  });

  test("does not intercept quote status or lookup questions", () => {
    expect(extractIronQuoteIntakeIntent("what quotes are pending approval")).toBeNull();
    expect(extractIronQuoteIntakeIntent("find quote for Acme")).toBeNull();
    expect(extractIronQuoteIntakeIntent("what is the status of the Acme quote")).toBeNull();
  });
});

describe("quote customer search candidate generation", () => {
  test("keeps full target and stripped work-tail customer candidate", () => {
    const candidates = buildQuoteCustomerSearchCandidates("big oak underbrushing");

    expect(candidates[0]).toBe("big oak underbrushing");
    expect(candidates).toContain("big oak");
  });

  test("dedupes and caps candidates", () => {
    const candidates = buildQuoteCustomerSearchCandidates("big oak underbrushing with delivery options timeframe");

    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates.length).toBeLessThanOrEqual(4);
  });
});
