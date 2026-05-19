import { describe, expect, test } from "bun:test";
import { matchCustomerInTranscript } from "./voice-customer-matcher";
import type { RepCustomer } from "./types";

function customer(name: string, id?: string): RepCustomer {
  return {
    customer_id: id ?? crypto.randomUUID(),
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

describe("matchCustomerInTranscript", () => {
  test("returns empty when transcript is blank", () => {
    const result = matchCustomerInTranscript("", [customer("Beacon Ridge")]);
    expect(result.top).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test("returns empty when no customers", () => {
    const result = matchCustomerInTranscript("I visited Beacon today", []);
    expect(result.top).toBeNull();
  });

  test("single mention scores 0.6 confidence", () => {
    const result = matchCustomerInTranscript(
      "I visited Beacon Ridge today and looked at the pad.",
      [customer("Beacon Ridge")],
    );
    expect(result.top?.company_name).toBe("Beacon Ridge");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.reasoning).toContain("Beacon");
  });

  test("repeated mention raises confidence above 0.7 (auto-accept threshold)", () => {
    const result = matchCustomerInTranscript(
      "Met with Beacon today. Beacon is buying. Beacon wants pricing.",
      [customer("Beacon Ridge")],
    );
    expect(result.top?.company_name).toBe("Beacon Ridge");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.reasoning).toMatch(/3×/);
  });

  test("ambiguous match between two customers → low confidence + alternates", () => {
    const result = matchCustomerInTranscript(
      "Talked to Beacon today.",
      [customer("Beacon Ridge", "a"), customer("Beacon Construction", "b")],
    );
    // Both match once, tied → confidence 0.4
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.alternates.length).toBeGreaterThanOrEqual(1);
  });

  test("decisive multi-mention winner over rival → high confidence", () => {
    const result = matchCustomerInTranscript(
      "Met with Beacon Ridge today. Beacon Ridge is buying. Acme also said something.",
      [customer("Beacon Ridge"), customer("Acme")],
    );
    expect(result.top?.company_name).toBe("Beacon Ridge");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  test("phrase match weighted higher than token match", () => {
    // "Beacon Ridge" as full phrase vs. just "Beacon" elsewhere
    const result = matchCustomerInTranscript(
      "Beacon Ridge today.",
      [customer("Beacon Ridge"), customer("Ridge Stone")],
    );
    expect(result.top?.company_name).toBe("Beacon Ridge");
  });

  test("ignores stopwords like 'Construction' or 'Inc'", () => {
    // 'Construction' is a stopword — should not match anything just on it.
    const result = matchCustomerInTranscript(
      "We are doing construction work today.",
      [customer("Beacon Construction Inc")],
    );
    expect(result.top).toBeNull();
  });

  test("returns alternates ranked by score", () => {
    const result = matchCustomerInTranscript(
      "Beacon Beacon Acme",
      [customer("Beacon Ridge", "b"), customer("Acme", "a")],
    );
    expect(result.top?.customer_id).toBe("b");
    expect(result.alternates[0]?.customer.customer_id).toBe("a");
  });

  test("is case-insensitive", () => {
    const result = matchCustomerInTranscript(
      "BEACON RIDGE today",
      [customer("beacon ridge")],
    );
    expect(result.top?.company_name).toBe("beacon ridge");
  });

  test("short tokens (< 3 chars) don't match", () => {
    // "AT" is only 2 chars — should not match anything
    const result = matchCustomerInTranscript(
      "I am at the site today",
      [customer("AT Industries")],
    );
    expect(result.top).toBeNull();
  });

  // ── Multi-field scoring (search aliases, contact name, city/state) ──
  describe("multi-field signals", () => {
    test("search alias contributes when company name doesn't match", () => {
      const c = customer("Lewis Holdings LLC");
      c.search_1 = "Lewis Tree Services";
      const result = matchCustomerInTranscript(
        "I met with Lewis Tree today, big crew.",
        [c],
      );
      expect(result.top?.customer_id).toBe(c.customer_id);
      expect(result.signals.some((s) => s.kind === "alias")).toBe(true);
    });

    test("primary contact first name boosts the right candidate", () => {
      const beacon = customer("Beacon Ridge", "a");
      beacon.primary_contact_name = "Frank Acres";
      const construction = customer("Beacon Construction", "b");
      construction.primary_contact_name = "Mike Holt";

      const result = matchCustomerInTranscript(
        "Met with Frank at Beacon, he wants the loader.",
        [beacon, construction],
      );
      expect(result.top?.customer_id).toBe("a");
      expect(result.signals.some((s) => s.kind === "contact_name")).toBe(true);
      expect(result.reasoning).toContain("primary contact");
    });

    test("city match boosts the right candidate", () => {
      const a = customer("Beacon Ridge", "a");
      a.city = "Bend";
      const b = customer("Beacon Ridge", "b");
      b.city = "Portland";

      const result = matchCustomerInTranscript(
        "Beacon out of Bend, looking at a 5T.",
        [a, b],
      );
      expect(result.top?.customer_id).toBe("a");
    });

    test("recency multiplier boosts active customers", () => {
      const fresh = customer("Beacon Ridge", "a");
      fresh.days_since_contact = 2;
      const stale = customer("Beacon Construction", "b");
      stale.days_since_contact = 200;

      const result = matchCustomerInTranscript(
        "Talked to Beacon today.",
        [fresh, stale],
      );
      expect(result.top?.customer_id).toBe("a");
      expect(result.reasoning).toMatch(/active.*ago/i);
    });

    test("reasoning is multi-clause when multiple signals fire", () => {
      const c = customer("Beacon Ridge");
      c.primary_contact_name = "Frank Acres";
      c.days_since_contact = 3;
      const result = matchCustomerInTranscript(
        "Met with Frank at Beacon Ridge today.",
        [c],
      );
      expect(result.reasoning).toContain("Beacon");
      expect(result.reasoning).toContain("Frank");
      expect(result.reasoning).toContain("active");
      expect(result.reasoning.split(" · ").length).toBeGreaterThan(1);
    });
  });

  // ── AI-extracted signals from second-pass matching ────────────
  describe("AI-extracted signals", () => {
    test("ai phone_mentions exact-match against primary_contact_phone wins decisively", () => {
      const a = customer("Beacon Ridge", "a");
      a.primary_contact_phone = "(555) 555-1212";
      const b = customer("Beacon Construction", "b");
      b.primary_contact_phone = "(555) 999-9999";

      const result = matchCustomerInTranscript(
        "Talked to Beacon today.",
        [a, b],
        { extracted: { phone_mentions: ["5555551212"] } },
      );
      expect(result.top?.customer_id).toBe("a");
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reasoning).toContain("phone matches");
    });

    test("ai contact_mentions reinforce when contact name appears in extraction", () => {
      const beacon = customer("Beacon Ridge", "a");
      beacon.primary_contact_name = "Frank Acres";
      const construction = customer("Beacon Construction", "b");
      construction.primary_contact_name = "Mike Holt";

      const result = matchCustomerInTranscript(
        "Talked to them today.", // transcript intentionally lacks names
        [beacon, construction],
        { extracted: { contact_mentions: ["Frank"], customer_mentions: ["Beacon"] } },
      );
      expect(result.top?.customer_id).toBe("a");
    });

    test("ai location_mentions match city", () => {
      const a = customer("Beacon Ridge", "a");
      a.city = "Bend";
      const b = customer("Beacon Ridge", "b");
      b.city = "Portland";

      const result = matchCustomerInTranscript(
        "Talked to Beacon today.",
        [a, b],
        { extracted: { location_mentions: ["Bend, Oregon"] } },
      );
      expect(result.top?.customer_id).toBe("a");
    });

    test("returns empty when no transcript AND no extraction signals", () => {
      const result = matchCustomerInTranscript("", [customer("Beacon Ridge")], {
        extracted: {},
      });
      expect(result.top).toBeNull();
    });
  });

  // ── Equipment cross-match (Slice A) ───────────────────────────
  describe("equipment cross-match", () => {
    test("single equipment match disambiguates between two same-named customers", () => {
      const beaconRidge = customer("Beacon", "a");
      beaconRidge.equipment_summary = [
        { make: "Yanmar", model: "ViO 55", year: 2022, category: "excavator", name: null },
      ];
      const beaconConstruction = customer("Beacon", "b");
      beaconConstruction.equipment_summary = [
        { make: "Cat", model: "D6", year: 2020, category: "dozer", name: null },
      ];

      const result = matchCustomerInTranscript(
        "Talked to Beacon about the Yanmar ViO 55.",
        [beaconRidge, beaconConstruction],
        { extracted: { equipment_mentioned: ["Yanmar ViO 55"] } },
      );

      expect(result.top?.customer_id).toBe("a");
      expect(result.signals.some((s) => s.kind === "ai_equipment")).toBe(true);
      expect(result.reasoning).toContain("owns matching");
    });

    test("dampening: generic phrase matching ≥3 customers drops per-hit weight", () => {
      // Five customers all own a Toyota forklift — phrase shares 2 tokens
      // (toyota, forklift) with every row, so all five match and dampening
      // triggers.
      const heavyBook = Array.from({ length: 5 }, (_, i) => {
        const c = customer(`Acme ${i}`, `c${i}`);
        c.equipment_summary = [
          { make: "Toyota", model: `8FG${i}`, year: 2020, category: "forklift", name: null },
        ];
        return c;
      });

      const heavyResult = matchCustomerInTranscript(
        "We talked about the Toyota forklift.",
        heavyBook,
        { extracted: { equipment_mentioned: ["Toyota forklift"] } },
      );

      // With 5 matching customers, damping is 1/sqrt(5) ≈ 0.447, so per-hit
      // weight is 3.0 * 0.447 ≈ 1.34. No customer should auto-accept on this
      // generic mention alone.
      expect(heavyResult.confidence).toBeLessThan(0.7);

      // Control: a SINGLE customer with the same fleet should NOT be dampened
      // — N < 3 means damping factor stays 1.0.
      const solo = customer("Acme", "solo");
      solo.equipment_summary = [
        { make: "Toyota", model: "8FG", year: 2020, category: "forklift", name: null },
      ];
      const soloResult = matchCustomerInTranscript(
        "We talked about the Toyota forklift.",
        [solo],
        { extracted: { equipment_mentioned: ["Toyota forklift"] } },
      );
      const soloEq = soloResult.signals.find((s) => s.kind === "ai_equipment");
      const heavyEq = heavyResult.signals.find((s) => s.kind === "ai_equipment");
      expect(soloEq).toBeDefined();
      expect(heavyEq).toBeDefined();
      // Per-hit weight in heavy book should be materially smaller.
      expect(heavyEq!.weight).toBeLessThan(soloEq!.weight * 0.7);
    });

    test("empty equipment_summary is a no-op — other lanes still fire", () => {
      const c = customer("Beacon Ridge");
      // equipment_summary defaults to [] via factory
      const result = matchCustomerInTranscript(
        "Talked to Beacon Ridge about the forklift.",
        [c],
        { extracted: { equipment_mentioned: ["forklift"] } },
      );
      expect(result.top?.customer_id).toBe(c.customer_id);
      expect(result.signals.some((s) => s.kind === "ai_equipment")).toBe(false);
      expect(result.signals.some((s) => s.kind === "company_name")).toBe(true);
    });

    test("multiple matching units on one customer count as a single hit per phrase", () => {
      const c = customer("Beacon Ridge", "a");
      c.equipment_summary = [
        { make: "Yanmar", model: "ViO 55", year: 2022, category: "excavator", name: null },
        { make: "Yanmar", model: "ViO 55", year: 2021, category: "excavator", name: null },
        { make: "Yanmar", model: "ViO 55", year: 2020, category: "excavator", name: null },
      ];

      const result = matchCustomerInTranscript(
        "Looking at the Yanmar ViO 55.",
        [c],
        { extracted: { equipment_mentioned: ["Yanmar ViO 55"] } },
      );

      const equipmentHits = result.signals.filter((s) => s.kind === "ai_equipment");
      expect(equipmentHits).toHaveLength(1);
      expect(equipmentHits[0]?.count).toBe(1);
    });
  });

  // ── Semantic lane (Slice B) ────────────────────────────────────
  describe("semantic lane", () => {
    test("semantic similarity ≥ 0.7 boosts the right candidate when token lanes find nothing", () => {
      const a = customer("Lewis Holdings LLC", "a");
      const b = customer("Acme Equipment", "b");
      const semantic = new Map<string, number>([
        ["a", 0.85],
      ]);

      // Transcript intentionally avoids any token from either company name —
      // only the semantic lane can pick the winner here.
      const result = matchCustomerInTranscript(
        "Talked to the tree-cutting guys today about pricing.",
        [a, b],
        { semantic },
      );

      expect(result.top?.customer_id).toBe("a");
      expect(result.signals.some((s) => s.kind === "semantic")).toBe(true);
      expect(result.reasoning).toContain("matches by meaning");
    });

    test("semantic similarity < 0.7 fires no signal", () => {
      const a = customer("Lewis Holdings LLC", "a");
      const semantic = new Map<string, number>([
        ["a", 0.68],
      ]);

      const result = matchCustomerInTranscript(
        "Talked to the tree-cutting guys today.",
        [a],
        { semantic },
      );

      // Below threshold → no signal, no winner.
      expect(result.top).toBeNull();
      expect(result.signals.some((s) => s.kind === "semantic")).toBe(false);
    });

    test("semantic + name signals stack", () => {
      const beacon = customer("Beacon Ridge", "a");
      const acme = customer("Acme Equipment", "b");
      const semanticBoosted = matchCustomerInTranscript(
        "Beacon today.",
        [beacon, acme],
        { semantic: new Map([["a", 0.9]]) },
      );

      expect(semanticBoosted.top?.customer_id).toBe("a");
      // Both name + semantic fired on the winner.
      expect(semanticBoosted.signals.some((s) => s.kind === "company_name")).toBe(true);
      expect(semanticBoosted.signals.some((s) => s.kind === "semantic")).toBe(true);
      // Both signal weights contribute to the accumulated score: 1.0 (name)
      // + 2.0 * (0.9 - 0.7) = 1.4. Each signal stored is non-zero.
      const nameWeight = semanticBoosted.signals
        .filter((s) => s.kind === "company_name")
        .reduce((sum, s) => sum + s.weight, 0);
      const semanticWeight = semanticBoosted.signals
        .filter((s) => s.kind === "semantic")
        .reduce((sum, s) => sum + s.weight, 0);
      expect(nameWeight).toBeGreaterThan(0);
      expect(semanticWeight).toBeGreaterThan(0);
    });

    test("empty semantic Map is a no-op", () => {
      const a = customer("Beacon Ridge", "a");
      const result = matchCustomerInTranscript(
        "Beacon today.",
        [a],
        { semantic: new Map() },
      );

      expect(result.top?.customer_id).toBe("a");
      expect(result.signals.some((s) => s.kind === "semantic")).toBe(false);
    });
  });
});
