import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  buildLocalDraftKey,
  clearLocalDraft,
  isDraftEmpty,
  listLocalDraftsForUser,
  loadLocalDraft,
  saveLocalDraft,
} from "../local-draft";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function makeDraft(partial: Partial<QuoteWorkspaceDraft> = {}): QuoteWorkspaceDraft {
  return {
    entryMode: "manual",
    branchSlug: "",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 0,
    selectedFinanceScenario: null,
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "draft",
    ...partial,
  };
}

class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

beforeEach(() => {
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
    localStorage: new MemoryStorage(),
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("buildLocalDraftKey", () => {
  test("prefers dealId over contactId and prefixes the userId", () => {
    expect(buildLocalDraftKey({ userId: "u1", dealId: "d1", contactId: "c1" }))
      .toBe("u1.deal:d1");
  });
  test("falls back to contactId when dealId missing", () => {
    expect(buildLocalDraftKey({ userId: "u1", contactId: "c1" }))
      .toBe("u1.contact:c1");
  });
  test('returns "<userId>.new" when neither is present', () => {
    expect(buildLocalDraftKey({ userId: "u1" })).toBe("u1.new");
  });
  test("different users get different keys for the same deal", () => {
    const a = buildLocalDraftKey({ userId: "userA", dealId: "shared-deal" });
    const b = buildLocalDraftKey({ userId: "userB", dealId: "shared-deal" });
    expect(a).not.toBe(b);
  });
});

describe("isDraftEmpty", () => {
  test("treats the default builder draft as empty", () => {
    expect(isDraftEmpty(makeDraft())).toBe(true);
  });
  test("non-empty with customer name", () => {
    expect(isDraftEmpty(makeDraft({ customerName: "Thomas Sykes" }))).toBe(false);
  });
  test("non-empty with equipment", () => {
    expect(isDraftEmpty(makeDraft({
      equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
    }))).toBe(false);
  });
  test("non-empty with pricing lines only", () => {
    expect(isDraftEmpty(makeDraft({
      pricingLines: [{ kind: "pdi", title: "PDI", quantity: 1, unitPrice: 500 }],
    }))).toBe(false);
  });
  test("non-empty with contactId (picked from CRM)", () => {
    expect(isDraftEmpty(makeDraft({ contactId: "abc-123" }))).toBe(false);
  });
  test("non-empty with follow-up date", () => {
    expect(isDraftEmpty(makeDraft({ followUpAt: "2026-06-01T12:00:00.000Z" }))).toBe(false);
  });
  test("non-empty with delivery geography", () => {
    expect(isDraftEmpty(makeDraft({ deliveryState: "FL", deliveryCounty: "Columbia" }))).toBe(false);
  });
  test("non-empty with why-this-machine or special terms", () => {
    expect(isDraftEmpty(makeDraft({ whyThisMachine: "Fits the job." }))).toBe(false);
    expect(isDraftEmpty(makeDraft({ specialTerms: "Net 30" }))).toBe(false);
  });
});

describe("save/load/clear round-trip", () => {
  test("saved draft round-trips non-PII quote structure through load", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D1" });
    const draft = makeDraft({
      customerName: "Thomas Sykes",
      customerCompany: "Sykes Excavation",
      customerEmail: "thomas@example.com",
      customerPhone: "555-1212",
      equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
    });
    saveLocalDraft(key, draft);
    const loaded = loadLocalDraft(key);
    expect(loaded?.customerName).toBeUndefined();
    expect(loaded?.customerCompany).toBeUndefined();
    expect(loaded?.customerEmail).toBeUndefined();
    expect(loaded?.customerPhone).toBeUndefined();
    expect(loaded?.equipment?.[0]?.title).toBe("CAT 320");
  });

  test("round-trips postApprovalAction for approval routing prefs", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D-post-approval" });
    const draft = makeDraft({
      postApprovalAction: "auto_send_customer",
      equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
    });
    saveLocalDraft(key, draft);
    const loaded = loadLocalDraft(key);
    expect(loaded?.postApprovalAction).toBe("auto_send_customer");
  });

  test("round-trips details and send fields (follow-up, delivery, why-this-machine)", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D-details-local" });
    const draft = makeDraft({
      equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
      followUpAt: "2026-06-01T12:00:00.000Z",
      deliveryState: "FL",
      deliveryCounty: "Columbia",
      whyThisMachine: "Right size for the clearing job.",
      whyThisMachineConfirmed: true,
      specialTerms: "Net 30 for established accounts.",
      depositRequiredAmount: 5000,
      taxOverrideAmount: 100,
      taxOverrideReason: "County rate dispute",
      financingPref: "financing",
      customerWarmth: "warm",
      wizardStep: 9,
      selectedPromotionIds: ["promo-a", "promo-b"],
    });
    saveLocalDraft(key, draft);
    const loaded = loadLocalDraft(key);
    expect(loaded?.followUpAt).toBe("2026-06-01T12:00:00.000Z");
    expect(loaded?.deliveryState).toBe("FL");
    expect(loaded?.deliveryCounty).toBe("Columbia");
    expect(loaded?.whyThisMachine).toBe("Right size for the clearing job.");
    expect(loaded?.whyThisMachineConfirmed).toBe(true);
    expect(loaded?.specialTerms).toBe("Net 30 for established accounts.");
    expect(loaded?.depositRequiredAmount).toBe(5000);
    expect(loaded?.taxOverrideAmount).toBe(100);
    expect(loaded?.taxOverrideReason).toBe("County rate dispute");
    expect(loaded?.financingPref).toBe("financing");
    expect(loaded?.customerWarmth).toBe("warm");
    expect(loaded?.wizardStep).toBe(9);
    expect(loaded?.selectedPromotionIds).toEqual(["promo-a", "promo-b"]);
  });

  test("hydrates legacy cash down and deposit aliases from stored JSON", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "legacy-cash-deposit" });
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem(
        `qep.quote-builder.local-draft.${key}`,
        JSON.stringify({
          savedAt: "2026-05-20T12:00:00.000Z",
          draft: {
            entryMode: "manual",
            branchSlug: "lake-city",
            equipment: [],
            attachments: [],
            down_payment_amount: 7500,
            deposit_amount: 1250,
          },
        }),
      );

    const loaded = loadLocalDraft(key);

    expect(loaded?.cashDown).toBe(7500);
    expect(loaded?.depositRequiredAmount).toBe(1250);
  });

  test("accepts post_approval_action snake_case from stored JSON", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "snake-post-approval" });
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem(
        `qep.quote-builder.local-draft.${key}`,
        JSON.stringify({
          draft: {
            entryMode: "manual",
            equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
            post_approval_action: "auto_send_customer",
          },
          savedAt: "2026-05-15T12:00:00Z",
        }),
      );
    const loaded = loadLocalDraft(key);
    expect(loaded?.postApprovalAction).toBe("auto_send_customer");
  });

  test("round-trips line costVisibility and configure kinds (option)", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D-visibility" });
    const draft = makeDraft({
      equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
      attachments: [
        {
          kind: "option",
          id: "opt-1",
          title: "High flow",
          quantity: 1,
          unitPrice: 2_000,
          costVisibility: "internal",
        },
      ],
    });
    saveLocalDraft(key, draft);
    const loaded = loadLocalDraft(key);
    expect(loaded?.attachments?.[0]?.kind).toBe("option");
    expect(loaded?.attachments?.[0]?.costVisibility).toBe("internal");
  });

  test("accepts cost_visibility snake_case from stored JSON", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "snake-vis" });
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem(
        `qep.quote-builder.local-draft.${key}`,
        JSON.stringify({
          draft: {
            entryMode: "manual",
            equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
            attachments: [
              { kind: "accessory", title: "Beacon", quantity: 1, unitPrice: 400, cost_visibility: "internal" },
            ],
          },
          savedAt: "2026-05-15T12:00:00Z",
        }),
      );
    const loaded = loadLocalDraft(key);
    expect(loaded?.attachments?.[0]?.costVisibility).toBe("internal");
  });

  test("infers internal costVisibility for freight from inbound metadata when cost_visibility absent", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "freight-infer-local" });
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem(
        `qep.quote-builder.local-draft.${key}`,
        JSON.stringify({
          draft: {
            entryMode: "manual",
            equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
            pricingLines: [
              {
                kind: "freight",
                title: "Inbound freight to yard",
                quantity: 1,
                unitPrice: 1200,
                metadata: { pricing_field_key: "inbound_freight", freight_direction: "inbound" },
              },
            ],
          },
          savedAt: "2026-05-15T12:00:00Z",
        }),
      );
    const loaded = loadLocalDraft(key);
    expect(loaded?.pricingLines?.[0]?.costVisibility).toBe("internal");
  });

  test("round-trips pricingLines including freight metadata", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D-pricing-local" });
    const draft = makeDraft({
      equipment: [{ kind: "equipment", title: "CAT 320", quantity: 1, unitPrice: 80_000 }],
      pricingLines: [
        {
          kind: "freight",
          title: "Inbound freight",
          quantity: 1,
          unitPrice: 1200,
          costVisibility: "internal",
          metadata: { pricing_field_key: "inbound_freight", freight_direction: "inbound" },
        },
      ],
    });
    saveLocalDraft(key, draft);
    const loaded = loadLocalDraft(key);
    expect(loaded?.pricingLines?.[0]?.kind).toBe("freight");
    expect(loaded?.pricingLines?.[0]?.costVisibility).toBe("internal");
    expect(loaded?.pricingLines?.[0]?.metadata?.pricing_field_key).toBe("inbound_freight");
    expect(loaded?.pricingLines?.[0]?.metadata?.freight_direction).toBe("inbound");
  });

  test("saved drafts redact voice and transcript-style recommendation excerpts", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D1" });
    saveLocalDraft(key, makeDraft({
      voiceSummary: "Customer needs equipment near 123 Main St.",
      recommendation: {
        machine: "CTL",
        attachments: ["Bucket"],
        reasoning: "Fits the job.",
        alternative: null,
        jobConsiderations: null,
        jobFacts: null,
        transcriptHighlights: [{ quote: "Call me at 555-1212", supports: "follow-up" }],
        trigger: {
          triggerType: "voice_transcript",
          sourceField: "voice",
          excerpt: "Call me at 555-1212",
          createdAt: "2026-05-12T12:00:00Z",
        },
      },
    }));

    const raw = (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.getItem("qep.quote-builder.local-draft.u1.deal:D1");
    expect(raw).not.toContain("123 Main");
    expect(raw).not.toContain("555-1212");
    const loaded = loadLocalDraft(key);
    expect(loaded?.voiceSummary).toBeNull();
    expect(loaded?.recommendation?.transcriptHighlights).toBeNull();
    expect(loaded?.recommendation?.trigger?.excerpt).toBeNull();
  });

  test("load returns null for an unknown key", () => {
    expect(loadLocalDraft("u1.deal:does-not-exist")).toBeNull();
  });

  test("clear removes a saved draft", () => {
    const key = buildLocalDraftKey({ userId: "u1", dealId: "D2" });
    saveLocalDraft(key, makeDraft({ customerName: "Clear Me" }));
    expect(loadLocalDraft(key)).not.toBeNull();
    clearLocalDraft(key);
    expect(loadLocalDraft(key)).toBeNull();
  });

  test("keys are isolated per deal", () => {
    saveLocalDraft(buildLocalDraftKey({ userId: "u1", dealId: "A" }), makeDraft({
      equipment: [{ kind: "equipment", title: "Alpha", quantity: 1, unitPrice: 1 }],
    }));
    saveLocalDraft(buildLocalDraftKey({ userId: "u1", dealId: "B" }), makeDraft({
      equipment: [{ kind: "equipment", title: "Bravo", quantity: 1, unitPrice: 1 }],
    }));
    expect(loadLocalDraft(buildLocalDraftKey({ userId: "u1", dealId: "A" }))?.equipment?.[0]?.title).toBe("Alpha");
    expect(loadLocalDraft(buildLocalDraftKey({ userId: "u1", dealId: "B" }))?.equipment?.[0]?.title).toBe("Bravo");
  });

  test("one user cannot load another user's draft even on the same deal", () => {
    const aKey = buildLocalDraftKey({ userId: "alice", dealId: "shared" });
    const bKey = buildLocalDraftKey({ userId: "bob", dealId: "shared" });
    saveLocalDraft(aKey, makeDraft({
      equipment: [{ kind: "equipment", title: "Alice's machine", quantity: 1, unitPrice: 1 }],
    }));
    expect(loadLocalDraft(bKey)).toBeNull();
  });

  test("load returns null on corrupt JSON without throwing", () => {
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem("qep.quote-builder.local-draft.u1.deal:bad", "{not-json");
    expect(loadLocalDraft("u1.deal:bad")).toBeNull();
  });

  test("load filters malformed local draft fields before returning them", () => {
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem(
        "qep.quote-builder.local-draft.u1.deal:dirty",
        JSON.stringify({
          draft: {
            entryMode: "not-real",
            customerName: "  Valid Customer  ",
            equipment: [
              { kind: "equipment", title: "Skid Steer", quantity: "2", unitPrice: "45000" },
              { kind: "bad-kind", title: "Bad" },
              { kind: "attachment", title: "" },
            ],
            attachments: [
              { kind: "attachment", title: "Bucket", quantity: "bad", unitPrice: "1200" },
            ],
            tradeAllowance: "5000",
            commercialDiscountType: "bad",
            quoteStatus: "approved",
            recommendation: {
              machine: "CTL",
              attachments: ["Bucket", "", 42],
              reasoning: "Matches site work.",
              trigger: { triggerType: "bad", sourceField: "voice" },
            },
          },
          savedAt: "2026-05-03T12:00:00Z",
        }),
      );

    const loaded = loadLocalDraft("u1.deal:dirty");

    expect(loaded?.entryMode).toBeUndefined();
    expect(loaded?.customerName).toBe("  Valid Customer  ");
    expect(loaded?.equipment).toEqual([
      {
        kind: "equipment",
        title: "Skid Steer",
        id: undefined,
        sourceCatalog: undefined,
        sourceId: null,
        dealerCost: null,
        make: undefined,
        model: undefined,
        costVisibility: "customer",
        year: null,
        quantity: 2,
        unitPrice: 45000,
      },
    ]);
    expect(loaded?.attachments?.[0]?.quantity).toBe(1);
    expect(loaded?.tradeAllowance).toBe(5000);
    expect(loaded?.commercialDiscountType).toBeUndefined();
    expect(loaded?.quoteStatus).toBe("approved");
    expect(loaded?.recommendation?.attachments).toEqual(["Bucket"]);
    expect(loaded?.recommendation?.trigger).toBeNull();
  });
});

describe("listLocalDraftsForUser", () => {
  test("returns only drafts belonging to the requested user, newest first", async () => {
    const oldDraft = makeDraft({ equipment: [{ kind: "equipment", title: "Old", quantity: 1, unitPrice: 1 }] });
    const newDraft = makeDraft({ equipment: [{ kind: "equipment", title: "New", quantity: 1, unitPrice: 1 }] });
    saveLocalDraft(buildLocalDraftKey({ userId: "alice", dealId: "old" }), oldDraft);
    // Nudge timestamps apart so the sort is observable.
    await new Promise((r) => setTimeout(r, 5));
    saveLocalDraft(buildLocalDraftKey({ userId: "alice", dealId: "new" }), newDraft);
    saveLocalDraft(buildLocalDraftKey({ userId: "bob", dealId: "shared" }), makeDraft({
      equipment: [{ kind: "equipment", title: "Bob's", quantity: 1, unitPrice: 1 }],
    }));

    const records = listLocalDraftsForUser("alice");
    expect(records.map((r) => r.dealId)).toEqual(["new", "old"]);
    expect(records.every((r) => r.draft.equipment?.[0]?.title !== "Bob's")).toBe(true);
  });

  test("skips empty drafts", () => {
    saveLocalDraft(buildLocalDraftKey({ userId: "alice", dealId: "empty" }), makeDraft());
    saveLocalDraft(buildLocalDraftKey({ userId: "alice", dealId: "real" }), makeDraft({
      equipment: [{ kind: "equipment", title: "Real", quantity: 1, unitPrice: 1 }],
    }));
    expect(listLocalDraftsForUser("alice")).toHaveLength(1);
  });

  test("skips malformed draft envelopes", () => {
    (globalThis as unknown as { window: { localStorage: MemoryStorage } })
      .window.localStorage.setItem("qep.quote-builder.local-draft.alice.deal:bad", JSON.stringify({ draft: null }));
    saveLocalDraft(buildLocalDraftKey({ userId: "alice", dealId: "real" }), makeDraft({
      equipment: [{ kind: "equipment", title: "Real", quantity: 1, unitPrice: 1 }],
    }));

    expect(listLocalDraftsForUser("alice").map((record) => record.dealId)).toEqual(["real"]);
  });

  test("returns empty list for unknown user", () => {
    saveLocalDraft(buildLocalDraftKey({ userId: "alice", dealId: "x" }), makeDraft({
      equipment: [{ kind: "equipment", title: "A", quantity: 1, unitPrice: 1 }],
    }));
    expect(listLocalDraftsForUser("nobody")).toHaveLength(0);
  });

  test("returns empty list when userId is empty", () => {
    expect(listLocalDraftsForUser("")).toHaveLength(0);
  });
});
