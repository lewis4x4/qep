import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, "docs/intellidealer-gap-audit");
const DATABASE_TYPES_PATH = path.join(ROOT, "apps/web/src/lib/database.types.ts");

const PHASES = [
  { phase: "Phase-1_CRM", file: "phase-1-crm.yaml", pdf: 3, png: 10, ocr: 13 },
  { phase: "Phase-2_Sales-Intelligence", file: "phase-2-sales-intelligence.yaml", pdf: 5, png: 40, ocr: 43 },
  { phase: "Phase-3_Parts", file: "phase-3-parts.yaml", pdf: 5, png: 30, ocr: 35 },
  { phase: "Phase-4_Service", file: "phase-4-service.yaml", pdf: 8, png: 36, ocr: 44 },
  { phase: "Phase-5_Deal-Genome", file: "phase-5-deal-genome.yaml", pdf: 1, png: 9, ocr: 11 },
  { phase: "Phase-6_Rental", file: "phase-6-rental.yaml", pdf: 1, png: 0, ocr: 1 },
  { phase: "Phase-8_Financial-Operations", file: "phase-8-financial-operations.yaml", pdf: 7, png: 16, ocr: 23 },
  { phase: "Phase-9_Advanced-Intelligence", file: "phase-9-advanced-intelligence.yaml", pdf: 1, png: 0, ocr: 1 },
  { phase: "Cross-Cutting", file: "cross-cutting.yaml", pdf: 2, png: 9, ocr: 13 },
];

const PLACEHOLDER_COLUMNS = new Set([
  "",
  "null",
  "(new table)",
  "(new view)",
  "(computed)",
  "(view)",
  "(multiple)",
  "(derived)",
]);

function cleanYamlValue(raw) {
  if (raw == null) return "";
  let value = raw.trim();
  const quoted = value.startsWith('"') || value.startsWith("'");
  const hashIndex = quoted ? -1 : value.indexOf(" #");
  if (hashIndex >= 0) value = value.slice(0, hashIndex).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

function normalizeTableName(raw) {
  let value = cleanYamlValue(raw);
  if (!value || value === "null") return "";
  value = value.replace(/^\(new\)\s+/, "");
  value = value.replace(/^\(new\)\s*/, "");
  value = value.replace(/^\(existing\)\s+/, "");
  if (value.includes(" ")) return "";
  return value;
}

function normalizeColumnName(raw) {
  const value = cleanYamlValue(raw);
  if (!value || PLACEHOLDER_COLUMNS.has(value)) return "";
  if (value.includes(" ") || value.includes(",") || value.includes("/")) return "";
  return value;
}

function parseDatabaseTypes(source) {
  const relations = new Map();
  let section = null;
  let relation = null;
  let inRow = false;

  for (const line of source.split("\n")) {
    if (/^    Tables: \{/.test(line)) {
      section = "Tables";
      relation = null;
      inRow = false;
      continue;
    }
    if (/^    Views: \{/.test(line)) {
      section = "Views";
      relation = null;
      inRow = false;
      continue;
    }
    if (section && /^    (Functions|Enums|CompositeTypes): \{/.test(line)) {
      section = null;
      relation = null;
      inRow = false;
      continue;
    }
    if (!section) continue;

    const relationMatch = line.match(/^      ([A-Za-z0-9_]+): \{$/);
    if (relationMatch) {
      relation = relationMatch[1];
      inRow = false;
      relations.set(relation, { kind: section, columns: new Set() });
      continue;
    }
    if (!relation) continue;
    if (/^        Row: \{/.test(line)) {
      inRow = true;
      continue;
    }
    if (inRow && /^        \}/.test(line)) {
      inRow = false;
      continue;
    }
    if (inRow) {
      const columnMatch = line.match(/^          ([A-Za-z0-9_]+):( |$)/);
      if (columnMatch) relations.get(relation)?.columns.add(columnMatch[1]);
    }
  }

  return relations;
}

function parseField(block, phase, file) {
  const read = (key) => {
    const indent = key === "id" ? "  - " : "    ";
    const match = block.match(new RegExp(`^${indent}${key}:\\s*(.*)$`, "m"));
    return match ? cleanYamlValue(match[1]) : "";
  };
  return {
    phase,
    file,
    block,
    id: read("id"),
    label: read("intellidealer_label"),
    screen: read("intellidealer_screen"),
    severity: read("severity"),
    category: read("category"),
    qepStatus: read("qep_status"),
    qepTableRaw: read("qep_table"),
    qepColumnRaw: read("qep_column"),
    qepTable: normalizeTableName(read("qep_table")),
    qepColumn: normalizeColumnName(read("qep_column")),
    purpose: readBlockScalar(block, "intellidealer_purpose"),
    gapNotes: readBlockScalar(block, "qep_gap_notes"),
    dependencies: readInlineOrList(block, "dependencies"),
    migrationHintFirstSql: firstMigrationSql(block),
  };
}

function readBlockScalar(block, key) {
  const lines = block.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`    ${key}:`));
  if (index < 0) return "";
  const first = lines[index].replace(new RegExp(`^    ${key}:\\s*`), "");
  if (first && first !== "|") return cleanYamlValue(first);
  const out = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    if (/^    [A-Za-z0-9_]+:/.test(lines[i])) break;
    out.push(lines[i].replace(/^      ?/, ""));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function readInlineOrList(block, key) {
  const lines = block.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`    ${key}:`));
  if (index < 0) return "";
  const first = lines[index].replace(new RegExp(`^    ${key}:\\s*`), "").trim();
  if (first.startsWith("[") && first.endsWith("]")) return first.slice(1, -1).trim();
  if (first && first !== "|") return cleanYamlValue(first);
  const out = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    if (/^    [A-Za-z0-9_]+:/.test(lines[i])) break;
    const match = lines[i].match(/^      -\s+(.*)$/);
    if (match) out.push(cleanYamlValue(match[1]));
  }
  return out.join(", ");
}

function firstMigrationSql(block) {
  const value = readBlockScalar(block, "migration_hint");
  return value.split(";")[0].trim();
}

function splitYamlFields(source) {
  const starts = [...source.matchAll(/^  - id:/gm)].map((match) => match.index ?? 0);
  if (starts.length === 0) return { prefix: source, fields: [] };
  const fields = starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
  return { prefix: source.slice(0, starts[0]), fields };
}

function canAutoBuild(field, relations) {
  if (!field.qepTable) return null;
  const relation = relations.get(field.qepTable);
  if (!relation) return null;
  if (field.qepStatus === "BUILT" && hasQepEvidence(field.block)) return null;
  if (!field.qepColumn) return { relation, evidence: `apps/web/src/lib/database.types.ts public.${relation.kind}.${field.qepTable}` };
  if (!relation.columns.has(field.qepColumn)) return null;
  return {
    relation,
    evidence: `apps/web/src/lib/database.types.ts public.${relation.kind}.${field.qepTable}.${field.qepColumn}`,
  };
}

function hasQepEvidence(block) {
  const evidenceLine = block.match(/^    qep_evidence:\s*(.*)$/m);
  if (!evidenceLine) return false;
  if (evidenceLine[1]?.trim() === "[]") return false;
  const afterEvidence = block.slice(evidenceLine.index ?? 0).split("\n").slice(1);
  for (const line of afterEvidence) {
    if (/^    [A-Za-z0-9_]+:/.test(line)) return false;
    if (/^      -\s+/.test(line)) return true;
  }
  return false;
}

function replaceYamlSection(block, key, replacementLines) {
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`    ${key}:`));
  if (start < 0) {
    const gapNotesIndex = lines.findIndex((line) => line.startsWith("    qep_gap_notes:"));
    const insertAt = gapNotesIndex >= 0 ? gapNotesIndex : lines.findIndex((line) => line.startsWith("    severity:"));
    if (insertAt < 0) return block;
    return [...lines.slice(0, insertAt), ...replacementLines, ...lines.slice(insertAt)].join("\n");
  }
  let end = start + 1;
  while (end < lines.length && !/^    [A-Za-z0-9_]+:/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...replacementLines, ...lines.slice(end)].join("\n");
}

function updateFieldBlock(field, buildInfo) {
  let block = field.block.replace(/^    qep_status:\s*["']?(MISSING|PARTIAL)["']?\s*$/m, "    qep_status: BUILT");
  block = replaceYamlSection(block, "qep_evidence", [
    "    qep_evidence:",
    `      - "${buildInfo.evidence}"`,
  ]);
  block = replaceYamlSection(block, "qep_gap_notes", [
    `    qep_gap_notes: "Resolved by shipped IntelliDealer gap-audit migration; current Database type contains ${field.qepColumn ? `${field.qepTable}.${field.qepColumn}` : field.qepTable}."`,
  ]);
  return block;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function yamlScalar(value) {
  if (value == null || value === "") return "''";
  return JSON.stringify(String(value));
}

const relations = parseDatabaseTypes(readFileSync(DATABASE_TYPES_PATH, "utf8"));
const allFields = [];
const updated = [];

for (const phase of PHASES) {
  const phasePath = path.join(AUDIT_DIR, phase.file);
  const original = readFileSync(phasePath, "utf8");
  const { prefix, fields } = splitYamlFields(original);
  const updatedBlocks = [];

  for (const block of fields) {
    const field = parseField(block, phase.phase, phase.file);
    const buildInfo = canAutoBuild(field, relations);
    const nextBlock = buildInfo ? updateFieldBlock(field, buildInfo) : block;
    const nextField = parseField(nextBlock, phase.phase, phase.file);
    allFields.push(nextField);
    if (buildInfo) updated.push({ ...nextField, evidence: buildInfo.evidence });
    updatedBlocks.push(nextBlock);
  }

  writeFileSync(phasePath, `${prefix}\n${updatedBlocks.join("")}`, "utf8");
}

const phases = PHASES.map((phase) => {
  const fields = allFields.filter((field) => field.phase === phase.phase);
  return {
    ...phase,
    fields,
    fieldCount: fields.length,
    mustCount: fields.filter((field) => field.severity === "must").length,
    mustMissingCount: fields.filter((field) => field.severity === "must" && field.qepStatus === "MISSING").length,
    statusMissingCount: fields.filter((field) => field.qepStatus === "MISSING").length,
    statusPartialCount: fields.filter((field) => field.qepStatus === "PARTIAL").length,
    statusBuiltCount: fields.filter((field) => field.qepStatus === "BUILT").length,
  };
});

const totals = {
  phases: PHASES.length,
  totalFields: allFields.length,
  severityMust: allFields.filter((field) => field.severity === "must").length,
  severityShould: allFields.filter((field) => field.severity === "should").length,
  severityCould: allFields.filter((field) => field.severity === "could").length,
  qepStatusMissing: allFields.filter((field) => field.qepStatus === "MISSING").length,
  qepStatusPartial: allFields.filter((field) => field.qepStatus === "PARTIAL").length,
  qepStatusBuilt: allFields.filter((field) => field.qepStatus === "BUILT").length,
};
const blockers = allFields
  .filter((field) => field.severity === "must" && field.qepStatus === "MISSING")
  .sort((a, b) => {
    const categoryRank = { regulatory: 1, financial: 2, operational: 3, workflow: 4, reporting: 5, nice_to_have: 6 };
    return (categoryRank[a.category] ?? 99) - (categoryRank[b.category] ?? 99) || a.phase.localeCompare(b.phase) || a.id.localeCompare(b.id);
  });

const manifest = [
  "manifest_version: '1.0'",
  "generated_at: '2026-05-03T00:00:00Z'",
  'description: "IntelliDealer -> QEP Gap Audit - regenerated from phase YAMLs after shipped wave reconciliation"',
  "phases:",
  ...phases.flatMap((phase) => [
    `- phase: ${phase.phase}`,
    `  yaml_path: docs/intellidealer-gap-audit/${phase.file}`,
    `  field_count: ${phase.fieldCount}`,
    `  must_count: ${phase.mustCount}`,
    `  must_missing_count: ${phase.mustMissingCount}`,
    `  qep_status_missing: ${phase.statusMissingCount}`,
    `  qep_status_partial: ${phase.statusPartialCount}`,
    `  qep_status_built: ${phase.statusBuiltCount}`,
    `  pdf_count: ${phase.pdf}`,
    `  png_count: ${phase.png}`,
    `  ocr_count: ${phase.ocr}`,
  ]),
  "totals:",
  `  phases: ${totals.phases}`,
  `  total_fields: ${totals.totalFields}`,
  `  severity_must: ${totals.severityMust}`,
  `  severity_should: ${totals.severityShould}`,
  `  severity_could: ${totals.severityCould}`,
  `  qep_status_missing: ${totals.qepStatusMissing}`,
  `  qep_status_partial: ${totals.qepStatusPartial}`,
  `  qep_status_built: ${totals.qepStatusBuilt}`,
  `  must_fix_blocker_count: ${blockers.length}`,
  "must_fix_blockers:",
  ...blockers.flatMap((field) => [
    `- phase: ${field.phase}`,
    `  id: ${field.id}`,
    `  label: ${yamlScalar(field.label)}`,
    `  category: ${field.category}`,
    `  qep_table: ${yamlScalar(field.qepTableRaw)}`,
  ]),
  "",
].join("\n");

writeFileSync(path.join(AUDIT_DIR, "manifest.yaml"), manifest, "utf8");

const csvRows = [
  [
    "priority_sort",
    "phase",
    "category",
    "severity",
    "qep_status",
    "field_id",
    "intellidealer_label",
    "intellidealer_screen",
    "qep_table",
    "qep_column",
    "purpose",
    "gap_notes",
    "dependencies",
    "migration_hint_first_sql",
  ].map(csvCell).join(","),
  ...blockers.map((field) => [
    field.category === "regulatory" ? 1 : field.category === "financial" ? 2 : field.category === "operational" ? 3 : 4,
    field.phase,
    field.category,
    field.severity,
    field.qepStatus,
    field.id,
    field.label,
    field.screen,
    field.qepTableRaw,
    field.qepColumnRaw,
    field.purpose,
    field.gapNotes,
    field.dependencies,
    field.migrationHintFirstSql,
  ].map(csvCell).join(",")),
];

writeFileSync(path.join(AUDIT_DIR, "_blockers.csv"), `${csvRows.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  updated_fields: updated.length,
  totals,
  must_fix_blocker_count: blockers.length,
  updated_by_phase: Object.fromEntries(PHASES.map((phase) => [
    phase.phase,
    updated.filter((field) => field.phase === phase.phase).length,
  ])),
}, null, 2));
