import type { UserRole } from "./database.types";

export interface CachedProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  iron_role: string | null;
  iron_role_display: string | null;
  is_support: boolean;
  active_workspace_id: string;
}

interface CachedProfileEnvelope {
  cachedAt: number;
  profile: CachedProfile;
}

const PROFILE_CACHE_KEY_PREFIX = "qep-auth-profile:";
const PROFILE_CACHE_TTL_MS = 60_000;

interface ReadStorageLike {
  getItem(key: string): string | null;
}

interface StorageScannerLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

interface WriteStorageLike extends ReadStorageLike {
  setItem(key: string, value: string): void;
}

export function isTransientAuthRecoveryError(message: string): boolean {
  if (
    /lock broken|steal option|timeout|timed out|network request failed|failed to fetch|load failed|networkerror|typeerror.*load|fetch.*load/i.test(
      message
    )
  ) {
    return true;
  }
  // CDN / proxy HTML error pages parsed as JSON
  if (/unexpected token\s*<\s*(in\s*json)?|expected json|DOCTYPE/i.test(message)) {
    return true;
  }
  if (
    /connection (refused|reset|lost)|econnrefused|socket hang up|cors|cross-origin|aborted|cancel(ed)?|bad gateway|service unavailable|gateway timeout/i.test(
      message
    )
  ) {
    return true;
  }
  return false;
}

/** True when the message likely comes from corrupt *local* session JSON, not a generic API JSON error. */
export function messageSuggestsCorruptLocalAuthStorage(message: string): boolean {
  if (isTransientAuthRecoveryError(message)) {
    return false;
  }
  const lower = message.toLowerCase();
  return /unexpected token(?!\s*<\s*in)|unterminated json|json\.parse|not valid json/i.test(lower);
}

export function readCachedProfile(
  userId: string,
  storage: ReadStorageLike | undefined = typeof window !== "undefined" ? window.sessionStorage : undefined,
  now: number = Date.now()
): CachedProfile | null {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(`${PROFILE_CACHE_KEY_PREFIX}${userId}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CachedProfileEnvelope;
    if (!parsed?.profile || parsed.profile.id !== userId) {
      return null;
    }
    if (typeof parsed.cachedAt !== "number" || now - parsed.cachedAt > PROFILE_CACHE_TTL_MS) {
      return null;
    }
    return parsed.profile;
  } catch {
    return null;
  }
}

export function writeCachedProfile(
  profile: CachedProfile,
  storage: WriteStorageLike | undefined = typeof window !== "undefined" ? window.sessionStorage : undefined,
  now: number = Date.now()
): void {
  if (!storage) {
    return;
  }

  storage.setItem(
    `${PROFILE_CACHE_KEY_PREFIX}${profile.id}`,
    JSON.stringify({
      cachedAt: now,
      profile,
    } satisfies CachedProfileEnvelope)
  );
}

export function clearCachedProfile(
  userId: string,
  storage: Pick<Storage, "removeItem"> | undefined = typeof window !== "undefined" ? window.sessionStorage : undefined,
): void {
  if (!storage) {
    return;
  }

  storage.removeItem(`${PROFILE_CACHE_KEY_PREFIX}${userId}`);
}

export function hasCachedAuthProfile(
  storage: StorageScannerLike | undefined = typeof window !== "undefined" ? window.sessionStorage : undefined,
  now: number = Date.now()
): boolean {
  if (!storage) {
    return false;
  }

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PROFILE_CACHE_KEY_PREFIX)) {
      continue;
    }

    const userId = key.slice(PROFILE_CACHE_KEY_PREFIX.length);
    if (!userId) {
      continue;
    }

    if (readCachedProfile(userId, storage, now)) {
      return true;
    }
  }

  return false;
}
