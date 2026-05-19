import { describe, expect, test } from "bun:test";
import { matchesRepCustomerSearch } from "./customer-search";
import type { RepCustomer } from "./types";

const baseCustomer: RepCustomer = {
  customer_id: "company-1",
  company_name: "A Awesome Towing and Transport, Inc",
  search_1: "ZZA",
  search_2: "YYB",
  primary_contact_name: "Jordan Lane",
  primary_contact_phone: null,
  primary_contact_email: null,
  city: "Lake City",
  state: "FL",
  open_deals: 0,
  active_quotes: 0,
  last_interaction: null,
  days_since_contact: null,
  opportunity_score: 0,
};

describe("matchesRepCustomerSearch", () => {
  test("matches Search 1 by prefix", () => {
    expect(matchesRepCustomerSearch(baseCustomer, "zz")).toBe(true);
  });

  test("matches Search 2 by prefix", () => {
    expect(matchesRepCustomerSearch(baseCustomer, "yy")).toBe(true);
  });

  test("does not match legacy codes by mid-string", () => {
    expect(matchesRepCustomerSearch(baseCustomer, "za")).toBe(false);
  });

  test("still matches normal company and location search", () => {
    expect(matchesRepCustomerSearch(baseCustomer, "awesome")).toBe(true);
    expect(matchesRepCustomerSearch(baseCustomer, "lake")).toBe(true);
  });

  test("matches phone across formatted/unformatted input", () => {
    const withPhone = { ...baseCustomer, primary_contact_phone: "(352) 555-0100" };
    expect(matchesRepCustomerSearch(withPhone, "3525550100")).toBe(true);
    expect(matchesRepCustomerSearch(withPhone, "(352) 555")).toBe(true);
  });


  test("matches DREC legacy code by prefix", () => {
    const drec = { ...baseCustomer, search_1: "DREC", search_2: null };
    expect(matchesRepCustomerSearch(drec, "dr")).toBe(true);
    expect(matchesRepCustomerSearch(drec, "rec")).toBe(false);
  });
});
