import { describe, expect, it } from "bun:test";
import {
  hasStoredSupabaseAuthToken,
  isAuthenticatedAppPath,
  isRecognizedApplicationPath,
  shouldShowLoginForUnauthenticatedPath,
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

describe("isRecognizedApplicationPath", () => {
  it("treats the login entry and dashboard as recognized app paths", () => {
    expect(isRecognizedApplicationPath("/")).toBe(true);
    expect(isRecognizedApplicationPath("/login")).toBe(true);
    expect(isRecognizedApplicationPath("/dashboard")).toBe(true);
    expect(isRecognizedApplicationPath("/sales/today")).toBe(true);
  });

  it("does not treat garbage paths as recognized app paths", () => {
    expect(isRecognizedApplicationPath("/zzz-not-a-page")).toBe(false);
    expect(isRecognizedApplicationPath("/not-real/route")).toBe(false);
  });
});

describe("shouldShowLoginForUnauthenticatedPath", () => {
  it("prompts sign-in for real app URLs and 404s for unknown paths", () => {
    expect(shouldShowLoginForUnauthenticatedPath("/dashboard")).toBe(true);
    expect(shouldShowLoginForUnauthenticatedPath("/zzz-not-a-page")).toBe(false);
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
