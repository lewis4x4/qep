const AUTHENTICATED_APP_PATH_PREFIXES = [
  "/dashboard",
  "/chat",
  "/admin",
  "/voice",
  "/quote",
  "/qrm",
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
