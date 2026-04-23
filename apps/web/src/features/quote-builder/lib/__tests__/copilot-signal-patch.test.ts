import { describe, expect, test } from "bun:test";
import {
  applyPatch,
  translateSignalsToPatch,
} from "../copilot-signal-patch";
import type {
  CopilotExtractedSignals,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

// ── Fixtures ─────────────────────────────────────────────────────────────

function priorSignals(
  over: Partial<NonNullable<QuoteWorkspaceDraft["customerSignals"]>> = {},
): NonNullable<QuoteWorkspaceDraft["customerSignals"]> {
  return {
    openDeals: 2,
    openDealValueCents: 50_000_00,
    lastContactDaysAgo: 10,
    pastQuoteCount: 3,
    pastQuoteValueCents: 120_000_00,
    ...over,
  };
}

function priorDraft(
  over: Partial<QuoteWorkspaceDraft> = {},
): Partial<QuoteWorkspaceDraft> {
  return {
    entryMode: "manual",
    branchSlug: "",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    customerSignals: priorSignals(),
    ...over,
  };
}

// ── translateSignalsToPatch: no-op paths ─────────────────────────────────

describe("translateSignalsToPatch — no-op paths", () => {
  test("empty signals → isNoOp true, empty patch", () => {
    const r = translateSignalsToPatch(priorDraft(), {});
    expect(r.isNoOp).toBe(true);
    expect(r.patch).toEqual({});
    expect(r.changedPaths).toEqual([]);
  });

  test("notes-only signals → isNoOp true (notes don't touch draft)", () => {
    const r = translateSignalsToPatch(priorDraft(), { notes: ["rep wants a callback"] });
    expect(r.isNoOp).toBe(true);
    expect(r.patch).toEqual({});
  });

  test("signal that matches prior exactly → no changed paths", () => {
    const prior = priorDraft({ financingPref: "cash" });
    const r = translateSignalsToPatch(prior, { financingPref: "cash" });
    expect(r.isNoOp).toBe(true);
    expect(r.patch.financingPref).toBeUndefined();
  });
});

// ── objections: merge + dedupe ───────────────────────────────────────────

describe("translateSignalsToPatch — objections", () => {
  test("first objection logged from empty prior", () => {
    const prior = priorDraft();
    const r = translateSignalsToPatch(prior, {
      customerSignals: { objections: ["price too high"] },
    });
    expect(r.changedPaths).toContain("customerSignals.objections");
    expect(r.patch.customerSignals?.objections).toEqual(["price too high"]);
  });

  test("merges with prior objections", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ objections: ["price too high"] }),
    });
    const r = translateSignalsToPatch(prior, {
      customerSignals: { objections: ["needs CEO approval"] },
    });
    expect(r.patch.customerSignals?.objections).toEqual([
      "price too high",
      "needs CEO approval",
    ]);
  });

  test("dedupes exact-match objections", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ objections: ["price too high"] }),
    });
    const r = translateSignalsToPatch(prior, {
      customerSignals: { objections: ["price too high"] },
    });
    expect(r.isNoOp).toBe(true);
  });

  test("trims whitespace and skips empty strings", () => {
    const prior = priorDraft();
    const r = translateSignalsToPatch(prior, {
      customerSignals: { objections: ["  needs approval  ", "", "   "] },
    });
    expect(r.patch.customerSignals?.objections).toEqual(["needs approval"]);
  });

  test("preserves prior CRM-sourced numerics when only objections change", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ pastQuoteCount: 7, openDeals: 4 }),
    });
    const r = translateSignalsToPatch(prior, {
      customerSignals: { objections: ["spec concerns"] },
    });
    expect(r.patch.customerSignals?.pastQuoteCount).toBe(7);
    expect(r.patch.customerSignals?.openDeals).toBe(4);
  });
});

// ── competitorMentions: case-insensitive dedupe ──────────────────────────

describe("translateSignalsToPatch — competitorMentions", () => {
  test("dedupes case-insensitively, preserves first casing", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ competitorMentions: ["Acme Rental"] }),
    });
    const r = translateSignalsToPatch(prior, {
      customerSignals: { competitorMentions: ["acme rental", "United Rentals"] },
    });
    expect(r.patch.customerSignals?.competitorMentions).toEqual([
      "Acme Rental",
      "United Rentals",
    ]);
  });

  test("brand-new competitor list is applied", () => {
    const prior = priorDraft();
    const r = translateSignalsToPatch(prior, {
      customerSignals: { competitorMentions: ["JCB", "Bobcat"] },
    });
    expect(r.changedPaths).toContain("customerSignals.competitorMentions");
    expect(r.patch.customerSignals?.competitorMentions).toEqual(["JCB", "Bobcat"]);
  });
});

// ── timelinePressure: replace semantics ──────────────────────────────────

describe("translateSignalsToPatch — timelinePressure", () => {
  test("replaces prior value", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ timelinePressure: "months" }),
    });
    const r = translateSignalsToPatch(prior, {
      customerSignals: { timelinePressure: "immediate" },
    });
    expect(r.changedPaths).toContain("customerSignals.timelinePressure");
    expect(r.patch.customerSignals?.timelinePressure).toBe("immediate");
  });

  test("explicit null clears prior value", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ timelinePressure: "immediate" }),
    });
    const r = translateSignalsToPatch(prior, {
      customerSignals: { timelinePressure: null },
    });
    expect(r.patch.customerSignals?.timelinePressure).toBe(null);
  });

  test("undefined in signals → factor omitted entirely", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ timelinePressure: "weeks" }),
    });
    // Signal object with customerSignals present but timelinePressure absent.
    const r = translateSignalsToPatch(prior, {
      customerSignals: { objections: ["new concern"] },
    });
    // timelinePressure path not in changedPaths
    expect(r.changedPaths).not.toContain("customerSignals.timelinePressure");
  });
});

// ── financingPref / customerWarmth: replace semantics ────────────────────

describe("translateSignalsToPatch — financingPref + customerWarmth", () => {
  test("financingPref replace", () => {
    const prior = priorDraft({ financingPref: null });
    const r = translateSignalsToPatch(prior, { financingPref: "cash" });
    expect(r.changedPaths).toContain("financingPref");
    expect(r.patch.financingPref).toBe("cash");
  });

  test("financingPref contradiction flip (cash → financing)", () => {
    const prior = priorDraft({ financingPref: "cash" });
    const r = translateSignalsToPatch(prior, { financingPref: "financing" });
    expect(r.patch.financingPref).toBe("financing");
  });

  test("customerWarmth re-rate", () => {
    const prior = priorDraft({ customerWarmth: "warm" });
    const r = translateSignalsToPatch(prior, { customerWarmth: "cool" });
    expect(r.changedPaths).toContain("customerWarmth");
    expect(r.patch.customerWarmth).toBe("cool");
  });
});

// ── Adversarial input defense ────────────────────────────────────────────

describe("translateSignalsToPatch — adversarial defense", () => {
  test("unknown top-level keys are silently ignored", () => {
    const prior = priorDraft();
    // Pretend Claude returned a forbidden field despite the schema.
    const adversarial = {
      financingPref: "cash",
      // @ts-expect-error — intentionally off-schema; must be ignored.
      winProbabilityScore: 95,
      // @ts-expect-error — off-schema; must be ignored.
      status: "accepted",
    } satisfies Record<string, unknown> as CopilotExtractedSignals;
    const r = translateSignalsToPatch(prior, adversarial);
    // Only the schema-valid field lands in the patch.
    expect(r.changedPaths).toEqual(["financingPref"]);
    expect(Object.keys(r.patch)).toEqual(["financingPref"]);
  });

  test("unknown customerSignals sub-fields are ignored", () => {
    const prior = priorDraft();
    const adversarial = {
      customerSignals: {
        objections: ["real concern"],
        // @ts-expect-error — off-schema; must be ignored.
        pastQuoteCount: 999,
      },
    } satisfies Record<string, unknown> as CopilotExtractedSignals;
    const r = translateSignalsToPatch(prior, adversarial);
    // pastQuoteCount from prior is preserved; adversarial 999 is NOT.
    // priorSignals() defaults pastQuoteCount to 3.
    expect(r.patch.customerSignals?.pastQuoteCount).toBe(3);
    expect(r.patch.customerSignals?.objections).toEqual(["real concern"]);
  });
});

// ── applyPatch ───────────────────────────────────────────────────────────

describe("applyPatch", () => {
  test("returns a new object (never mutates input)", () => {
    const prior = priorDraft();
    const patch = { financingPref: "cash" as const };
    const next = applyPatch(prior, patch);
    expect(next).not.toBe(prior);
    expect(prior.financingPref).toBeUndefined();
    expect(next.financingPref).toBe("cash");
  });

  test("shallow-merges customerSignals, preserving CRM fields", () => {
    const prior = priorDraft({
      customerSignals: priorSignals({ pastQuoteCount: 5, openDeals: 3 }),
    });
    const patch = {
      customerSignals: {
        ...prior.customerSignals!,
        objections: ["budget"],
      },
    };
    const next = applyPatch(prior, patch);
    expect(next.customerSignals?.pastQuoteCount).toBe(5);
    expect(next.customerSignals?.openDeals).toBe(3);
    expect(next.customerSignals?.objections).toEqual(["budget"]);
  });

  test("explicit null customerSignals clears the field", () => {
    const prior = priorDraft();
    const next = applyPatch(prior, { customerSignals: null });
    expect(next.customerSignals).toBe(null);
  });

  test("customerWarmth and financingPref are independently replaceable", () => {
    const prior = priorDraft({ customerWarmth: "warm", financingPref: "cash" });
    const next = applyPatch(prior, { financingPref: "financing" });
    expect(next.customerWarmth).toBe("warm"); // untouched
    expect(next.financingPref).toBe("financing"); // replaced
  });
});
