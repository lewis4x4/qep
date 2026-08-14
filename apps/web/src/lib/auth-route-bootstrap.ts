const AUTHENTICATED_APP_PATH_PREFIXES = [
  "/dashboard",
  "/chat",
  "/admin",
  "/voice",
  "/quote",
  "/qrm",
] as const;

/**
 * First-segment prefixes for real QEP OS routes. Used to distinguish a
 * bookmarked app URL (show sign-in) from a garbage path (show 404) while
 * logged out.
 */
const RECOGNIZED_APPLICATION_PATH_PREFIXES = [
  "/dashboard",
  "/floor",
  "/chat",
  "/iron",
  "/admin",
  "/finance-enforcement",
  "/auth",
  "/voice",
  "/workforce",
  "/service",
  "/ops",
  "/deal-timing",
  "/voice-qrm",
  "/m",
  "/qrm",
  "/nervous-system",
  "/price-intelligence",
  "/sop",
  "/os",
  "/email-drafts",
  "/dge",
  "/equipment",
  "/fleet",
  "/oem-portals",
  "/exceptions",
  "/exec",
  "/executive",
  "/rentals",
  "/parts",
  "/logistics",
  "/owner",
  "/brief",
  "/decisions",
  "/customers",
  "/people",
  "/dev",
  "/sales",
  "/crm",
  "/quote",
  "/quotes",
  "/voice-quote",
  "/login",
] as const;

const EXPIRED_OR_INVALID_SESSION_PATTERN = /expired|invalid|sign in again/i;

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
}

export function hasStoredSupabaseAuthToken(
  storage: StorageLike | undefined = typeof window !== "undefined" ? window.localStorage : undefined,
): boolean {
  if (!storage) {
    return false;
  }

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
      return true;
    }
  }

  return false;
}

export function isAuthenticatedAppPath(pathname: string): boolean {
  return AUTHENTICATED_APP_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isRecognizedApplicationPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login") {
    return true;
  }

  return RECOGNIZED_APPLICATION_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Logged-out visitors on real app URLs should see sign-in; unknown paths get 404. */
export function shouldShowLoginForUnauthenticatedPath(pathname: string): boolean {
  return isRecognizedApplicationPath(pathname);
}

export function shouldShowProtectedRouteBootstrap(params: {
  pathname: string;
  hasStoredToken: boolean;
  hasCachedProfile: boolean;
  authError: string | null;
}): boolean {
  if (
    !isAuthenticatedAppPath(params.pathname) ||
    (!params.hasStoredToken && !params.hasCachedProfile)
  ) {
    return false;
  }

  if (!params.authError) {
    return true;
  }

  return !EXPIRED_OR_INVALID_SESSION_PATTERN.test(params.authError);
}
