import { describe, expect, test } from "bun:test";
import {
  buildVendorPricingPortalUrl,
  getVendorPricingPortalError,
  makeVendorAccessKey,
  normalizeVendorPricingPortalPayload,
  sha256Hex,
} from "./vendor-pricing-portal-utils";

describe("vendor-pricing-portal-utils", () => {
  test("builds stable vendor portal URLs", () => {
    expect(buildVendorPricingPortalUrl("https://qep.blackrockai.co", "abc123")).toBe(
      "https://qep.blackrockai.co/vendor/pricing/abc123",
    );
  });

  test("generates url-safe access keys", () => {
    expect(makeVendorAccessKey()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("hashes access keys deterministically", async () => {
    const digest = await sha256Hex("vendor-key");
    expect(digest).toHaveLength(64);
    expect(digest).toBe(await sha256Hex("vendor-key"));
  });

  test("normalizes vendor portal edge payloads", () => {
    expect(normalizeVendorPricingPortalPayload({
      vendor: {
        id: "vendor-1",
        name: "Acme Supply",
        supplierType: "parts",
        notes: "Preferred",
        label: "Spring update",
        contactName: "Avery",
        contactEmail: "avery@example.com",
      },
      prices: [
        {
          id: "price-1",
          partNumber: "P-100",
          description: "Filter",
          currentPrice: "12.50",
          currency: "USD",
          effectiveDate: "2026-05-03",
        },
        { id: "bad", partNumber: "", currency: "USD", effectiveDate: "2026-05-03" },
      ],
      submissions: [
        {
          id: "sub-1",
          partNumber: "P-100",
          description: "Filter",
          proposedPrice: "13.25",
          currency: "USD",
          effectiveDate: "2026-05-04",
          notes: "New cost",
          status: "pending",
          reviewNotes: null,
          createdAt: "2026-05-03T10:00:00.000Z",
        },
        { id: "bad", partNumber: "P-200", proposedPrice: "x" },
      ],
    })).toEqual({
      vendor: {
        id: "vendor-1",
        name: "Acme Supply",
        supplierType: "parts",
        notes: "Preferred",
        label: "Spring update",
        contactName: "Avery",
        contactEmail: "avery@example.com",
      },
      prices: [
        {
          id: "price-1",
          partNumber: "P-100",
          description: "Filter",
          currentPrice: 12.5,
          currency: "USD",
          effectiveDate: "2026-05-03",
        },
      ],
      submissions: [
        {
          id: "sub-1",
          partNumber: "P-100",
          description: "Filter",
          proposedPrice: 13.25,
          currency: "USD",
          effectiveDate: "2026-05-04",
          notes: "New cost",
          status: "pending",
          reviewNotes: null,
          createdAt: "2026-05-03T10:00:00.000Z",
        },
      ],
    });
  });

  test("extracts vendor portal errors and rejects malformed payloads", () => {
    expect(getVendorPricingPortalError({ error: "expired" })).toBe("expired");
    expect(getVendorPricingPortalError({ error: 42 })).toBeNull();
    expect(normalizeVendorPricingPortalPayload(null)).toBeNull();
    expect(normalizeVendorPricingPortalPayload({ vendor: { id: "vendor-1" } })).toBeNull();
  });
});
