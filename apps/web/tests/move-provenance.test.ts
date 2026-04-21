import { describe, expect, it } from "bun:test";
import {
  ASK_IRON_RECOMMENDER_SLUG,
  classifyMoveProvenance,
  countMovesByProvenance,
  moveMatchesProvenanceFilter,
  PROVENANCE_EXPLAINER,
  PROVENANCE_LABEL,
} from "../src/features/qrm/components/moveProvenance";
import type { QrmMove } from "../src/features/qrm/lib/moves-types";

/**
 * Build a minimal QrmMove shape for tests. We only exercise the classifier,
 * which looks at `recommender`, so everything else is inert filler.
 */
function makeMove(partial: Partial<QrmMove>): QrmMove {
  return {
    id: partial.id ?? "m-1",
    workspace_id: "ws-1",
    kind: partial.kind ?? "call_now",
    status: partial.status ?? "suggested",
    title: partial.title ?? "Test move",
    rationale: null,
    confidence: null,
    priority: 50,
    entity_type: null,
    entity_id: null,
    assigned_rep_id: null,
    draft: null,
    signal_ids: [],
    due_at: null,
    snoozed_until: null,
    accepted_at: null,
    completed_at: null,
    dismissed_at: null,
    dismissed_reason: null,
    recommender: partial.recommender ?? null,
    recommender_version: partial.recommender_version ?? null,
    payload: {},
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
  };
}

describe("classifyMoveProvenance", () => {
  it("treats null recommender as manual (operator-authored)", () => {
    expect(classifyMoveProvenance(makeMove({ recommender: null }))).toBe(
      "manual",
    );
  });

  it("treats empty string recommender as manual", () => {
    // Defensive — an older migration might have left a blank string instead
    // of a proper null. We classify both as manual to avoid a phantom
    // "Recommender" badge on hand-created moves.
    expect(classifyMoveProvenance(makeMove({ recommender: "" }))).toBe(
      "manual",
    );
  });

  it("classifies ask_iron stamps as iron", () => {
    expect(
      classifyMoveProvenance(
        makeMove({ recommender: ASK_IRON_RECOMMENDER_SLUG }),
      ),
    ).toBe("iron");
  });

  it("classifies any other non-null recommender as recommender", () => {
    expect(
      classifyMoveProvenance(makeMove({ recommender: "qrm_rule_v1" })),
    ).toBe("recommender");
    expect(
      classifyMoveProvenance(makeMove({ recommender: "future_v2" })),
    ).toBe("recommender");
  });

  it("is case-sensitive on ask_iron (prevents typo-style bypass)", () => {
    // The server stamps the slug in lowercase. A capitalized variant should
    // NOT be treated as Iron — better to badge it as "Recommender" and
    // debug the source than silently mask a provenance bug.
    expect(
      classifyMoveProvenance(makeMove({ recommender: "Ask_Iron" })),
    ).toBe("recommender");
  });
});

describe("PROVENANCE_LABEL + PROVENANCE_EXPLAINER", () => {
  it("exports a label and explainer for every provenance kind", () => {
    for (const kind of ["iron", "recommender", "manual"] as const) {
      expect(PROVENANCE_LABEL[kind].length).toBeGreaterThan(0);
      expect(PROVENANCE_EXPLAINER[kind].length).toBeGreaterThan(0);
    }
  });

  it("uses distinct labels (operators can tell them apart)", () => {
    const labels = new Set(Object.values(PROVENANCE_LABEL));
    expect(labels.size).toBe(3);
  });
});

describe("moveMatchesProvenanceFilter", () => {
  const ironMove = makeMove({ recommender: ASK_IRON_RECOMMENDER_SLUG });
  const recMove = makeMove({ recommender: "qrm_rule_v1" });
  const manualMove = makeMove({ recommender: null });

  it("'all' passes every move through", () => {
    expect(moveMatchesProvenanceFilter(ironMove, "all")).toBe(true);
    expect(moveMatchesProvenanceFilter(recMove, "all")).toBe(true);
    expect(moveMatchesProvenanceFilter(manualMove, "all")).toBe(true);
  });

  it("filters to the matching kind only", () => {
    expect(moveMatchesProvenanceFilter(ironMove, "iron")).toBe(true);
    expect(moveMatchesProvenanceFilter(recMove, "iron")).toBe(false);
    expect(moveMatchesProvenanceFilter(manualMove, "iron")).toBe(false);

    expect(moveMatchesProvenanceFilter(ironMove, "recommender")).toBe(false);
    expect(moveMatchesProvenanceFilter(recMove, "recommender")).toBe(true);
    expect(moveMatchesProvenanceFilter(manualMove, "recommender")).toBe(false);

    expect(moveMatchesProvenanceFilter(ironMove, "manual")).toBe(false);
    expect(moveMatchesProvenanceFilter(recMove, "manual")).toBe(false);
    expect(moveMatchesProvenanceFilter(manualMove, "manual")).toBe(true);
  });
});

describe("countMovesByProvenance", () => {
  it("returns zero-filled counts for an empty list", () => {
    expect(countMovesByProvenance([])).toEqual({
      iron: 0,
      recommender: 0,
      manual: 0,
    });
  });

  it("sums each kind independently", () => {
    const moves = [
      makeMove({ recommender: ASK_IRON_RECOMMENDER_SLUG }),
      makeMove({ recommender: ASK_IRON_RECOMMENDER_SLUG }),
      makeMove({ recommender: "qrm_rule_v1" }),
      makeMove({ recommender: null }),
      makeMove({ recommender: null }),
      makeMove({ recommender: null }),
    ];
    expect(countMovesByProvenance(moves)).toEqual({
      iron: 2,
      recommender: 1,
      manual: 3,
    });
  });
});
