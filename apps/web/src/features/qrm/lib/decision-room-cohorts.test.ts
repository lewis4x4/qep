import { describe, expect, it } from "bun:test";
import {
  classifyCohort,
  classifyDealSize,
  classifyEquipment,
  classifyRepTenure,
  describeCohort,
  EMPTY_COHORT_FILTER,
  filterMatches,
  isEmptyFilter,
} from "./decision-room-cohorts";

const NOW = new Date("2026-04-23T12:00:00Z");

describe("classifyEquipment", () => {
  it("matches compact track loader from machine interest", () => {
    expect(classifyEquipment({ machineInterest: "Compact Track Loader 299D3", dealName: null })).toBe("track_loader");
  });

  it("matches skid steer from deal name when machine interest missing", () => {
    expect(classifyEquipment({ machineInterest: null, dealName: "Skid Steer replacement — Acme" })).toBe("skid_steer");
  });

  it("matches excavator with case-insensitive keyword", () => {
    expect(classifyEquipment({ machineInterest: "Mini EXCAVATOR", dealName: null })).toBe("excavator");
  });

  it("falls back to other_machine when there's a machine reference but no match", () => {
    expect(classifyEquipment({ machineInterest: "Motor Grader 14M3", dealName: null })).toBe("other_machine");
  });

  it("returns unknown when nothing is provided", () => {
    expect(classifyEquipment({ machineInterest: null, dealName: null })).toBe("unknown");
  });
});

describe("classifyDealSize", () => {
  it("buckets amounts across the four size tiers", () => {
    expect(classifyDealSize(50_000)).toBe("small");
    expect(classifyDealSize(150_000)).toBe("mid");
    expect(classifyDealSize(500_000)).toBe("large");
    expect(classifyDealSize(1_000_000)).toBe("enterprise");
  });

  it("returns unsized for null or zero", () => {
    expect(classifyDealSize(null)).toBe("unsized");
    expect(classifyDealSize(0)).toBe("unsized");
  });

  it("respects exact boundaries (lower-bound inclusive)", () => {
    expect(classifyDealSize(75_000)).toBe("mid");
    expect(classifyDealSize(250_000)).toBe("large");
    expect(classifyDealSize(750_000)).toBe("enterprise");
  });
});

describe("classifyRepTenure", () => {
  it("buckets tenure by days since profile.created_at", () => {
    expect(
      classifyRepTenure({ profileCreatedAt: "2026-03-01T00:00:00Z", now: NOW }),
    ).toBe("new"); // ~53 days
    expect(
      classifyRepTenure({ profileCreatedAt: "2025-07-01T00:00:00Z", now: NOW }),
    ).toBe("emerging"); // ~297 days
    expect(
      classifyRepTenure({ profileCreatedAt: "2023-01-01T00:00:00Z", now: NOW }),
    ).toBe("established"); // ~1208 days
    expect(
      classifyRepTenure({ profileCreatedAt: "2018-01-01T00:00:00Z", now: NOW }),
    ).toBe("veteran"); // ~3034 days
  });

  it("returns unknown when profileCreatedAt is missing or malformed", () => {
    expect(classifyRepTenure({ profileCreatedAt: null, now: NOW })).toBe("unknown");
    expect(classifyRepTenure({ profileCreatedAt: "not a date", now: NOW })).toBe("unknown");
  });
});

describe("classifyCohort", () => {
  it("combines all three dimensions into one tag set", () => {
    const tags = classifyCohort({
      machineInterest: "Compact Track Loader",
      dealName: "Acme CTL purchase",
      dealAmount: 180_000,
      profileCreatedAt: "2025-09-01T00:00:00Z",
      now: NOW,
    });
    expect(tags.equipment).toBe("track_loader");
    expect(tags.size).toBe("mid");
    expect(tags.tenure).toBe("emerging");
  });
});

describe("filterMatches", () => {
  const tags = {
    equipment: "track_loader" as const,
    size: "mid" as const,
    tenure: "veteran" as const,
  };

  it("matches any filter with no constraints", () => {
    expect(filterMatches(tags, EMPTY_COHORT_FILTER)).toBe(true);
  });

  it("passes when every dimension is in the allowed set", () => {
    expect(
      filterMatches(tags, {
        equipment: ["track_loader", "skid_steer"],
        sizes: ["mid"],
        tenures: ["veteran"],
      }),
    ).toBe(true);
  });

  it("rejects when any one dimension is outside the allowed set", () => {
    expect(
      filterMatches(tags, {
        equipment: ["backhoe"],
        sizes: ["mid"],
        tenures: ["veteran"],
      }),
    ).toBe(false);
  });
});

describe("isEmptyFilter + describeCohort", () => {
  it("isEmptyFilter is true only when every dimension list is empty", () => {
    expect(isEmptyFilter(EMPTY_COHORT_FILTER)).toBe(true);
    expect(isEmptyFilter({ equipment: ["backhoe"], sizes: [], tenures: [] })).toBe(false);
  });

  it("describeCohort includes equipment, size, and tenure in a readable line", () => {
    const text = describeCohort({ equipment: "track_loader", size: "mid", tenure: "emerging" });
    expect(text).toContain("Track Loaders");
    expect(text).toContain("Mid");
    expect(text).toContain("Emerging");
  });
});
