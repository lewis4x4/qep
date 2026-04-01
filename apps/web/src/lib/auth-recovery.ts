import type { UserRole } from "./database.types";

export interface CachedProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
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
  return /lock broken|steal option|timeout|timed out|network request failed|failed to fetch/i.test(
    message
  );
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
