import { describe, expect, it } from "bun:test";
import {
  hrefForSignalEntity,
  labelForSignalKind,
  relativeTimeLabel,
  severityDotClass,
  severityTextClass,
} from "../src/features/qrm/components/signalCardHelpers";
import type { QrmSignal } from "../src/features/qrm/lib/signals-types";

function makeSignal(overrides: Partial<QrmSignal> = {}): QrmSignal {
  return {
    id: "s-1",
    workspace_id: "ws-1",
    kind: "inbound_email",
    severity: "medium",
    source: "gmail",
    title: "Acme replied",
    description: null,
    entity_type: "contact",
    entity_id: "c-1",
    assigned_rep_id: null,
    dedupe_key: "email:evt-1",
    occurred_at: "2026-04-20T12:00:00Z",
    suppressed_until: null,
    payload: {},
    created_at: "2026-04-20T12:00:00Z",
    updated_at: "2026-04-20T12:00:00Z",
    ...overrides,
  };
}

describe("labelForSignalKind", () => {
  it("labels inbound_email as Inbound email", () => {
    expect(labelForSignalKind("inbound_email")).toBe("Inbound email");
  });

  it("labels sla_breach as SLA breach", () => {
    expect(labelForSignalKind("sla_breach")).toBe("SLA breach");
  });

  it("labels telematics_fault as Fault code", () => {
    expect(labelForSignalKind("telematics_fault")).toBe("Fault code");
  });

  it("labels news_mention as News mention", () => {
    expect(labelForSignalKind("news_mention")).toBe("News mention");
  });

  it("labels the catch-all 'other' as a generic Signal", () => {
    expect(labelForSignalKind("other")).toBe("Signal");
  });
});

describe("severityDotClass", () => {
  it("critical = red-500", () => {
    expect(severityDotClass("critical")).toBe("bg-red-500");
  });
  it("high = orange-500", () => {
    expect(severityDotClass("high")).toBe("bg-orange-500");
  });
  it("medium = amber-400", () => {
    expect(severityDotClass("medium")).toBe("bg-amber-400");
  });
  it("low = slate-400", () => {
    expect(severityDotClass("low")).toBe("bg-slate-400");
  });
});

describe("severityTextClass", () => {
  it("critical text class includes red", () => {
    expect(severityTextClass("critical")).toContain("red");
  });
  it("high text class includes orange", () => {
    expect(severityTextClass("high")).toContain("orange");
  });
});

describe("hrefForSignalEntity", () => {
  it("routes deal signals to /qrm/deals/:id", () => {
    expect(
      hrefForSignalEntity(makeSignal({ entity_type: "deal", entity_id: "d-1" })),
    ).toBe("/qrm/deals/d-1");
  });

  it("routes contact signals to /qrm/contacts/:id", () => {
    expect(
      hrefForSignalEntity(makeSignal({ entity_type: "contact", entity_id: "c-1" })),
    ).toBe("/qrm/contacts/c-1");
  });

  it("routes company signals to /qrm/companies/:id", () => {
    expect(
      hrefForSignalEntity(makeSignal({ entity_type: "company", entity_id: "co-1" })),
    ).toBe("/qrm/companies/co-1");
  });

  it("routes equipment signals to inventory-pressure with query", () => {
    expect(
      hrefForSignalEntity(
        makeSignal({ entity_type: "equipment", entity_id: "e-1" }),
      ),
    ).toBe("/qrm/inventory-pressure?equipment=e-1");
  });

  it("routes rental signals to rentals with query", () => {
    expect(
      hrefForSignalEntity(makeSignal({ entity_type: "rental", entity_id: "r-1" })),
    ).toBe("/qrm/rentals?request=r-1");
  });

  it("routes activity signals to /qrm/activities/:id", () => {
    expect(
      hrefForSignalEntity(
        makeSignal({ entity_type: "activity", entity_id: "a-1" }),
      ),
    ).toBe("/qrm/activities/a-1");
  });

  it("returns null for workspace-scoped signals", () => {
    expect(
      hrefForSignalEntity(
        makeSignal({ entity_type: "workspace", entity_id: "ws-1" }),
      ),
    ).toBeNull();
  });

  it("returns null when entity_type is null", () => {
    expect(
      hrefForSignalEntity(makeSignal({ entity_type: null, entity_id: "x" })),
    ).toBeNull();
  });

  it("returns null when entity_id is null", () => {
    expect(
      hrefForSignalEntity(makeSignal({ entity_type: "deal", entity_id: null })),
    ).toBeNull();
  });
});

describe("relativeTimeLabel", () => {
  const now = new Date("2026-04-20T12:00:00Z").getTime();

  it("renders 'just now' within the last minute", () => {
    expect(relativeTimeLabel("2026-04-20T11:59:30Z", now)).toBe("just now");
  });

  it("renders minutes under an hour", () => {
    expect(relativeTimeLabel("2026-04-20T11:45:00Z", now)).toBe("15m ago");
  });

  it("renders hours under a day", () => {
    expect(relativeTimeLabel("2026-04-20T06:00:00Z", now)).toBe("6h ago");
  });

  it("renders days under a week", () => {
    expect(relativeTimeLabel("2026-04-17T12:00:00Z", now)).toBe("3d ago");
  });

  it("renders weeks past seven days", () => {
    expect(relativeTimeLabel("2026-04-01T12:00:00Z", now)).toBe("2w ago");
  });

  it("returns empty string for unparseable timestamps", () => {
    expect(relativeTimeLabel("not-a-date", now)).toBe("");
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(relativeTimeLabel("2026-04-21T00:00:00Z", now)).toBe("just now");
  });
});
