import { describe, expect, test } from "bun:test";

import {
  canonicalizeCatalogSpecsForDiff,
  formatCatalogStructuredSpec,
  hasMeaningfulCatalogSpecs,
  projectCatalogSpecs,
} from "../catalog-specs";

describe("catalog specs projection", () => {
  test("projects flat manufacturer specs into ordered bullets and search text", () => {
    const projected = projectCatalogSpecs({
      operating_weight_lbs: 8420,
      hydraulic_flow_gpm: 22.4,
      horsepower: 74,
    });

    expect(projected.specBullets.slice(0, 3)).toEqual([
      "Horsepower: 74 HP",
      "Operating weight: 8420 lb",
      "Hydraulic flow: 22.4 GPM",
    ]);
    expect(projected.searchText).toContain("horsepower");
    expect(projected.searchText).toContain("8420");
    expect(projected.searchText).toContain("gpm");
  });

  test("flattens nested categories", () => {
    const projected = projectCatalogSpecs({
      engine: { horsepower: 65 },
      dimensions: { width_in: 72 },
    });

    expect(projected.structuredSpecs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "horsepower", category: "Engine", value: "65" }),
      expect.objectContaining({ key: "width_in", category: "Dimensions", value: "72" }),
    ]));
  });

  test("recognizes value/unit/label records", () => {
    const projected = projectCatalogSpecs([
      { key: "hydraulic_flow_gpm", label: "Aux flow", value: 32, unit: "GPM", category: "Hydraulics" },
    ]);

    expect(projected.structuredSpecs[0]).toMatchObject({
      key: "hydraulic_flow_gpm",
      label: "Aux flow",
      value: "32",
      unit: "GPM",
      category: "Hydraulics",
    });
    expect(formatCatalogStructuredSpec(projected.structuredSpecs[0]!)).toBe("Aux flow: 32 GPM");
  });

  test("rejects free-text-only fields", () => {
    const prose = "This machine is great for a broad range of jobs and has plenty of useful features.";
    const projected = projectCatalogSpecs({ notes: prose, description: prose, bullets: [prose] });

    expect(projected.structuredSpecs).toEqual([]);
    expect(hasMeaningfulCatalogSpecs({ notes: prose })).toBe(false);
  });

  test("rejects descriptor-only records and does not create fake label/unit bullets", () => {
    const projected = projectCatalogSpecs({
      engine: { label: "Horsepower", unit: "HP" },
      dimensions: [{ key: "width_in", label: "Width", unit: "in" }],
    });

    expect(projected.structuredSpecs).toEqual([]);
    expect(projected.specBullets).toEqual([]);
    expect(hasMeaningfulCatalogSpecs({ label: "Horsepower", unit: "HP" })).toBe(false);
  });

  test("canonicalizes equivalent specs for diffing", () => {
    expect(canonicalizeCatalogSpecsForDiff({ horsepower: 74, operating_weight_lbs: 8420 })).toEqual(
      canonicalizeCatalogSpecsForDiff({ operating_weight_lbs: 8420, horsepower: 74 }),
    );
    expect(canonicalizeCatalogSpecsForDiff({})).toBeNull();
  });
});
