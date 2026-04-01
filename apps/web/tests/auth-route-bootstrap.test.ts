import { describe, expect, it } from "bun:test";
import {
  hasStoredSupabaseAuthToken,
  isAuthenticatedAppPath,
  shouldShowProtectedRouteBootstrap,
} from "../src/lib/auth-route-bootstrap";

function createStorage(keys: string[]) {
  return {
    get length() {
      return keys.length;
    },
    key(index: number) {
      return keys[index] ?? null;
    },
  };
}

describe("isAuthenticatedAppPath", () => {
  it("treats the Integration Hub route as authenticated", () => {
    expect(isAuthenticatedAppPath("/admin/integrations")).toBe(true);
  });

  it("does not treat the public login entry as authenticated", () => {
    expect(isAuthenticatedAppPath("/")).toBe(false);
  });
});

describe("hasStoredSupabaseAuthToken", () => {
  it("detects Supabase auth tokens in storage", () => {
    expect(
      hasStoredSupabaseAuthToken(
        createStorage(["theme", "sb-localhost-auth-token", "sidebar"]),
      ),
    ).toBe(true);
  });

  it("ignores unrelated storage keys", () => {
    expect(hasStoredSupabaseAuthToken(createStorage(["theme", "sidebar"]))).toBe(false);
  });
});

describe("shouldShowProtectedRouteBootstrap", () => {
  it("holds protected owner routes in bootstrap when a token exists", () => {
    expect(
      shouldShowProtectedRouteBootstrap({
        pathname: "/admin/integrations",
        hasStoredToken: true,
        hasCachedProfile: false,
        authError: null,
      }),
    ).toBe(true);
  });

  it("keeps the public login shell for logged-out visits", () => {
    expect(
      shouldShowProtectedRouteBootstrap({
        pathname: "/admin/integrations",
        hasStoredToken: false,
        hasCachedProfile: false,
        authError: null,
      }),
    ).toBe(false);
  });

  it("does not mask expired-session errors behind protected bootstrap", () => {
    expect(
      shouldShowProtectedRouteBootstrap({
        pathname: "/admin/integrations",
        hasStoredToken: true,
        hasCachedProfile: false,
        authError: "Your session token is invalid or expired. Please sign in again.",
      }),
    ).toBe(false);
  });

  it("keeps route bootstrap for transient auth-service failures", () => {
    expect(
      shouldShowProtectedRouteBootstrap({
        pathname: "/admin/integrations",
        hasStoredToken: true,
        hasCachedProfile: false,
        authError: "We can't reach the authentication service. Try refreshing the page.",
      }),
    ).toBe(true);
  });

  it("holds the protected route when cached profile recovery is still available", () => {
    expect(
      shouldShowProtectedRouteBootstrap({
        pathname: "/admin/integrations",
        hasStoredToken: false,
        hasCachedProfile: true,
        authError: null,
      }),
    ).toBe(true);
  });
});
