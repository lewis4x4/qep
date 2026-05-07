import { describe, expect, test } from "bun:test";

import {
  VOICE_QUOTE_HANDOFF_KEY,
  normalizeVoiceQuoteHandoff,
  readVoiceQuoteHandoff,
} from "../voice-quote-handoff";

const validScenario = {
  label: "Voice-selected option",
  description: "Keeps the buyer under budget.",
  programIds: ["program-1"],
  customerOutOfPocketCents: 2500000,
  monthlyPaymentCents: 125000,
  termMonths: 48,
  totalPaidByCustomerCents: 6000000,
  dealerMarginCents: 800000,
  dealerMarginPct: 12.5,
  commissionCents: 120000,
  pros: ["Fast delivery"],
  cons: ["Requires manager pricing review"],
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("voice quote handoff", () => {
  test("accepts matching voice session ids", () => {
    const handoff = normalizeVoiceQuoteHandoff({
      voiceSessionId: "voice-session-123",
      at: "2026-05-06T19:50:00Z",
      scenario: validScenario,
      resolvedModelId: "model-1",
      resolvedBrandId: null,
      deliveryState: "NC",
      customerType: "gmu",
      prompt: "Customer needs a compact track loader.",
      originatingLogId: "log-1",
    }, {
      expectedSessionId: "voice-session-123",
      nowMs: new Date("2026-05-06T19:55:00Z").getTime(),
    });

    expect(handoff?.voiceSessionId).toBe("voice-session-123");
    expect(handoff?.scenario.customerOutOfPocketCents).toBe(2500000);
    expect(handoff?.customerType).toBe("gmu");
  });

  test("rejects mismatched, stale, or malformed handoffs", () => {
    const payload = {
      voiceSessionId: "voice-session-123",
      at: "2026-05-06T19:40:00Z",
      scenario: validScenario,
      customerType: "standard",
    };

    expect(normalizeVoiceQuoteHandoff(payload, {
      expectedSessionId: "voice-session-other",
      nowMs: new Date("2026-05-06T19:45:00Z").getTime(),
    })).toBeNull();
    expect(normalizeVoiceQuoteHandoff(payload, {
      expectedSessionId: "voice-session-123",
      nowMs: new Date("2026-05-06T19:51:00Z").getTime(),
    })).toBeNull();
    expect(normalizeVoiceQuoteHandoff({ ...payload, voiceSessionId: "" })).toBeNull();
    expect(normalizeVoiceQuoteHandoff({ ...payload, scenario: { label: "Missing economics" } })).toBeNull();
  });

  test("reads only the handoff matching the URL session id", () => {
    const storage = memoryStorage({
      [VOICE_QUOTE_HANDOFF_KEY]: JSON.stringify({
        voiceSessionId: "voice-session-123",
        at: "2026-05-06T19:50:00Z",
        scenario: validScenario,
        customerType: "standard",
      }),
    });

    expect(readVoiceQuoteHandoff(
      "voice-session-123",
      storage,
      new Date("2026-05-06T19:55:00Z").getTime(),
    )?.voiceSessionId).toBe("voice-session-123");
    expect(readVoiceQuoteHandoff(
      "voice-session-other",
      storage,
      new Date("2026-05-06T19:55:00Z").getTime(),
    )).toBeNull();
  });
});
