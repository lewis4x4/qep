import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const PART_NUMBER_RE = /^\s*(\d{4}-\d{3})\s+(.*?)\s+\$([\d,]+(?:\.\d{2})?)\s*$/;
const PART_PRICE_ONLY_RE = /^\s*(\d{4}-\d{3})\s+\$([\d,]+(?:\.\d{2})?)\s*$/;
const MODEL_HEADER_RE = /\b([A-Z]{1,4}-?\d{2,3}[A-Z0-9-]*)\b\s*$/;
const PRICE_BOOK_TITLE_RE = /\b(ASV|Yanmar) Retail Price Book\b/i;
const EFFECTIVE_RE = /Pricing Effective:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i;
const UPDATED_RE = /Pricing Updated:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i;
const PUBLISHED_RE = /Published:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i;

const SECTION_MARKERS = [
  ["standard configuration", "base"],
  ["factory installed options", "factory_option"],
  ["recommended bucket option", "recommended_bucket"],
  ["attachments", "attachment"],
  ["freight", "freight"],
];

function toIsoDate(mmddyyyy) {
  if (!mmddyyyy) return null;
  const [month, day, year] = mmddyyyy.split("/").map((part) => Number.parseInt(part, 10));
  if (!month || !day || !year) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match?.[1] ?? null;
}

function centsFromPrice(price) {
  const normalized = price.replace(/[$,\s]/g, "");
  const dollars = Number.parseFloat(normalized);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function categoryFromHeaderLine(line) {
  const withoutUrl = line.replace(/^.*?www\.[^\s]+\s*/i, "").trim();
  if (!withoutUrl || withoutUrl === line.trim()) return null;
  return normalizeWhitespace(withoutUrl);
}

function inferModelAndCategory(page) {
  const lines = page.split(/\r?\n/);
  for (let index = 0; index < Math.min(lines.length, 16); index += 1) {
    const line = lines[index] ?? "";
    if (!line.includes("1-800") && !line.includes("www.")) continue;
    const model = line.match(MODEL_HEADER_RE)?.[1] ?? null;
    if (!model) continue;

    const category = lines
      .slice(index, index + 5)
      .map(categoryFromHeaderLine)
      .find(Boolean) ?? null;
    return { model, category };
  }
  return { model: null, category: null };
}

function sectionForLine(line, currentSection) {
  const normalized = line.toLowerCase();
  for (const [marker, section] of SECTION_MARKERS) {
    if (normalized.includes(marker)) return section;
  }
  return currentSection;
}

function classifyTarget(section) {
  return section === "base" ? "equipment_base_codes" : "equipment_options";
}

export function parseYcenaPriceBookText(text, options = {}) {
  const brand = options.brand ?? firstMatch(text, PRICE_BOOK_TITLE_RE) ?? "YCENA";
  const dealerDiscountOffListPct = options.dealerDiscountOffListPct ?? 30;
  const effectiveDate = toIsoDate(firstMatch(text, EFFECTIVE_RE));
  const pricingUpdatedDate = toIsoDate(firstMatch(text, UPDATED_RE));
  const publishedDate = toIsoDate(firstMatch(text, PUBLISHED_RE));
  const pages = text.split("\f");
  const rows = [];
  const skipped = [];

  for (const [pageIndex, page] of pages.entries()) {
    const { model, category } = inferModelAndCategory(page);
    if (!model) continue;

    let currentSection = null;
    let pendingPrefix = null;
    const lines = page.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      currentSection = sectionForLine(line, currentSection);
      if (!currentSection) continue;

      const priceOnlyMatch = line.match(PART_PRICE_ONLY_RE);
      if (priceOnlyMatch) {
        const [, partNumber, listPrice] = priceOnlyMatch;
        const listPriceCents = centsFromPrice(listPrice);
        if (listPriceCents === null) {
          skipped.push({ page: pageIndex + 1, line: normalizeWhitespace(line), reason: "invalid_price" });
          continue;
        }
        rows.push({
          brand,
          parentOem: "YCENA",
          model,
          category,
          partNumber,
          description: pendingPrefix ?? "",
          section: currentSection,
          targetTable: classifyTarget(currentSection),
          effectiveDate,
          pricingUpdatedDate,
          publishedDate,
          listPriceCents,
          dealerDiscountOffListPct,
          dealerCostCents: Math.round(listPriceCents * (1 - dealerDiscountOffListPct / 100)),
          page: pageIndex + 1,
        });
        pendingPrefix = null;
        continue;
      }

      const match = line.match(PART_NUMBER_RE);
      if (match) {
        const [, partNumber, description, listPrice] = match;
        const listPriceCents = centsFromPrice(listPrice);
        if (listPriceCents === null) {
          skipped.push({ page: pageIndex + 1, line: normalizeWhitespace(line), reason: "invalid_price" });
          continue;
        }
        rows.push({
          brand,
          parentOem: "YCENA",
          model,
          category,
          partNumber,
          description: normalizeWhitespace(description),
          section: currentSection,
          targetTable: classifyTarget(currentSection),
          effectiveDate,
          pricingUpdatedDate,
          publishedDate,
          listPriceCents,
          dealerDiscountOffListPct,
          dealerCostCents: Math.round(listPriceCents * (1 - dealerDiscountOffListPct / 100)),
          page: pageIndex + 1,
        });
        pendingPrefix = null;
        continue;
      }

      if (/^[A-Za-z*]/.test(line) && !line.includes("List Price") && !line.includes("Part#")) {
        pendingPrefix = pendingPrefix ? `${pendingPrefix} ${normalizeWhitespace(line)}` : normalizeWhitespace(line);
      }
    }
  }

  const baseRows = rows.filter((row) => row.targetTable === "equipment_base_codes");
  const optionRows = rows.filter((row) => row.targetTable === "equipment_options");
  const uniqueModels = [...new Set(rows.map((row) => row.model))].sort();

  return {
    sourceType: "ycena_price_book_pdf_text",
    brand,
    parentOem: "YCENA",
    effectiveDate,
    pricingUpdatedDate,
    publishedDate,
    dealerDiscountOffListPct,
    canonicalTargets: ["equipment_base_codes", "equipment_options", "equipment_base_codes_import_runs"],
    summary: {
      rowCount: rows.length,
      baseRowCount: baseRows.length,
      optionRowCount: optionRows.length,
      skippedRowCount: skipped.length,
      modelCount: uniqueModels.length,
      models: uniqueModels,
    },
    rows,
    skipped,
  };
}

export function extractPdfText(path) {
  return execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readSourceText(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return extractPdfText(path);
  return readFileSync(path, "utf8");
}

function parseArgs(argv) {
  const args = { discount: 30, rows: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--brand") args.brand = argv[++index];
    else if (arg === "--discount") args.discount = Number.parseFloat(argv[++index]);
    else if (arg === "--rows") args.rows = true;
    else if (!args.path) args.path = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.path) throw new Error("Usage: node scripts/oem/ycena-price-book-parser.mjs <price-book.pdf|text> [--brand ASV|Yanmar] [--discount 30] [--rows]");
  if (!Number.isFinite(args.discount)) throw new Error("--discount must be a number");
  return args;
}

export function parseYcenaPriceBookFile(path, options = {}) {
  const bytes = readFileSync(path);
  const text = extname(path).toLowerCase() === ".pdf" ? extractPdfText(path) : bytes.toString("utf8");
  const parsed = parseYcenaPriceBookText(text, options);
  return {
    ...parsed,
    sourceFilename: basename(path),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    // Validate pdftotext early for clearer operator errors when parsing PDFs.
    const parsed = parseYcenaPriceBookFile(args.path, {
      brand: args.brand,
      dealerDiscountOffListPct: args.discount,
    });
    const output = args.rows ? parsed : { ...parsed, rows: undefined, skipped: undefined };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
