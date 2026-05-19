import { describe, expect, test } from "bun:test";
import {
  pickPhase2AutoAttach,
  resolveCustomerBlockBranch,
} from "./customer-block-state";
import type { CustomerMatchResult } from "./voice-customer-matcher";
import type { RepCustomer } from "./types";

function repCustomer(name: string, id: string): RepCustomer {
  return {
    customer_id: id,
    company_name: name,
    search_1: null,
    search_2: null,
    primary_contact_name: null,
    primary_contact_phone: null,
    primary_contact_email: null,
    city: null,
    state: null,
    open_deals: 0,
    active_quotes: 0,
    last_interaction: null,
    days_since_contact: null,
    opportunity_score: 0,
    equipment_summary: [],
  };
}

function matchResult(opts: {
  top?: RepCustomer | null;
  alternates?: RepCustomer[];
  confidence?: number;
}): CustomerMatchResult {
  return {
    top: opts.top ?? null,
    confidence: opts.confidence ?? 0.4,
    reasoning: "",
    signals: [],
    alternates: (opts.alternates ?? []).map((customer) => ({
      customer,
      score: 1,
      signals: [],
    })),
  };
}

describe("resolveCustomerBlockBranch", () => {
  test("phase2_auto_attach wins when autoAttachedSimilarity is non-null and a customer is selected", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: { id: "c1", name: "Lewis Tree" },
      autoAttachedSimilarity: 0.92,
      workspaceCandidates: [],
      matchResult: null,
    });
    expect(branch).toBe("phase2_auto_attach");
  });

  test("selected branch when a customer is attached and no phase2 marker", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: { id: "c1", name: "Lewis Tree" },
      autoAttachedSimilarity: null,
      workspaceCandidates: [],
      matchResult: matchResult({ confidence: 0.9 }),
    });
    expect(branch).toBe("selected");
  });

  test("workspace_candidates when nothing selected but workspace search returned results", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: null,
      autoAttachedSimilarity: null,
      workspaceCandidates: [repCustomer("Lewis Tree Service", "c1")],
      matchResult: matchResult({}),
    });
    expect(branch).toBe("workspace_candidates");
  });

  test("book_alternates when match has top but no workspace candidates", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: null,
      autoAttachedSimilarity: null,
      workspaceCandidates: [],
      matchResult: matchResult({ top: repCustomer("Beacon Ridge", "c1"), confidence: 0.55 }),
    });
    expect(branch).toBe("book_alternates");
  });

  test("book_alternates when match has alternates but no top", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: null,
      autoAttachedSimilarity: null,
      workspaceCandidates: [],
      matchResult: matchResult({ alternates: [repCustomer("Beacon Ridge", "c1")] }),
    });
    expect(branch).toBe("book_alternates");
  });

  test("empty when nothing detected anywhere", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: null,
      autoAttachedSimilarity: null,
      workspaceCandidates: [],
      matchResult: matchResult({}),
    });
    expect(branch).toBe("empty");
  });

  test("empty when matchResult is null", () => {
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: null,
      autoAttachedSimilarity: null,
      workspaceCandidates: [],
      matchResult: null,
    });
    expect(branch).toBe("empty");
  });

  test("autoAttachedSimilarity without selectedCustomer falls back to lower branches", () => {
    // Defensive: if state somehow desyncs (similarity set but customer cleared),
    // we should not render the phase2 card with no customer to show.
    const branch = resolveCustomerBlockBranch({
      selectedCustomer: null,
      autoAttachedSimilarity: 0.92,
      workspaceCandidates: [repCustomer("Lewis Tree", "c1")],
      matchResult: null,
    });
    expect(branch).toBe("workspace_candidates");
  });
});

describe("pickPhase2AutoAttach", () => {
  const lewis = repCustomer("Lewis Tree Service", "c1");
  const holdings = repCustomer("Lewis Holdings LLC", "c2");
  const sons = repCustomer("Lewis & Sons", "c3");

  test("returns null when semanticMap is empty", () => {
    const result = pickPhase2AutoAttach([lewis], new Map(), 0.9);
    expect(result).toBeNull();
  });

  test("returns null when semanticMap is null", () => {
    const result = pickPhase2AutoAttach([lewis], null, 0.9);
    expect(result).toBeNull();
  });

  test("returns null when workspaceCandidates is empty", () => {
    const result = pickPhase2AutoAttach(
      [],
      new Map([["c1", 0.95]]),
      0.9,
    );
    expect(result).toBeNull();
  });

  test("returns null when no candidate clears the threshold", () => {
    const result = pickPhase2AutoAttach(
      [lewis, holdings],
      new Map([
        ["c1", 0.85],
        ["c2", 0.7],
      ]),
      0.9,
    );
    expect(result).toBeNull();
  });

  test("returns the candidate above threshold", () => {
    const result = pickPhase2AutoAttach(
      [lewis],
      new Map([["c1", 0.92]]),
      0.9,
    );
    expect(result?.customer.customer_id).toBe("c1");
    expect(result?.similarity).toBe(0.92);
  });

  test("picks the highest-similarity candidate when multiple clear the threshold", () => {
    const result = pickPhase2AutoAttach(
      [lewis, holdings, sons],
      new Map([
        ["c1", 0.91],
        ["c2", 0.97],
        ["c3", 0.93],
      ]),
      0.9,
    );
    expect(result?.customer.customer_id).toBe("c2");
    expect(result?.similarity).toBe(0.97);
  });

  test("ignores candidates not present in the semantic map", () => {
    const result = pickPhase2AutoAttach(
      [lewis, holdings],
      new Map([["c2", 0.95]]),
      0.9,
    );
    expect(result?.customer.customer_id).toBe("c2");
  });

  test("threshold of exactly 0.9 admits a 0.9 score", () => {
    const result = pickPhase2AutoAttach(
      [lewis],
      new Map([["c1", 0.9]]),
      0.9,
    );
    expect(result?.customer.customer_id).toBe("c1");
  });

  test("default threshold is 0.9", () => {
    const below = pickPhase2AutoAttach([lewis], new Map([["c1", 0.89]]));
    const above = pickPhase2AutoAttach([lewis], new Map([["c1", 0.91]]));
    expect(below).toBeNull();
    expect(above?.customer.customer_id).toBe("c1");
  });
});
