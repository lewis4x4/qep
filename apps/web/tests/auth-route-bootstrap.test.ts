import { describe, expect, it } from "bun:test";
import {
  AUTH_ENTRY_PATHS,
  hasStoredSupabaseAuthToken,
  isAuthEntryPath,
  isAuthenticatedAppPath,
  isRecognizedApplicationPath,
  resolveSignedInAuthEntryRedirect,
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
  it("treats auth entry routes and dashboard as recognized app paths", () => {
    expect(isRecognizedApplicationPath("/")).toBe(true);
    expect(isRecognizedApplicationPath("/login")).toBe(true);
    expect(isRecognizedApplicationPath("/portal/login")).toBe(true);
    expect(isRecognizedApplicationPath("/forgot-password")).toBe(true);
    expect(isRecognizedApplicationPath("/dashboard")).toBe(true);
    expect(isRecognizedApplicationPath("/sales/today")).toBe(true);
  });

  it("does not treat garbage paths as recognized app paths", () => {
    expect(isRecognizedApplicationPath("/zzz-not-a-page")).toBe(false);
    expect(isRecognizedApplicationPath("/not-real/route")).toBe(false);
    expect(isRecognizedApplicationPath("/portal/this-is-not-a-page")).toBe(false);
  });
});

describe("portal typo handling contract", () => {
  it("keeps unknown portal subpaths off the public catch-all login list", () => {
    expect(shouldShowLoginForUnauthenticatedPath("/portal/this-is-not-a-page")).toBe(false);
    expect(isRecognizedApplicationPath("/portal")).toBe(false);
  });
});

describe("shouldShowLoginForUnauthenticatedPath", () => {
  it("prompts sign-in for real app URLs and 404s for unknown paths", () => {
    expect(shouldShowLoginForUnauthenticatedPath("/dashboard")).toBe(true);
    expect(shouldShowLoginForUnauthenticatedPath("/forgot-password")).toBe(true);
    expect(shouldShowLoginForUnauthenticatedPath("/zzz-not-a-page")).toBe(false);
  });
});

describe("isAuthEntryPath", () => {
  it("covers the public auth entry routes", () => {
    for (const path of AUTH_ENTRY_PATHS) {
      expect(isAuthEntryPath(path)).toBe(true);
    }
    expect(isAuthEntryPath("/dashboard")).toBe(false);
  });
});

describe("resolveSignedInAuthEntryRedirect", () => {
  it("sends signed-in login and forgot-password visitors to role home", () => {
    expect(resolveSignedInAuthEntryRedirect("/login", "/sales/today")).toBe("/sales/today");
    expect(resolveSignedInAuthEntryRedirect("/forgot-password", "/qrm")).toBe("/qrm");
  });

  it("sends signed-in portal login visitors to portal home", () => {
    expect(resolveSignedInAuthEntryRedirect("/portal/login", "/sales/today")).toBe("/portal");
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
