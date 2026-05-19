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
});
