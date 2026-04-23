import { describe, expect, it } from "bun:test";
import {
  ARCHETYPE_DEFS,
  buildSeats,
  inferArchetypeForContact,
} from "./decision-room-archetype";
import type { RelationshipMapBoard, RelationshipMapContact } from "./relationship-map";

function baseContact(overrides: Partial<RelationshipMapContact>): RelationshipMapContact {
  return {
    contactId: "c1",
    name: "Test Contact",
    title: null,
    email: null,
    phone: null,
    roles: [],
    evidence: [],
    lastSignalAt: null,
    archetypeOverride: null,
    ...overrides,
  };
}

describe("inferArchetypeForContact", () => {
  it("matches CFO title to economic_buyer with high confidence", () => {
    const result = inferArchetypeForContact(baseContact({ title: "CFO" }));
    expect(result.archetype).toBe("economic_buyer");
    expect(result.confidence).toBe("high");
  });

  it("matches Plant Manager title to operations", () => {
    const result = inferArchetypeForContact(baseContact({ title: "Plant Manager" }));
    expect(result.archetype).toBe("operations");
  });

  it("matches Procurement Buyer to procurement", () => {
    const result = inferArchetypeForContact(baseContact({ title: "Senior Procurement Buyer" }));
    expect(result.archetype).toBe("procurement");
  });

  it("falls back to role-based inference when title is missing", () => {
    const result = inferArchetypeForContact(baseContact({ title: null, roles: ["operator"] }));
    expect(result.archetype).toBe("operator");
    expect(result.confidence).toBe("medium");
  });

  it("defaults to champion with low confidence when no signal exists", () => {
    const result = inferArchetypeForContact(baseContact({ title: null, roles: [] }));
    expect(result.archetype).toBe("champion");
    expect(result.confidence).toBe("low");
  });

  it("respects a rep-authored override even when the title points elsewhere", () => {
    // "General Superintendent" matches the `operator` titleKeyword, but the
    // rep has reclassified this contact as champion. The override must win.
    const result = inferArchetypeForContact(
      baseContact({ title: "General Superintendent", archetypeOverride: "champion" }),
    );
    expect(result.archetype).toBe("champion");
    expect(result.confidence).toBe("high");
    expect(result.reason).toBe("Reclassified by rep");
  });

  it("respects override for a contact that otherwise has no signal", () => {
    // No title, no roles — would default to champion; override flips to operations.
    const result = inferArchetypeForContact(
      baseContact({ title: null, roles: [], archetypeOverride: "operations" }),
    );
    expect(result.archetype).toBe("operations");
    expect(result.confidence).toBe("high");
  });

  it("ignores an override whose value isn't a known archetype", () => {
    // Guard: a corrupt or legacy metadata value must not crash inference or
    // poison the seat. Fall through to title-based logic.
    const result = inferArchetypeForContact(
      baseContact({ title: "CFO", archetypeOverride: "not_a_real_archetype" }),
    );
    expect(result.archetype).toBe("economic_buyer");
    expect(result.reason).toContain("Title");
  });
});

describe("buildSeats", () => {
  it("emits archetype gap ghosts for always-expected seats when the room is empty", () => {
    const { seats, expectedArchetypes } = buildSeats({
      relationship: {
        summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      companyName: "Acme",
      dealAmount: 50_000,
      blockerPresent: false,
    });

    expect(expectedArchetypes).toContain("economic_buyer");
    expect(expectedArchetypes).toContain("operations");
    expect(expectedArchetypes).toContain("champion");
    expect(seats.every((s) => s.status === "ghost")).toBe(true);
    expect(seats.find((s) => s.archetype === "economic_buyer")?.findGuidance).not.toBeNull();
  });

  it("adds procurement + maintenance only when deal size crosses their thresholds", () => {
    const small = buildSeats({
      relationship: {
        summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      companyName: "Acme",
      dealAmount: 40_000,
      blockerPresent: false,
    });
    expect(small.expectedArchetypes).not.toContain("procurement");
    expect(small.expectedArchetypes).not.toContain("maintenance");

    const mid = buildSeats({
      relationship: {
        summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      companyName: "Acme",
      dealAmount: 200_000,
      blockerPresent: false,
    });
    expect(mid.expectedArchetypes).toContain("procurement");
    expect(mid.expectedArchetypes).toContain("maintenance");
  });

  it("promotes a named decision maker mention to an economic_buyer ghost with high confidence", () => {
    const { seats } = buildSeats({
      relationship: {
        summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [],
        unmatchedStakeholders: ["Morgan Shaw"],
      },
      needsAssessment: {
        id: "na-1",
        decision_maker_name: "Morgan Shaw",
        is_decision_maker: false,
        monthly_payment_target: null,
      } as never,
      companyName: "Acme",
      dealAmount: 80_000,
      blockerPresent: false,
    });
    const morgan = seats.find((s) => s.name === "Morgan Shaw");
    expect(morgan?.archetype).toBe("economic_buyer");
    expect(morgan?.confidence).toBe("high");
    expect(morgan?.status).toBe("ghost");
  });

  it("keeps named seats ahead of mention ghosts and gap ghosts in ordering", () => {
    const { seats } = buildSeats({
      relationship: {
        summary: { contacts: 1, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [baseContact({ contactId: "c1", name: "Alex Owner", title: "Owner", roles: ["signer"] })],
        unmatchedStakeholders: ["Mention Person"],
      },
      needsAssessment: null,
      companyName: "Acme",
      dealAmount: 120_000,
      blockerPresent: false,
    });

    expect(seats[0]?.status).toBe("named");
    const firstGhostIndex = seats.findIndex((s) => s.status === "ghost");
    const firstMentionIndex = seats.findIndex((s) => s.name === "Mention Person");
    const firstGapIndex = seats.findIndex((s) => s.id.startsWith("ghost:"));
    expect(firstGhostIndex).toBeGreaterThan(0);
    expect(firstMentionIndex).toBeLessThan(firstGapIndex);
  });

  it("never duplicates an archetype when a named seat already fills it", () => {
    const { seats } = buildSeats({
      relationship: {
        summary: { contacts: 1, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [baseContact({ contactId: "c1", name: "Pat CFO", title: "CFO", roles: ["decider"] })],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      companyName: "Acme",
      dealAmount: 80_000,
      blockerPresent: false,
    });

    const ebs = seats.filter((s) => s.archetype === "economic_buyer");
    expect(ebs).toHaveLength(1);
    expect(ebs[0]?.status).toBe("named");
  });
});

describe("ARCHETYPE_DEFS", () => {
  it("keeps economic_buyer as the highest-veto archetype", () => {
    const weights = Object.values(ARCHETYPE_DEFS).map((d) => d.vetoWeight);
    expect(Math.max(...weights)).toBe(ARCHETYPE_DEFS.economic_buyer.vetoWeight);
  });

  it("marks champion, economic_buyer, and operations as always-expected", () => {
    expect(ARCHETYPE_DEFS.champion.alwaysExpected).toBe(true);
    expect(ARCHETYPE_DEFS.economic_buyer.alwaysExpected).toBe(true);
    expect(ARCHETYPE_DEFS.operations.alwaysExpected).toBe(true);
  });
});
