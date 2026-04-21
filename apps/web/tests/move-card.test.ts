import { describe, expect, it } from "bun:test";
import {
  acceptLabelForKind,
  hrefForMoveEntity,
} from "../src/features/qrm/components/moveCardHelpers";
import type { QrmMove } from "../src/features/qrm/lib/moves-types";

function makeMove(overrides: Partial<QrmMove> = {}): QrmMove {
  return {
    id: "m-1",
    workspace_id: "ws-1",
    kind: "call_now",
    status: "suggested",
    title: "Call Acme about CAT 305",
    rationale: "Inbound query 20m ago",
    confidence: 0.85,
    priority: 92,
    entity_type: "deal",
    entity_id: "d-1",
    assigned_rep_id: "rep-1",
    draft: null,
    signal_ids: [],
    due_at: null,
    snoozed_until: null,
    accepted_at: null,
    completed_at: null,
    dismissed_at: null,
    dismissed_reason: null,
    recommender: "deterministic",
    recommender_version: "deterministic-v1",
    payload: {},
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

describe("hrefForMoveEntity", () => {
  it("routes deal moves to /qrm/deals/:id", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "deal", entity_id: "d-1" })))
      .toBe("/qrm/deals/d-1");
  });

  it("routes contact moves to /qrm/contacts/:id", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "contact", entity_id: "c-1" })))
      .toBe("/qrm/contacts/c-1");
  });

  it("routes company moves to the account command center (Track 7A default drill-down)", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "company", entity_id: "co-1" })))
      .toBe("/qrm/accounts/co-1/command");
  });

  it("routes equipment moves to inventory-pressure query param", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "equipment", entity_id: "e-1" })))
      .toBe("/qrm/inventory-pressure?equipment=e-1");
  });

  it("routes rental moves to rentals query param", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "rental", entity_id: "r-1" })))
      .toBe("/qrm/rentals?request=r-1");
  });

  it("routes activity moves to /qrm/activities/:id", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "activity", entity_id: "a-1" })))
      .toBe("/qrm/activities/a-1");
  });

  it("returns null when entity_type is null", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: null, entity_id: "x" }))).toBeNull();
  });

  it("returns null when entity_id is null", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "deal", entity_id: null }))).toBeNull();
  });

  it("returns null for unroutable entity types like workspace", () => {
    expect(hrefForMoveEntity(makeMove({ entity_type: "workspace", entity_id: "w-1" })))
      .toBeNull();
  });
});

describe("acceptLabelForKind", () => {
  it("uses I'll call for call_now", () => {
    expect(acceptLabelForKind("call_now")).toBe("I'll call");
  });

  it("uses I'll quote for both send_quote and send_proposal", () => {
    expect(acceptLabelForKind("send_quote")).toBe("I'll quote");
    expect(acceptLabelForKind("send_proposal")).toBe("I'll quote");
  });

  it("uses I'll follow up for send_follow_up", () => {
    expect(acceptLabelForKind("send_follow_up")).toBe("I'll follow up");
  });

  it("uses I'll schedule for schedule_meeting", () => {
    expect(acceptLabelForKind("schedule_meeting")).toBe("I'll schedule");
  });

  it("uses I'll escalate for escalate", () => {
    expect(acceptLabelForKind("escalate")).toBe("I'll escalate");
  });

  it("uses I'll go onsite for field_visit", () => {
    expect(acceptLabelForKind("field_visit")).toBe("I'll go onsite");
  });

  it("uses I'll rescue for rescue_offer", () => {
    expect(acceptLabelForKind("rescue_offer")).toBe("I'll rescue");
  });

  it("uses I'll loop in service for service_escalate", () => {
    expect(acceptLabelForKind("service_escalate")).toBe("I'll loop in service");
  });

  it("defaults to Accept for the catch-all other kind", () => {
    expect(acceptLabelForKind("other")).toBe("Accept");
  });
});
