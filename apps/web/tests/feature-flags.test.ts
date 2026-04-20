import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearFeatureFlag,
  FLAGS,
  isFeatureEnabled,
  setFeatureFlag,
} from "../src/lib/feature-flags";

// happy-dom (preloaded via bunfig.toml) provides window + localStorage.
// We reach through the global window; tests clear storage between runs
// so overrides don't leak across cases.
function storage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

describe("feature-flags", () => {
  beforeEach(() => {
    storage()?.clear();
  });

  afterEach(() => {
    storage()?.clear();
  });

  it("defaults to false when no override is present", () => {
    expect(isFeatureEnabled("example_flag")).toBe(false);
  });

  it("respects the provided default value", () => {
    expect(isFeatureEnabled("example_flag", true)).toBe(true);
  });

  it("localStorage override of 1 wins over env and default", () => {
    expect(setFeatureFlag("example_flag", true)).toBe(true);
    expect(isFeatureEnabled("example_flag")).toBe(true);
  });

  it("localStorage override of 0 overrides a truthy default", () => {
    setFeatureFlag("example_flag", false);
    expect(isFeatureEnabled("example_flag", true)).toBe(false);
  });

  it("clearFeatureFlag restores default resolution", () => {
    setFeatureFlag("example_flag", true);
    expect(isFeatureEnabled("example_flag")).toBe(true);
    clearFeatureFlag("example_flag");
    expect(isFeatureEnabled("example_flag")).toBe(false);
  });

  it("FLAGS constant exposes shell_v2", () => {
    expect(FLAGS.SHELL_V2).toBe("shell_v2");
  });

  it("ignores non-1/0 values in storage and falls back to default", () => {
    storage()?.setItem("qep_flag_example_flag", "yes");
    expect(isFeatureEnabled("example_flag")).toBe(false);
    expect(isFeatureEnabled("example_flag", true)).toBe(true);
  });
});
