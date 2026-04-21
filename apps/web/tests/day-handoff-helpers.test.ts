/**
 * Bun tests for the Slice 15 Today → Ask Iron "Brief my day" handoff.
 *
 * Locks in the prompt shape per scope so Iron's tool selection stays
 * stable — the formatter is the only thing the seeded conversation
 * sees, so regressions here land as quality bugs on the Today surface
 * morning-briefing flow.
 */

import { describe, expect, it } from "bun:test";
import {
  formatIronDayBriefPrompt,
  type IronDayBriefScope,
  labelForDayBriefScope,
} from "../src/features/qrm/components/dayHandoffHelpers";

describe("labelForDayBriefScope", () => {
  it("returns 'Brief my day' for the mine scope", () => {
    expect(labelForDayBriefScope("mine")).toBe("Brief my day");
  });

  it("returns 'Brief the team' for the team scope", () => {
    expect(labelForDayBriefScope("team")).toBe("Brief the team");
  });
});

describe("formatIronDayBriefPrompt", () => {
  it("opens the mine variant with 'Brief me on my day.'", () => {
    const p = formatIronDayBriefPrompt("mine");
    expect(p.startsWith("Brief me on my day.")).toBe(true);
  });

  it("opens the team variant with 'Brief me on the team's day so far.'", () => {
    const p = formatIronDayBriefPrompt("team");
    expect(p.startsWith("Brief me on the team's day so far.")).toBe(true);
  });

  it("names the summarize_day tool by hand in the mine variant", () => {
    const p = formatIronDayBriefPrompt("mine");
    expect(p).toContain("summarize_day");
  });

  it("names the summarize_day tool by hand in the team variant", () => {
    const p = formatIronDayBriefPrompt("team");
    expect(p).toContain("summarize_day");
  });

  it("pins the 24-hour window in both variants", () => {
    const mine = formatIronDayBriefPrompt("mine");
    const team = formatIronDayBriefPrompt("team");
    expect(mine).toContain("last 24 hours");
    expect(team).toContain("last 24 hours");
  });

  it("tells Iron to omit rep_id for the team variant", () => {
    const p = formatIronDayBriefPrompt("team");
    expect(p).toContain("no rep_id");
  });

  it("leans on automatic rep-pinning for the mine variant", () => {
    const p = formatIronDayBriefPrompt("mine");
    // Mine variant should let the caller pinning do its work, not ask
    // for an explicit rep_id — otherwise elevated callers who view
    // their own queue would need the UI to plumb their rep id through.
    expect(p).toContain("pinned to my rep_id automatically");
  });

  it("lists the four summarize_day arms in the mine variant", () => {
    const p = formatIronDayBriefPrompt("mine");
    expect(p).toContain("active moves");
    expect(p).toContain("closed today");
    expect(p).toContain("fresh touches");
    expect(p).toContain("signals");
  });

  it("lists the four summarize_day arms in the team variant", () => {
    const p = formatIronDayBriefPrompt("team");
    expect(p).toContain("in flight");
    expect(p).toContain("completed");
    expect(p).toContain("fresh customer touches");
    expect(p).toContain("signals");
  });

  it("closes with an explicit propose_move invitation (mine)", () => {
    const p = formatIronDayBriefPrompt("mine");
    expect(p).toContain("propose_move");
  });

  it("closes with an explicit propose_move invitation (team)", () => {
    const p = formatIronDayBriefPrompt("team");
    expect(p).toContain("propose_move");
  });

  it("produces a multi-line string joined by newlines", () => {
    const p = formatIronDayBriefPrompt("mine");
    // opener + window bullet + tool bullet + callout bullet + closer
    expect(p.split("\n").length).toBeGreaterThanOrEqual(5);
  });

  it("produces different output for the two scopes", () => {
    const mine = formatIronDayBriefPrompt("mine");
    const team = formatIronDayBriefPrompt("team");
    expect(mine).not.toBe(team);
  });

  it("is exhaustive over the IronDayBriefScope union", () => {
    // This test is a belt-and-suspenders check that a future scope
    // added to the union doesn't silently fall through. If the union
    // grows, TypeScript will force the switch in formatIronDayBriefPrompt
    // to update or this test to extend.
    const scopes: IronDayBriefScope[] = ["mine", "team"];
    for (const s of scopes) {
      const p = formatIronDayBriefPrompt(s);
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
  });
});
