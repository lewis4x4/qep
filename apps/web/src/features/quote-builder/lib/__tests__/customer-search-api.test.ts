import { describe, expect, test } from "bun:test";
import {
  assembleResults,
  daysBetween,
  deriveWarmth,
  formatContactName,
  EMPTY_SIGNALS,
  WARM_DAYS_MAX,
  COOL_DAYS_MAX,
  type CompanySignals,
  type CustomerSearchContact,
} from "../customer-search-api";

// ── formatContactName ───────────────────────────────────────────────────

describe("formatContactName", () => {
  test("both parts", () => {
    expect(formatContactName("Angela", "Peterson")).toBe("Angela Peterson");
  });
  test("first only", () => {
    expect(formatContactName("Angela", null)).toBe("Angela");
    expect(formatContactName("Angela", "")).toBe("Angela");
  });
  test("last only", () => {
    expect(formatContactName(null, "Peterson")).toBe("Peterson");
    expect(formatContactName("  ", "Peterson")).toBe("Peterson");
  });
  test("neither → placeholder", () => {
    expect(formatContactName(null, null)).toBe("(unnamed contact)");
    expect(formatContactName("  ", "  ")).toBe("(unnamed contact)");
  });
});

// ── daysBetween ─────────────────────────────────────────────────────────

describe("daysBetween", () => {
  const now = new Date("2026-04-20T12:00:00Z");
  test("same moment → 0", () => {
    expect(daysBetween(now, now)).toBe(0);
  });
  test("future → 0 (clamps negative)", () => {
    const future = new Date("2026-04-25T12:00:00Z");
    expect(daysBetween(future, now)).toBe(0);
  });
  test("1 day ago", () => {
    expect(daysBetween(new Date("2026-04-19T12:00:00Z"), now)).toBe(1);
  });
  test("30 days ago", () => {
    expect(daysBetween(new Date("2026-03-21T12:00:00Z"), now)).toBe(30);
  });
  test("handles invalid date → 0", () => {
    expect(daysBetween(new Date("bogus"), now)).toBe(0);
  });
});

// ── deriveWarmth ────────────────────────────────────────────────────────

describe("deriveWarmth", () => {
  test("no data at all → new", () => {
    expect(deriveWarmth(EMPTY_SIGNALS)).toBe("new");
  });
  test("has past quote but never contacted → cool", () => {
    expect(deriveWarmth({ ...EMPTY_SIGNALS, pastQuoteCount: 1 })).toBe("cool");
  });
  test("has open deal but no contact timestamp → cool", () => {
    expect(deriveWarmth({ ...EMPTY_SIGNALS, openDeals: 1 })).toBe("cool");
  });
  test("contacted within WARM_DAYS_MAX → warm", () => {
    expect(deriveWarmth({ ...EMPTY_SIGNALS, lastContactDaysAgo: WARM_DAYS_MAX })).toBe("warm");
    expect(deriveWarmth({ ...EMPTY_SIGNALS, lastContactDaysAgo: 0 })).toBe("warm");
  });
  test("between WARM and COOL → cool", () => {
    expect(deriveWarmth({ ...EMPTY_SIGNALS, lastContactDaysAgo: WARM_DAYS_MAX + 1 })).toBe("cool");
    expect(deriveWarmth({ ...EMPTY_SIGNALS, lastContactDaysAgo: COOL_DAYS_MAX })).toBe("cool");
  });
  test("beyond COOL → dormant", () => {
    expect(deriveWarmth({ ...EMPTY_SIGNALS, lastContactDaysAgo: COOL_DAYS_MAX + 1 })).toBe("dormant");
    expect(deriveWarmth({ ...EMPTY_SIGNALS, lastContactDaysAgo: 365 })).toBe("dormant");
  });
});

// ── assembleResults ─────────────────────────────────────────────────────

describe("assembleResults", () => {
  const signalsByCompany = new Map<string, CompanySignals>([
    ["c-acme", { openDeals: 2, openDealValueCents: 180_000_00, lastContactDaysAgo: 10, pastQuoteCount: 3, pastQuoteValueCents: 250_000_00 }],
    ["c-stale", { openDeals: 0, openDealValueCents: 0, lastContactDaysAgo: 120, pastQuoteCount: 1, pastQuoteValueCents: 50_000_00 }],
  ]);
  const companyById = new Map([
    ["c-acme", { id: "c-acme", name: "Acme Landscaping", city: "Lake City", state: "FL" }],
    ["c-stale", { id: "c-stale", name: "Stale Inc", city: null, state: null }],
  ]);

  test("empty inputs → empty output", () => {
    const out = assembleResults({
      contacts: [], companies: [],
      signalsByCompany: new Map(), contactCountByCompany: new Map(),
      companyById: new Map(),
      limit: 8,
    });
    expect(out).toEqual([]);
  });

  test("contacts ordered before companies", () => {
    const out = assembleResults({
      contacts: [{
        id: "ct-1", first_name: "Angela", last_name: "Peterson", title: null,
        email: null, phone: null, primary_company_id: "c-acme",
      }],
      companies: [{
        id: "c-acme", name: "Acme Landscaping", dba: null, phone: null,
        city: "Lake City", state: "FL", classification: null,
      }],
      signalsByCompany,
      contactCountByCompany: new Map([["c-acme", 3]]),
      companyById,
      limit: 8,
    });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("contact");
    expect(out[1].kind).toBe("company");
  });

  test("contact carries company + signals forward", () => {
    const out = assembleResults({
      contacts: [{
        id: "ct-1", first_name: "Angela", last_name: "Peterson", title: "Owner",
        email: "a@acme.co", phone: "555-0100", primary_company_id: "c-acme",
      }],
      companies: [],
      signalsByCompany,
      contactCountByCompany: new Map(),
      companyById,
      limit: 8,
    });
    const row = out[0] as CustomerSearchContact;
    expect(row.contactName).toBe("Angela Peterson");
    expect(row.contactTitle).toBe("Owner");
    expect(row.companyName).toBe("Acme Landscaping");
    expect(row.companyCity).toBe("Lake City");
    expect(row.companyState).toBe("FL");
    expect(row.signals.openDeals).toBe(2);
    expect(row.signals.lastContactDaysAgo).toBe(10);
    expect(row.warmth).toBe("warm");
  });

  test("contact without company falls back to empty signals + 'new' warmth", () => {
    const out = assembleResults({
      contacts: [{
        id: "ct-2", first_name: "Lonely", last_name: "Contact", title: null,
        email: null, phone: null, primary_company_id: null,
      }],
      companies: [],
      signalsByCompany,
      contactCountByCompany: new Map(),
      companyById,
      limit: 8,
    });
    const row = out[0] as CustomerSearchContact;
    expect(row.companyId).toBeNull();
    expect(row.signals).toEqual(EMPTY_SIGNALS);
    expect(row.warmth).toBe("new");
  });

  test("company row includes contact count + classification", () => {
    const out = assembleResults({
      contacts: [],
      companies: [{
        id: "c-stale", name: "Stale Inc", dba: "The Stale", phone: "555-0200",
        city: "Dormantsville", state: "GA", classification: "landscape",
      }],
      signalsByCompany,
      contactCountByCompany: new Map([["c-stale", 5]]),
      companyById,
      limit: 8,
    });
    expect(out[0].kind).toBe("company");
    if (out[0].kind !== "company") throw new Error("unexpected kind");
    expect(out[0].companyName).toBe("Stale Inc");
    expect(out[0].companyDba).toBe("The Stale");
    expect(out[0].companyClassification).toBe("landscape");
    expect(out[0].contactCount).toBe(5);
    expect(out[0].warmth).toBe("dormant");
  });

  test("respects limit parameter", () => {
    const manyContacts = Array.from({ length: 10 }, (_, i) => ({
      id: `ct-${i}`, first_name: `C${i}`, last_name: "X", title: null,
      email: null, phone: null, primary_company_id: null,
    }));
    const out = assembleResults({
      contacts: manyContacts, companies: [],
      signalsByCompany: new Map(), contactCountByCompany: new Map(),
      companyById: new Map(),
      limit: 3,
    });
    expect(out).toHaveLength(3);
  });
});
