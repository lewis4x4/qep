import { beforeEach, describe, expect, it } from "bun:test";
import { EMPTY_COHORT_FILTER } from "../lib/decision-room-cohorts";
import { loadCohortFilter, persistCohortFilter } from "./DecisionRoomCohortFilters";

const STORAGE_KEY = "qep:decision-room:analytics:cohort-filter";

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    } satisfies Storage,
  });
  return store;
}

describe("DecisionRoomCohortFilters storage guards", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorage();
  });

  it("filters malformed persisted cohort values", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        equipment: ["track_loader", "bad-equipment", 42, "unknown"],
        sizes: ["enterprise", "bad-size"],
        tenures: ["veteran", null, "bad-tenure"],
      }),
    );

    expect(loadCohortFilter()).toEqual({
      equipment: ["track_loader", "unknown"],
      sizes: ["enterprise"],
      tenures: ["veteran"],
    });
  });

  it("falls back to the empty filter for non-object or invalid JSON payloads", () => {
    store.set(STORAGE_KEY, JSON.stringify(["track_loader"]));
    expect(loadCohortFilter()).toEqual(EMPTY_COHORT_FILTER);

    store.set(STORAGE_KEY, "{not json");
    expect(loadCohortFilter()).toEqual(EMPTY_COHORT_FILTER);
  });

  it("persists valid filters without rewriting the shape", () => {
    persistCohortFilter({
      equipment: ["excavator"],
      sizes: ["mid"],
      tenures: ["emerging"],
    });

    expect(loadCohortFilter()).toEqual({
      equipment: ["excavator"],
      sizes: ["mid"],
      tenures: ["emerging"],
    });
  });
});
