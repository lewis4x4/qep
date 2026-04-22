import { describe, expect, test } from "bun:test";
import {
  isDynamicImportLoadError,
  shouldReloadForDynamicImportFailure,
} from "./dynamic-import-recovery";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("dynamic-import-recovery", () => {
  test("detects stale deploy dynamic import errors", () => {
    expect(
      isDynamicImportLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://qualityequipmentparts.netlify.app/assets/LookupPage-CgPLekty.js",
        ),
      ),
    ).toBe(true);
    expect(isDynamicImportLoadError(new Error("ChunkLoadError: Loading chunk 12 failed."))).toBe(true);
    expect(isDynamicImportLoadError(new Error("Random application error"))).toBe(false);
  });

  test("allows one reload attempt per path inside the cooldown window", () => {
    const storage = new MemoryStorage();
    const now = Date.UTC(2026, 3, 22, 13, 0, 0);

    expect(shouldReloadForDynamicImportFailure(storage, "/parts/companion/lookup", now)).toBe(true);
    expect(shouldReloadForDynamicImportFailure(storage, "/parts/companion/lookup", now + 30_000)).toBe(false);
    expect(shouldReloadForDynamicImportFailure(storage, "/parts/companion/lookup", now + 6 * 60 * 1000)).toBe(true);
  });
});
