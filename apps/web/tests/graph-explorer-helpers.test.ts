/**
 * Bun tests for the Slice 9 Graph → Ask Iron handoff formatter.
 *
 * These tests lock in the prompt shape per entity type so Iron's tool
 * selection stays stable when the helper is refactored. The formatter is
 * the only thing the seeded conversation ever sees — regressions here
 * land as quality bugs in the operator experience.
 */

import { describe, expect, it } from "bun:test";
import {
  formatIronGraphPrompt,
  labelForGraphEntity,
} from "../src/features/qrm/components/graphExplorerHelpers";
import type { QrmSearchItem } from "../src/features/qrm/lib/types";

function makeItem(overrides: Partial<QrmSearchItem> = {}): QrmSearchItem {
  return {
    type: "deal",
    id: "d-1",
    title: "Acme Materials — 12k excavator",
    subtitle: "Stage: proposal · $140k",
    updatedAt: "2026-04-20T12:00:00Z",
    rank: 1,
    ...overrides,
  };
}

describe("labelForGraphEntity", () => {
  it("translates equipment to 'machine' (operator vernacular)", () => {
    expect(labelForGraphEntity("equipment")).toBe("machine");
  });
  it("translates rental to 'rental request'", () => {
    expect(labelForGraphEntity("rental")).toBe("rental request");
  });
  it("passes through deal / company / contact unchanged", () => {
    expect(labelForGraphEntity("deal")).toBe("deal");
    expect(labelForGraphEntity("company")).toBe("company");
    expect(labelForGraphEntity("contact")).toBe("contact");
  });
});

describe("formatIronGraphPrompt", () => {
  it("uses a deal-specific opener for deal rows", () => {
    const p = formatIronGraphPrompt(makeItem({ type: "deal" }));
    expect(p.startsWith("Brief me on this deal")).toBe(true);
  });

  it("uses a company-specific opener for company rows", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "company", title: "Acme Materials" }),
    );
    expect(p.startsWith("Give me the account picture")).toBe(true);
  });

  it("uses a contact-specific opener for contact rows", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "contact", title: "Jane Doe" }),
    );
    expect(p.startsWith("What's the state of this contact")).toBe(true);
  });

  it("uses an equipment-specific opener for equipment rows", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "equipment", title: "CAT 320 #42" }),
    );
    expect(p.startsWith("Status of this machine")).toBe(true);
  });

  it("uses a rental-specific opener for rental rows", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "rental", title: "Rental request #7" }),
    );
    expect(p.startsWith("Where is this rental request")).toBe(true);
  });

  it("includes the entity kind label and title on the first bullet", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "deal", title: "Acme expansion" }),
    );
    expect(p).toContain("• deal: Acme expansion");
  });

  it("maps equipment to 'machine' in the bullet", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "equipment", title: "Skid steer #3" }),
    );
    expect(p).toContain("• machine: Skid steer #3");
  });

  it("falls back to '(untitled)' when the title is whitespace-only", () => {
    const p = formatIronGraphPrompt(makeItem({ title: "   " }));
    expect(p).toContain("(untitled)");
  });

  it("includes subtitle as a Detail bullet when present", () => {
    const p = formatIronGraphPrompt(
      makeItem({ subtitle: "Stage: proposal · $140k" }),
    );
    expect(p).toContain("• Detail: Stage: proposal · $140k");
  });

  it("collapses whitespace inside subtitle", () => {
    const p = formatIronGraphPrompt(
      makeItem({ subtitle: "Stage:   proposal\n\n  $140k" }),
    );
    expect(p).toContain("• Detail: Stage: proposal $140k");
  });

  it("caps long subtitles at 200 chars with an ellipsis", () => {
    const long = "x".repeat(300);
    const p = formatIronGraphPrompt(makeItem({ subtitle: long }));
    expect(p).toContain("…");
    expect(p).not.toContain("x".repeat(250));
  });

  it("omits Detail line when subtitle is null", () => {
    const p = formatIronGraphPrompt(makeItem({ subtitle: null }));
    expect(p).not.toContain("• Detail:");
  });

  it("omits Detail line when subtitle is empty after trim", () => {
    const p = formatIronGraphPrompt(makeItem({ subtitle: "   " }));
    expect(p).not.toContain("• Detail:");
  });

  it("always includes entity scope hint (type + id)", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "deal", id: "deal-42" }),
    );
    expect(p).toContain("• Entity: deal (deal-42)");
  });

  it("closes with the explicit propose_move invitation", () => {
    const p = formatIronGraphPrompt(makeItem());
    expect(p).toContain("propose_move");
  });

  it("produces a multi-line string joined by newlines", () => {
    const p = formatIronGraphPrompt(makeItem());
    // opener + entity + detail + scope + closer = 5 lines minimum when
    // subtitle is present (as in makeItem defaults)
    expect(p.split("\n").length).toBeGreaterThanOrEqual(5);
  });

  it("produces a shorter output when subtitle is absent", () => {
    const with_ = formatIronGraphPrompt(makeItem({ subtitle: "stage" }));
    const without = formatIronGraphPrompt(makeItem({ subtitle: null }));
    expect(without.length).toBeLessThan(with_.length);
  });

  // Slice 17 — synthesizer tool-naming in the closer. Each of the three
  // entity types with a synthesizer must name it by hand so Iron picks
  // the bundled read over the cheaper detail+list chain.
  it("names summarize_deal in the deal closer", () => {
    const p = formatIronGraphPrompt(makeItem({ type: "deal" }));
    expect(p).toContain("summarize_deal");
  });

  it("names summarize_company in the company closer", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "company", title: "Acme Materials" }),
    );
    expect(p).toContain("summarize_company");
  });

  it("names summarize_contact in the contact closer", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "contact", title: "Jane Doe" }),
    );
    expect(p).toContain("summarize_contact");
  });

  it("keeps the generic closer for equipment (no synthesizer yet)", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "equipment", title: "CAT 320 #42" }),
    );
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).toContain("Use the detail tools");
  });

  it("keeps the generic closer for rental (no synthesizer yet)", () => {
    const p = formatIronGraphPrompt(
      makeItem({ type: "rental", title: "Rental request #7" }),
    );
    expect(p).not.toContain("summarize_deal");
    expect(p).not.toContain("summarize_company");
    expect(p).not.toContain("summarize_contact");
    expect(p).toContain("Use the detail tools");
  });

  it("still includes propose_move invitation on every entity type", () => {
    for (const type of ["deal", "company", "contact", "equipment", "rental"] as const) {
      const p = formatIronGraphPrompt(makeItem({ type }));
      expect(p).toContain("propose_move");
    }
  });
});
