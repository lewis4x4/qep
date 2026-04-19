import { describe, expect, test } from "bun:test";
import { decideAccess } from "../RequireAdmin";

const ADMIN_LIKE: ReadonlyArray<"admin" | "manager" | "owner" | "rep"> = [
  "admin",
  "manager",
  "owner",
];

describe("decideAccess", () => {
  test("loading → 'loading' regardless of profile shape", () => {
    expect(
      decideAccess({ loading: true, profileRole: null, allowedRoles: ADMIN_LIKE }),
    ).toBe("loading");
    expect(
      decideAccess({ loading: true, profileRole: "admin", allowedRoles: ADMIN_LIKE }),
    ).toBe("loading");
    expect(
      decideAccess({ loading: true, profileRole: "rep", allowedRoles: ADMIN_LIKE }),
    ).toBe("loading");
  });

  test("not loading + no profile → 'redirect'", () => {
    expect(
      decideAccess({ loading: false, profileRole: null, allowedRoles: ADMIN_LIKE }),
    ).toBe("redirect");
  });

  test("not loading + role outside allow-list → 'redirect'", () => {
    expect(
      decideAccess({ loading: false, profileRole: "rep", allowedRoles: ADMIN_LIKE }),
    ).toBe("redirect");
  });

  test("not loading + role inside allow-list → 'allow'", () => {
    for (const role of ["admin", "manager", "owner"] as const) {
      expect(
        decideAccess({ loading: false, profileRole: role, allowedRoles: ADMIN_LIKE }),
      ).toBe("allow");
    }
  });

  test("custom allow-list respected (e.g., owner-only surface)", () => {
    const ownerOnly: ReadonlyArray<"admin" | "manager" | "owner" | "rep"> = ["owner"];
    expect(
      decideAccess({ loading: false, profileRole: "admin", allowedRoles: ownerOnly }),
    ).toBe("redirect");
    expect(
      decideAccess({ loading: false, profileRole: "owner", allowedRoles: ownerOnly }),
    ).toBe("allow");
  });

  test("empty allow-list → everyone redirected (defensive)", () => {
    expect(
      decideAccess({ loading: false, profileRole: "admin", allowedRoles: [] }),
    ).toBe("redirect");
  });
});
