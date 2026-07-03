import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = read("supabase", "migrations", "733_c23_pdf_price_book_parser_closeout.sql");
const parser = read("scripts", "oem", "ycena-price-book-parser.mjs");
const parserTest = read("scripts", "oem", "__tests__", "ycena-price-book-parser.test.ts");
const fixture = read("scripts", "oem", "__fixtures__", "ycena-tl25rp-sample.txt");
const decisionPacket = read("docs", "IntelliDealer", "_Manifests", "QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md");
const fixtureRegister = read("docs", "IntelliDealer", "_Manifests", "QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md");

const compactCloseout = compact(closeoutSql);
const compactParser = compact(parser);
const compactParserTest = compact(parserTest);
const compactFixture = compact(fixture);
const compactDecisionPacket = compact(decisionPacket);
const compactFixtureRegister = compact(fixtureRegister);

describe("733_c23_pdf_price_book_parser_closeout.sql contract", () => {
  it("marks only C2.3 shipped and records mission/manual boundaries", () => {
    expect(compactCloseout).toContain("where task_id = 'c2.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("manual_boundaries");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).not.toContain("where task_id = 'c2.1'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.5'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.6'");
    expect(compactCloseout).not.toContain("where task_id = 'd2.3'");
  });

  it("keeps imports and fixture-gated OEMs out of scope", () => {
    expect(compactCloseout).toContain("c2.4 asv/yanmar sample import");
    expect(compactCloseout).toContain("c2.5 bobcat");
    expect(compactCloseout).toContain("c2.6 vermeer");
    expect(compactCloseout).toContain("does not import sample data");
    expect(compactCloseout).toContain("does not claim bobcat or vermeer templates");
    expect(compactCloseout).toContain("no live production oem file or credentialed provider contract");
  });

  it("pins the YCENA parser source contract", () => {
    expect(compactParser).toContain("export function parseycenapricebooktext(text, options = {})");
    expect(compactParser).toContain("export function parseycenapricebookfile(path, options = {})");
    expect(compactParser).toContain("const supported_source_extensions = new set([\".pdf\", \".txt\"])");
    expect(compactParser).toContain("return execfilesync(\"pdftotext\", [\"-layout\", path, \"-\"]");
    expect(compactParser).toContain("if (!text || !text.trim()) throw new error(\"source text is empty\")");
    expect(compactParser).toContain("throw new error(`unsupported source extension:");
    expect(compactParser).toContain("if (args.discount < 0 || args.discount > 100) throw new error(\"--discount must be between 0 and 100\")");
    expect(compactParser).toContain("sourcefilename: basename(path)");
    expect(compactParser).toContain("sourcesha256: createhash(\"sha256\").update(bytes).digest(\"hex\")");
  });

  it("maps price-book rows to canonical parser targets with dealer-cost math", () => {
    expect(compactParser).toContain("parentoem: \"ycena\"");
    expect(compactParser).toContain("sourcetype: \"ycena_price_book_pdf_text\"");
    expect(compactParser).toContain("canonicaltargets: [\"equipment_base_codes\", \"equipment_options\", \"equipment_base_codes_import_runs\"]");
    expect(compactParser).toContain("function classifytarget(section)");
    expect(compactParser).toContain("return section === \"base\" ? \"equipment_base_codes\" : \"equipment_options\"");
    expect(compactParser).toContain("dealercostcents: math.round(listpricecents * (1 - dealerdiscountofflistpct / 100))");
    expect(compactParser).toContain("skipped.push({ page: pageindex + 1, line: normalizewhitespace(line), reason: \"unclassified_part_row\" })");
    expect(compactParser).toContain("effectivedate");
    expect(compactParser).toContain("pricingupdateddate");
    expect(compactParser).toContain("publisheddate");
  });

  it("pins parser regression coverage and fixture contents", () => {
    expect(compactParserTest).toContain("maps ycena base and option rows with 30 percent dealer cost");
    expect(compactParserTest).toContain("parsed.parentoem).tobe(\"ycena\")");
    expect(compactParserTest).toContain("targettable: \"equipment_base_codes\"");
    expect(compactParserTest).toContain("targettable: \"equipment_options\"");
    expect(compactParserTest).toContain("listpricecents: 5659800");
    expect(compactParserTest).toContain("dealercostcents: 3961860");
    expect(compactParserTest).toContain("reports unclassified part rows in skipped output");
    expect(compactParserTest).toContain("throws on empty extracted text");
    expect(compactParserTest).toContain("rejects unsupported source extension in file parser");
    expect(compactFixture).toContain("yanmar retail price book");
    expect(compactFixture).toContain("pricing effective: 04/15/2026");
    expect(compactFixture).toContain("tl25rp");
    expect(compactFixture).toContain("4004-227");
    expect(compactFixture).toContain("0405-229");
  });

  it("retains Bobcat and Vermeer external proof guardrails", () => {
    expect(compactDecisionPacket).toContain("authorized bobcat and/or vermeer sample files");
    expect(compactDecisionPacket).toContain("oem api contract and credentials");
    expect(compactDecisionPacket).toContain("no sample file or api contract exists");
    expect(compactDecisionPacket).toContain("no workbook status should change from this packet alone");
    expect(compactFixtureRegister).toContain("bobcat-base-options-fixture");
    expect(compactFixtureRegister).toContain("vermeer-base-options-fixture");
    expect(compactFixtureRegister).toContain("not supplied");
    expect(compactFixtureRegister).toContain("no bobcat parser/import promotion");
    expect(compactFixtureRegister).toContain("no vermeer parser/import promotion");
  });
});
