import { describe, expect, it } from "bun:test";
import {
  hasCachedAuthProfile,
  isTransientAuthRecoveryError,
  readCachedProfile,
  writeCachedProfile,
  type CachedProfile,
} from "../src/lib/auth-recovery";

function createStorage(initialEntries: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialEntries));
  return {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const profile: CachedProfile = {
  id: "user-123",
  full_name: "Demo Owner",
  email: "demo.owner@qep-demo.local",
  role: "owner",
};

describe("isTransientAuthRecoveryError", () => {
  it("treats Supabase lock contention as transient", () => {
    expect(
      isTransientAuthRecoveryError("Lock broken by another request with the 'steal' option.")
    ).toBe(true);
  });

  it("does not treat expired sessions as transient", () => {
    expect(
      isTransientAuthRecoveryError("Your session token is invalid or expired. Please sign in again.")
    ).toBe(false);
  });
});

describe("cached auth profile recovery", () => {
  it("reads back a freshly cached profile", () => {
    const storage = createStorage();
    writeCachedProfile(profile, storage, 10_000);

    expect(readCachedProfile(profile.id, storage, 10_001)).toEqual(profile);
  });

  it("ignores expired cached profiles", () => {
    const storage = createStorage();
    writeCachedProfile(profile, storage, 10_000);

    expect(readCachedProfile(profile.id, storage, 80_001)).toBeNull();
  });

  it("detects when any cached profile is still fresh", () => {
    const storage = createStorage();
    writeCachedProfile(profile, storage, 10_000);

    expect(hasCachedAuthProfile(storage, 10_001)).toBe(true);
  });

  it("ignores expired cached profiles when scanning for recovery", () => {
    const storage = createStorage();
    writeCachedProfile(profile, storage, 10_000);

    expect(hasCachedAuthProfile(storage, 80_001)).toBe(false);
  });
});
