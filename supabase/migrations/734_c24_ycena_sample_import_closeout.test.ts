import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const readJson = <T>(...parts: string[]) => JSON.parse(read(...parts)) as T;
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

type ImportArtifact = {
  mode: string;
  workspaceId: string;
  sourceCount: number;
  aggregate: {
    parsedRows: number;
    baseUpserts: number;
    optionAssociations: number;
    rowsSkipped: number;
    baseInserted: number;
    baseUpdated: number;
    optionInserted: number;
    optionUpdated: number;
  };
  sources: Array<{
    brand: string;
    manufacturer: string;
    parentOem: string;
    sourceFilename: string;
    sourceSha256: string;
    parserSummary: { rowCount: number; baseRowCount: number; optionRowCount: number; modelCount: number; models: string[] };
    importSummary: { parsedRows: number; baseUpserts: number; optionAssociations: number; rowsSkipped: number };
    applied: null | {
      baseInserted: number;
      baseUpdated: number;
      optionInserted: number;
      optionUpdated: number;
      run: { id: string };
    };
  }>;
};

const closeoutSql = read("supabase", "migrations", "734_c24_ycena_sample_import_closeout.sql");
const importer = read("scripts", "oem", "ycena-sample-import.mjs");
const importerTest = read("scripts", "oem", "__tests__", "ycena-sample-import.test.ts");
const dryRun = readJson<ImportArtifact>("test-results", "oem-imports", "20260521T051500Z-C2.4-ycena-sample-import-dry-run.json");
const applyRun = readJson<ImportArtifact>("test-results", "oem-imports", "20260521T051500Z-C2.4-ycena-sample-import-apply.json");
const historicalGate = readJson<{ segment: string; verdict: string; summary: { failed: number; blocking_failures: unknown[] } }>(
  "test-results",
  "agent-gates",
  "20260521T052005Z-C2.4-ycena-sample-import.json",
);
const fixtureRegister = read("docs", "IntelliDealer", "_Manifests", "QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md");

const compactCloseout = compact(closeoutSql);
const compactImporter = compact(importer);
const compactImporterTest = compact(importerTest);
const compactFixtureRegister = compact(fixtureRegister);

function sourceByBrand(artifact: ImportArtifact, brand: string) {
  const source = artifact.sources.find((entry) => entry.brand === brand);
  if (!source) throw new Error(`missing ${brand} source`);
  return source;
}

describe("734_c24_ycena_sample_import_closeout.sql contract", () => {
  it("marks only C2.4 shipped and records mission/manual boundaries", () => {
    expect(compactCloseout).toContain("where task_id = 'c2.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("manual_boundaries");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).not.toContain("where task_id = 'c2.1'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.5'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.6'");
    expect(compactCloseout).not.toContain("where task_id = 'd2.3'");
  });

  it("keeps Bobcat, Vermeer, and broader JAR-105 out of scope", () => {
    expect(compactCloseout).toContain("c2.5 bobcat");
    expect(compactCloseout).toContain("c2.6 vermeer");
    expect(compactCloseout).toContain("d2.3/jar-105 remains decision-gated");
    expect(compactCloseout).toContain("does not perform a new live import or require credentials");
    expect(compactFixtureRegister).toContain("bobcat-base-options-fixture");
    expect(compactFixtureRegister).toContain("vermeer-base-options-fixture");
    expect(compactFixtureRegister).toContain("not supplied");
  });

  it("pins the YCENA sample importer source contract", () => {
    expect(compactImporter).toContain("const supported_brands = new set([\"asv\", \"yanmar\"])");
    expect(compactImporter).toContain("import { parseycenapricebookfile } from \"./ycena-price-book-parser.mjs\"");
    expect(compactImporter).toContain("export function buildycenasampleimportplan(parsed, options = {})");
    expect(compactImporter).toContain("function canonicalbasenumber(brand, partnumber)");
    expect(compactImporter).toContain("return `${brandkey(brand)}:${partnumber}`");
    expect(compactImporter).toContain(".from(\"equipment_base_codes\")");
    expect(compactImporter).toContain(".upsert(rows, { onconflict: \"workspace_id,base_number\" })");
    expect(compactImporter).toContain(".from(\"equipment_options\")");
    expect(compactImporter).toContain(".upsert(rows, { onconflict: \"workspace_id,base_code_id,option_number\" })");
    expect(compactImporter).toContain(".from(\"equipment_base_codes_import_runs\")");
    expect(compactImporter).toContain("import_format: \"ycena_pdf_price_book\"");
    expect(compactImporter).toContain("throw new error(\"set supabase_url/vite_supabase_url and supabase_service_role_key to apply ycena sample imports.\")");
  });

  it("pins focused import-plan tests", () => {
    expect(compactImporterTest).toContain("maps parsed ycena rows to brand-prefixed base and option upserts");
    expect(compactImporterTest).toContain("baseupserts: 2");
    expect(compactImporterTest).toContain("optionassociations: 6");
    expect(compactImporterTest).toContain("base_number: \"yanmar:4004-227\"");
    expect(compactImporterTest).toContain("option_number: \"yanmar:2015-598\"");
    expect(compactImporterTest).toContain("deduplicates repeated option rows per base");
    expect(compactImporterTest).toContain("duplicate_option_for_base");
  });

  it("records tracked dry-run counts for both supplied YCENA books", () => {
    expect(dryRun.mode).toBe("dry-run");
    expect(dryRun.workspaceId).toBe("default");
    expect(dryRun.sourceCount).toBe(2);
    expect(dryRun.aggregate).toMatchObject({
      parsedRows: 829,
      baseUpserts: 69,
      optionAssociations: 2726,
      rowsSkipped: 44,
      baseInserted: 0,
      optionInserted: 0,
    });
    expect(sourceByBrand(dryRun, "ASV").parserSummary).toMatchObject({ rowCount: 523, baseRowCount: 41, optionRowCount: 482, modelCount: 12 });
    expect(sourceByBrand(dryRun, "Yanmar").parserSummary).toMatchObject({ rowCount: 306, baseRowCount: 28, optionRowCount: 278, modelCount: 10 });
    expect(sourceByBrand(dryRun, "ASV").sourceFilename).toBe("ASV-Price-Book-NA-EFF-14APR2026.pdf");
    expect(sourceByBrand(dryRun, "Yanmar").sourceFilename).toBe("Yanmar-CE-Price-Book-EFF-14APR2026_v2.pdf");
  });

  it("records tracked apply counts and import-run ids", () => {
    expect(applyRun.mode).toBe("apply");
    expect(applyRun.aggregate).toMatchObject({
      parsedRows: 829,
      baseUpserts: 69,
      optionAssociations: 2726,
      rowsSkipped: 44,
      baseInserted: 69,
      baseUpdated: 0,
      optionInserted: 2726,
      optionUpdated: 0,
    });
    expect(sourceByBrand(applyRun, "ASV").applied).toMatchObject({
      baseInserted: 41,
      optionInserted: 1648,
      run: { id: "cd2d3e60-e097-43de-b1e0-a390a43ebf18" },
    });
    expect(sourceByBrand(applyRun, "Yanmar").applied).toMatchObject({
      baseInserted: 28,
      optionInserted: 1078,
      run: { id: "6b3d2688-fe1d-4c91-beda-eeee9b92ac6a" },
    });
  });

  it("retains historical gate evidence for the import slice", () => {
    expect(historicalGate.segment).toBe("C2.4-ycena-sample-import");
    expect(historicalGate.verdict).toBe("PASS");
    expect(historicalGate.summary.failed).toBe(0);
    expect(historicalGate.summary.blocking_failures).toEqual([]);
  });
});
