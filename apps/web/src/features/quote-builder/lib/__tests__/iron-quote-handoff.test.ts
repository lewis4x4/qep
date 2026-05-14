import { describe, expect, test } from "bun:test";
import {
  IRON_QUOTE_HANDOFF_KEY,
  normalizeIronQuoteHandoff,
  readIronQuoteHandoff,
  writeIronQuoteHandoff,
  type IronQuoteHandoff,
} from "../iron-quote-handoff";

function makeHandoff(overrides: Partial<IronQuoteHandoff> = {}): IronQuoteHandoff {
  return {
    handoffId: "handoff-1",
    at: "2026-05-13T22:00:00.000Z",
    rawText: "start a quote for big oak underbrushing",
    targetText: "big oak underbrushing",
    sourceConversationId: null,
    resolvedContactId: null,
    resolvedCompanyId: "company-1",
    resolvedCustomerName: null,
    resolvedCustomerCompany: "Big Oak",
    resolvedCustomerPhone: "555-0100",
    resolvedCustomerEmail: null,
    customerSearchQuery: "big oak",
    customerMatchKind: "company",
    structuredCustomerText: "big oak",
    structuredEquipmentText: "Bobcat T770",
    structuredOptionsText: "forestry mulcher",
    structuredTimeframeText: "next week",
    structuredApplicationText: "underbrushing",
    structuredMissingFields: [],
    ...overrides,
  };
}

describe("Iron quote handoff", () => {
  test("normalizes valid handoff", () => {
    const handoff = normalizeIronQuoteHandoff(makeHandoff(), {
      expectedHandoffId: "handoff-1",
      nowMs: new Date("2026-05-13T22:05:00.000Z").getTime(),
    });

    expect(handoff?.rawText).toBe("start a quote for big oak underbrushing");
    expect(handoff?.customerMatchKind).toBe("company");
    expect(handoff?.structuredEquipmentText).toBe("Bobcat T770");
    expect(handoff?.structuredMissingFields).toEqual([]);
  });

  test("rejects mismatched or expired handoff", () => {
    expect(normalizeIronQuoteHandoff(makeHandoff(), {
      expectedHandoffId: "other",
      nowMs: new Date("2026-05-13T22:05:00.000Z").getTime(),
    })).toBeNull();

    expect(normalizeIronQuoteHandoff(makeHandoff(), {
      expectedHandoffId: "handoff-1",
      nowMs: new Date("2026-05-13T23:00:01.000Z").getTime(),
    })).toBeNull();
  });

  test("normalizes structured missing fields safely", () => {
    const handoff = normalizeIronQuoteHandoff(makeHandoff({
      structuredMissingFields: ["equipment", "bad" as never, "timeframe", "equipment"],
    }), {
      expectedHandoffId: "handoff-1",
      nowMs: new Date("2026-05-13T22:05:00.000Z").getTime(),
    });

    expect(handoff?.structuredMissingFields).toEqual(["equipment", "timeframe"]);
  });

  test("reports unavailable storage", () => {
    expect(writeIronQuoteHandoff(makeHandoff(), null)).toBe(false);
  });

  test("writes and reads from supplied storage", () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    } as Storage;

    expect(writeIronQuoteHandoff(makeHandoff(), fakeStorage)).toBe(true);
    expect(storage.has(IRON_QUOTE_HANDOFF_KEY)).toBe(true);
    const handoff = readIronQuoteHandoff(
      "handoff-1",
      fakeStorage,
      new Date("2026-05-13T22:05:00.000Z").getTime(),
    );
    expect(handoff?.resolvedCustomerCompany).toBe("Big Oak");
  });
});
