/**
 * Vendor price catalog parser — e.g. 2026-Yanmar-Parts-Price-File.xlsx.
 * Shape: PartNum, Description, List price, Product code, FR description.
 */

import { parseNumber, parseStr } from "./parts-import-types.ts";

type RawRow = Record<string, unknown>;

export interface VendorPriceParsed {
  part_number: string;
  description: string | null;
  description_fr: string | null;
  list_price: number | null;
  product_code: string | null;
  effective_date: string;
  raw: RawRow;
}

export function looksLikeVendorPriceFile(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  const hasPartnum = lower.some((h) => h.includes("partnum") || h === "part number");
  const hasPrice = lower.some((h) => h.includes("price"));
  return hasPartnum && hasPrice && headers.length < 15;
}

/** Infer the best "list price" column from a free-form vendor file. */
export function detectPriceColumn(headers: string[]): string | null {
  // Prefer a column that mentions a date or "list price"
  const prefer = headers.find((h) =>
    /list\s*price/i.test(h) && /\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(h)
  );
  if (prefer) return prefer;
  return headers.find((h) => /list\s*price/i.test(h)) ??
    headers.find((h) => /price/i.test(h)) ??
    null;
}

export function detectPartNumberColumn(headers: string[]): string | null {
  return headers.find((h) => /^partnum$/i.test(h.trim())) ??
    headers.find((h) => /^part\s*(number|num|no|#)?:?$/i.test(h.trim())) ??
    headers.find((h) => /part/i.test(h) && /num/i.test(h)) ??
    null;
}

export function parseVendorPriceRow(
  row: RawRow,
  opts: { part_number_col: string; price_col: string; effective_date: string },
): VendorPriceParsed | { error: string } {
  const partNumber = parseStr(row[opts.part_number_col]);
  if (!partNumber) return { error: "missing part_number" };

  return {
    part_number: partNumber,
    description:
      parseStr(row["Description"]) ??
      parseStr(row["description"]) ??
      parseStr(row["Desc"]),
    description_fr:
      parseStr(row["French canadian description"]) ??
      parseStr(row["FR description"]) ??
      null,
    list_price: parseNumber(row[opts.price_col]),
    product_code:
      parseStr(row["Product code"]) ??
      parseStr(row["Product Code"]) ??
      parseStr(row["product_code"]),
    effective_date: opts.effective_date,
    raw: row,
  };
}
