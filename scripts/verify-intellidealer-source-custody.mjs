import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const ROOT = process.cwd();

const EXPECTED_FILES = [
  {
    path: "docs/IntelliDealer/CMASTR.pdf",
    sha256: "5743ecbe40fca1252b2ce24ca2c0c9cdb7bbe1b6794c6a19c3e227fa992e2335",
    bytes: 57336,
    pdf_pages: 3,
  },
  {
    path: "docs/IntelliDealer/Customer Master.xlsx",
    sha256: "ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5",
    bytes: 6820643,
    workbook_sheets: {
      MAST: { ref: "A1:CC5137", data_rows: 5136, columns: 81 },
      "Cust Contact Memos": { ref: "A1:F1180", data_rows: 1179, columns: 6 },
      "AR AGENCY": { ref: "A1:L19467", data_rows: 19466, columns: 12 },
      CONTACTS: { ref: "A1:EE4658", data_rows: 4657, columns: 135 },
      PROFITABILITY: { ref: "A1:AN9895", data_rows: 9894, columns: 40 },
    },
  },
  {
    path: "docs/IntelliDealer/CUST CONTACTS.pdf",
    sha256: "b47033a953f0a07da586daffae3068454e51eb7cbd43f2bc32bc21a4ef6923b1",
    bytes: 58556,
    pdf_pages: 4,
  },
  {
    path: "docs/IntelliDealer/CUST AR AGENCY.pdf",
    sha256: "263e6916f63c05e72e2e3dfb9792d39c84520a4da6e921f51959645100d5c508",
    bytes: 52788,
    pdf_pages: 1,
  },
  {
    path: "docs/IntelliDealer/CUST PROFITABILITY.pdf",
    sha256: "942156e91c868734b5fff4335cdc39080c573028b40447aee1448227bfdfa52f",
    bytes: 53609,
    pdf_pages: 1,
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function countPdfPages(buffer) {
  return [...buffer.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length;
}

function workbookSheetSummary(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return Object.fromEntries(workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const ref = sheet["!ref"];
    const range = ref ? XLSX.utils.decode_range(ref) : null;
    let nonEmptyRows = 0;
    if (range) {
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        let hasValue = false;
        for (let col = range.s.c; col <= range.e.c; col += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
          if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== "") {
            hasValue = true;
            break;
          }
        }
        if (hasValue) nonEmptyRows += 1;
      }
    }
    return [name, {
      ref,
      data_rows: Math.max(0, nonEmptyRows - 1),
      columns: range ? range.e.c - range.s.c + 1 : 0,
    }];
  }));
}

const checks = [];
const files = [];

for (const expected of EXPECTED_FILES) {
  const absolutePath = path.join(ROOT, expected.path);
  const buffer = readFileSync(absolutePath);
  const stat = statSync(absolutePath);
  const actual = {
    path: expected.path,
    bytes: stat.size,
    sha256: sha256(buffer),
  };

  checks.push({
    name: `${expected.path} size`,
    pass: actual.bytes === expected.bytes,
    expected: expected.bytes,
    actual: actual.bytes,
  });
  checks.push({
    name: `${expected.path} sha256`,
    pass: actual.sha256 === expected.sha256,
    expected: expected.sha256,
    actual: actual.sha256,
  });

  if (expected.pdf_pages !== undefined) {
    actual.pdf_pages = countPdfPages(buffer);
    checks.push({
      name: `${expected.path} pdf page count`,
      pass: actual.pdf_pages === expected.pdf_pages,
      expected: expected.pdf_pages,
      actual: actual.pdf_pages,
    });
  }

  if (expected.workbook_sheets) {
    actual.workbook_sheets = workbookSheetSummary(buffer);
    for (const [sheetName, expectedSheet] of Object.entries(expected.workbook_sheets)) {
      const actualSheet = actual.workbook_sheets[sheetName];
      checks.push({
        name: `${expected.path} sheet ${sheetName}`,
        pass: Boolean(actualSheet)
          && actualSheet.ref === expectedSheet.ref
          && actualSheet.data_rows === expectedSheet.data_rows
          && actualSheet.columns === expectedSheet.columns,
        expected: expectedSheet,
        actual: actualSheet ?? null,
      });
    }
  }

  files.push(actual);
}

const failed = checks.filter((check) => !check.pass);
const result = {
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  import_run_id: "df74305e-d37a-4e4b-be5e-457633b2cd1d",
  source_workbook_sha256: "ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5",
  files,
  failed,
};

console.log(JSON.stringify(result, null, 2));
if (failed.length > 0) process.exit(1);
