/**
 * Bun tests for the Slice 12 Today → Ask Iron per-move handoff.
 *
 * These tests lock in the prompt shape per move kind so Iron's tool
 * selection stays stable when the helper is refactored. The formatter is
 * the only thing the seeded conversation ever sees — regressions here
 * land as quality bugs on the Today surface.
 */

import { describe, expect, it } from "bun:test";
import {
  formatIronMovePrompt,
  labelForMoveKind,
  openerForMoveKind,
} from "../src/features/qrm/components/moveHandoffHelpers";
import type { QrmMove, QrmMoveKind } from "../src/features/qrm/lib/moves-types";

function makeMove(overrides: Partial<QrmMove> = {}): QrmMove {
  return {
    id: "m-1",
    workspace_id: "w-1",
    kind: "call_now",
    status: "suggested",
    title: "Call Acme buyer back",
    rationale: "Buyer opened quote twice in 3 days and hasn't responded.",
    confidence: 0.72,
    priority: 74,
    entity_type: "deal",
    entity_id: "d-42",
    assigned_rep_id: "u-1",
    draft: null,
    signal_ids: ["s-1", "s-2"],
    due_at: null,
    snoozed_until: null,
    accepted_at: null,
    completed_at: null,
    dismissed_at: null,
    dismissed_reason: null,
    recommender: "recommender-v1",
    recommender_version: "2026.04.01",
    payload: {},
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-20T10:00:00Z",
    ...overrides,
  };
}

describe("labelForMoveKind", () => {
  it("returns operator-recognizable nouns for each move kind", () => {
    expect(labelForMoveKind("call_now")).toBe("call");
    expect(labelForMoveKind("send_quote")).toBe("quote");
    expect(labelForMoveKind("send_follow_up")).toBe("follow-up");
    expect(labelForMoveKind("send_proposal")).toBe("proposal");
    expect(labelForMoveKind("schedule_meeting")).toBe("meeting");
    expect(labelForMoveKind("escalate")).toBe("escalation");
    expect(labelForMoveKind("drop_deal")).toBe("drop");
    expect(labelForMoveKind("reassign")).toBe("reassignment");
    expect(labelForMoveKind("field_visit")).toBe("field visit");
    expect(labelForMoveKind("pricing_review")).toBe("pricing review");
    expect(labelForMoveKind("inventory_reserve")).toBe("inventory reserve");
    expect(labelForMoveKind("service_escalate")).toBe("service escalation");
    expect(labelForMoveKind("rescue_offer")).toBe("rescue offer");
    expect(labelForMoveKind("other")).toBe("move");
  });
});

describe("openerForMoveKind", () => {
  it("groups outreach kinds under a 'brief me before I run this' opener", () => {
    const kinds: QrmMoveKind[] = [
      "call_now",
      "send_quote",
      "send_follow_up",
      "send_proposal",
      "schedule_meeting",
    ];
    for (const kind of kinds) {
      expect(openerForMoveKind(kind).startsWith("Brief me before I run this move"))
        .toBe(true);
    }
  });

  it("groups escalation kinds under a 'why urgent' opener", () => {
    const kinds: QrmMoveKind[] = [
      "escalate",
      "pricing_review",
      "rescue_offer",
      "service_escalate",
    ];
    for (const kind of kinds) {
      expect(openerForMoveKind(kind).startsWith("Walk me through why this move is urgent"))
        .toBe(true);
    }
  });

  it("groups hygiene kinds under a 'make the case' opener", () => {
    const kinds: QrmMoveKind[] = ["drop_deal", "reassign"];
    for (const kind of kinds) {
      expect(openerForMoveKind(kind).startsWith("Make the case for this move"))
        .toBe(true);
    }
  });

  it("groups iron-ops kinds under a 'brief me on this work' opener", () => {
    const kinds: QrmMoveKind[] = ["field_visit", "inventory_reserve"];
    for (const kind of kinds) {
      expect(openerForMoveKind(kind).startsWith("Brief me on this work"))
        .toBe(true);
    }
  });

  it("falls back to a 'brief me on this move' opener for 'other'", () => {
    expect(openerForMoveKind("other").startsWith("Brief me on this move"))
      .toBe(true);
  });
});

describe("formatIronMovePrompt", () => {
  it("leads with the opener tuned to the move's kind", () => {
    const p = formatIronMovePrompt(makeMove({ kind: "escalate" }));
    expect(p.startsWith("Walk me through why this move is urgent")).toBe(true);
  });

  it("includes the kind label + title + priority on the first bullet", () => {
    const p = formatIronMovePrompt(
      makeMove({ kind: "send_quote", title: "Send Acme #7 pricing", priority: 61 }),
    );
    expect(p).toContain("• quote: Send Acme #7 pricing (priority 61)");
  });

  it("falls back to '(untitled move)' when the title is whitespace", () => {
    const p = formatIronMovePrompt(makeMove({ title: "   " }));
    expect(p).toContain("(untitled move)");
  });

  it("includes rationale as a Rationale bullet when present", () => {
    const p = formatIronMovePrompt(
      makeMove({ rationale: "Buyer viewed quote twice." }),
    );
    expect(p).toContain("• Rationale: Buyer viewed quote twice.");
  });

  it("collapses whitespace inside rationale", () => {
    const p = formatIronMovePrompt(
      makeMove({ rationale: "Buyer   viewed\n\n quote twice." }),
    );
    expect(p).toContain("• Rationale: Buyer viewed quote twice.");
  });

  it("caps long rationale at 240 chars with an ellipsis", () => {
    const long = "y".repeat(400);
    const p = formatIronMovePrompt(makeMove({ rationale: long }));
    expect(p).toContain("…");
    expect(p).not.toContain("y".repeat(260));
  });

  it("omits Rationale line when rationale is null", () => {
    const p = formatIronMovePrompt(makeMove({ rationale: null }));
    expect(p).not.toContain("• Rationale:");
  });

  it("omits Rationale line when rationale is whitespace-only", () => {
    const p = formatIronMovePrompt(makeMove({ rationale: "   \n\t  " }));
    expect(p).not.toContain("• Rationale:");
  });

  it("includes entity scope hint when entity_type + entity_id are set", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "deal", entity_id: "d-99" }),
    );
    expect(p).toContain("• Entity: deal (d-99)");
  });

  it("omits entity hint when entity_type is null", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: null, entity_id: null }),
    );
    expect(p).not.toContain("• Entity:");
  });

  it("mentions the signal trail when signal_ids has entries", () => {
    const p = formatIronMovePrompt(
      makeMove({ signal_ids: ["s-1", "s-2", "s-3"] }),
    );
    expect(p).toContain("• Triggered by 3 signals");
  });

  it("uses singular 'signal' when signal_ids has exactly one entry", () => {
    const p = formatIronMovePrompt(makeMove({ signal_ids: ["s-1"] }));
    expect(p).toContain("• Triggered by 1 signal");
    expect(p).not.toContain("1 signals");
  });

  it("omits the signal-trail line when signal_ids is empty", () => {
    const p = formatIronMovePrompt(makeMove({ signal_ids: [] }));
    expect(p).not.toContain("Triggered by");
  });

  it("closes with an explicit propose_move invitation", () => {
    const p = formatIronMovePrompt(makeMove());
    expect(p).toContain("propose_move");
  });

  it("produces a multi-line string joined by newlines", () => {
    const p = formatIronMovePrompt(makeMove());
    // opener + kind bullet + rationale + entity + signals + closer = 6 lines
    // minimum when all fields are present (as in makeMove defaults)
    expect(p.split("\n").length).toBeGreaterThanOrEqual(6);
  });

  it("produces a shorter output when rationale is absent", () => {
    const with_ = formatIronMovePrompt(makeMove({ rationale: "a reason" }));
    const without = formatIronMovePrompt(makeMove({ rationale: null }));
    expect(without.length).toBeLessThan(with_.length);
  });

  it("uses the 'make the case' opener for drop_deal moves", () => {
    const p = formatIronMovePrompt(makeMove({ kind: "drop_deal" }));
    expect(p.startsWith("Make the case for this move")).toBe(true);
  });

  it("uses the 'brief me on this work' opener for inventory_reserve moves", () => {
    const p = formatIronMovePrompt(makeMove({ kind: "inventory_reserve" }));
    expect(p.startsWith("Brief me on this work")).toBe(true);
  });

  it("maps 'other' kind to 'move' in the bullet label", () => {
    const p = formatIronMovePrompt(makeMove({ kind: "other", title: "ad-hoc" }));
    expect(p).toContain("• move: ad-hoc");
  });
});
