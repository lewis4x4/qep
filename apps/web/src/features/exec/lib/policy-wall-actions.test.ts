import { describe, expect, it } from "bun:test";
import { resolvePolicyWallActions } from "./policy-wall-actions";

describe("resolvePolicyWallActions", () => {
  it("routes payment issues to the invoice playbook", () => {
    expect(resolvePolicyWallActions("stripe_mismatch")).toEqual({
      primary: { label: "Open exception", href: "/exceptions" },
      secondary: { label: "Open invoice playbook", href: "/service/invoice" },
    });
  });

  it("routes tax issues to data quality", () => {
    expect(resolvePolicyWallActions("tax_failed")).toEqual({
      primary: { label: "Open exception", href: "/exceptions" },
      secondary: { label: "Open data quality", href: "/admin/data-quality" },
    });
  });

  it("keeps A/R overrides inside the exceptions queue", () => {
    expect(resolvePolicyWallActions("ar_override_pending")).toEqual({
      primary: { label: "Review override", href: "/exceptions" },
      secondary: { label: "Open exceptions queue", href: "/exceptions" },
    });
  });
});
