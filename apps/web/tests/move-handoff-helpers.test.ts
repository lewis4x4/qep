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

  // Slice 19 — synthesizer tool-naming per entity type. Mirrors Slice 17
  // (Graph) and Slice 18 (Pulse): when a move is scoped to a deal /
  // company / contact, the closer should name the dedicated synthesizer
  // tool explicitly so Iron reaches for the bundled read instead of
  // chaining get_*_detail + list_recent_signals.
  it("names summarize_deal when the move is scoped to a deal", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "deal", entity_id: "d-1" }),
    );
    expect(p).toContain("summarize_deal");
  });

  it("names summarize_company when the move is scoped to a company", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "company", entity_id: "co-1" }),
    );
    expect(p).toContain("summarize_company");
  });

  it("names summarize_contact when the move is scoped to a contact", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "contact", entity_id: "c-1" }),
    );
    expect(p).toContain("summarize_contact");
  });

  // Slice 22: the generic-closer path now requires BOTH "no entity
  // synthesizer" AND "no signal trail". When signal_ids is non-empty
  // the summarize_signal-only closer fires instead (covered by its
  // own Slice 22 tests below). These tests use signal_ids: [] so the
  // prompt actually reaches the generic closer.
  it("keeps the generic closer for equipment (no synthesizer yet)", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "equipment", entity_id: "eq-1", signal_ids: [] }),
    );
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).not.toContain("summarize_signal");
    expect(p).toContain("Use the detail + signal tools");
  });

  it("keeps the generic closer for rental (no synthesizer yet)", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "rental", entity_id: "r-1", signal_ids: [] }),
    );
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).not.toContain("summarize_signal");
    expect(p).toContain("Use the detail + signal tools");
  });

  it("keeps the generic closer for activity-scoped moves", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "activity", entity_id: "a-1", signal_ids: [] }),
    );
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).not.toContain("summarize_signal");
    expect(p).toContain("Use the detail + signal tools");
  });

  it("keeps the generic closer for workspace-scoped moves", () => {
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "workspace", entity_id: "ws-1", signal_ids: [] }),
    );
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).not.toContain("summarize_signal");
    expect(p).toContain("Use the detail + signal tools");
  });

  it("omits the synthesizer hint when entity_id is missing even with entity_type set", () => {
    // A named tool requires an id to be useful. If the move has a type
    // but no id, drop the hint — Iron should fall back to search_entities.
    const p = formatIronMovePrompt(
      makeMove({ entity_type: "deal", entity_id: null }),
    );
    expect(p).not.toContain("summarize_deal");
  });

  it("still closes with propose_move across every entity type", () => {
    for (
      const type of [
        "deal",
        "company",
        "contact",
        "equipment",
        "rental",
        "workspace",
        "activity",
      ] as const
    ) {
      const p = formatIronMovePrompt(
        makeMove({ entity_type: type, entity_id: "x-1" }),
      );
      expect(p).toContain("propose_move");
    }
  });

  it("still closes with propose_move across every move kind", () => {
    const kinds: QrmMoveKind[] = [
      "call_now",
      "send_quote",
      "send_follow_up",
      "send_proposal",
      "schedule_meeting",
      "escalate",
      "drop_deal",
      "reassign",
      "field_visit",
      "pricing_review",
      "inventory_reserve",
      "service_escalate",
      "rescue_offer",
      "other",
    ];
    for (const kind of kinds) {
      const p = formatIronMovePrompt(makeMove({ kind }));
      expect(p).toContain("propose_move");
    }
  });

  // Slice 22 — the move handoff now names summarize_signal (Slice 20)
  // when the move carries a signal_ids trail. The trigger signal is
  // the most direct answer to "why was this move queued?" — bundled
  // with its parent entity and related events in one tool call.
  it("names summarize_signal with the first signal id when signal_ids has entries", () => {
    const p = formatIronMovePrompt(
      makeMove({ signal_ids: ["sig-trigger-1", "sig-trigger-2"] }),
    );
    expect(p).toContain("summarize_signal");
    expect(p).toContain('signal_id "sig-trigger-1"');
  });

  it("names summarize_signal even when signal_ids has a single entry", () => {
    const p = formatIronMovePrompt(
      makeMove({ signal_ids: ["only-signal"] }),
    );
    expect(p).toContain("summarize_signal");
    expect(p).toContain('signal_id "only-signal"');
  });

  it("omits summarize_signal when signal_ids is empty", () => {
    const p = formatIronMovePrompt(makeMove({ signal_ids: [] }));
    expect(p).not.toContain("summarize_signal");
  });

  it("mentions the first signal id in the trail line when signal_ids is present", () => {
    // Gives the operator (and Iron) a visible breadcrumb to the
    // trigger event even before the closer.
    const p = formatIronMovePrompt(
      makeMove({ signal_ids: ["sig-xyz"] }),
    );
    expect(p).toContain("first: sig-xyz");
  });

  it("still emits the entity-synthesizer hint alongside summarize_signal when both apply", () => {
    // summarize_signal bundles the parent entity row, but not the
    // parent's recent activities or open-deal list. The entity
    // synthesizer (summarize_deal/company/contact) covers that
    // broader context — keep both so Iron can pick either.
    const p = formatIronMovePrompt(
      makeMove({
        entity_type: "deal",
        entity_id: "d-1",
        signal_ids: ["sig-1"],
      }),
    );
    expect(p).toContain("summarize_signal");
    expect(p).toContain("summarize_deal");
  });

  it("emits only summarize_signal when move has signal_ids but no entity synthesizer", () => {
    // Equipment/rental/activity/workspace have no entity synthesizer;
    // the signal synthesizer still stands on its own.
    const p = formatIronMovePrompt(
      makeMove({
        entity_type: "equipment",
        entity_id: "eq-1",
        signal_ids: ["sig-1"],
      }),
    );
    expect(p).toContain("summarize_signal");
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).toContain("propose_move");
  });

  it("closes with propose_move when only summarize_signal is named", () => {
    // Entity synthesizer missing, signal synthesizer present — the
    // closer must still invite propose_move (regression guard for the
    // else-if branch of the closer logic).
    const p = formatIronMovePrompt(
      makeMove({
        entity_type: null,
        entity_id: null,
        signal_ids: ["sig-1"],
      }),
    );
    expect(p).toContain("summarize_signal");
    expect(p).toContain("propose_move");
  });
});
