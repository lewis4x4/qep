import { describe, expect, test } from "bun:test";
import {
  buildVendorPricingPortalUrl,
  makeVendorAccessKey,
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
});
