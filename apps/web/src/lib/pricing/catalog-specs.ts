export interface CatalogStructuredSpec {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  category: string | null;
  priority: number;
  source: "qb_equipment_models.specs";
}

export interface CatalogSpecsProjection {
  structuredSpecs: CatalogStructuredSpec[];
  specBullets: string[];
  searchText: string;
}

const DEFAULT_MAX_SPECS = 16;
const DEFAULT_MAX_BULLETS = 8;
const MAX_SPEC_VALUE_LENGTH = 120;
const SOURCE = "qb_equipment_models.specs" as const;

const FREE_TEXT_KEYS = new Set([
  "ai_summary",
  "bullets",
  "comments",
  "description",
  "free_text",
  "notes",
  "raw_text",
  "summary",
]);

const PRIORITY_RULES: Array<{ match: RegExp; priority: number; label?: string; unit?: string }> = [
  { match: /(^|_)horsepower$|(^|_)hp$/, priority: 10, label: "Horsepower", unit: "HP" },
  { match: /operating_weight|weight(_lbs?|$)/, priority: 20, label: "Operating weight", unit: "lb" },
  { match: /hydraulic_flow|flow_gpm/, priority: 30, label: "Hydraulic flow", unit: "GPM" },
  { match: /hydraulic_pressure|pressure_psi|(^|_)pressure$/, priority: 40, label: "Pressure", unit: "PSI" },
  { match: /rated_operating_capacity|operating_capacity|lift_capacity/, priority: 50, label: "Operating capacity", unit: "lb" },
  { match: /(^|_)width(_in|$)/, priority: 60, label: "Width", unit: "in" },
  { match: /(^|_)height(_in|$)/, priority: 70, label: "Height", unit: "in" },
  { match: /(^|_)length(_in|$)/, priority: 80, label: "Length", unit: "in" },
  { match: /fuel_capacity|tank_capacity/, priority: 90, label: "Fuel capacity", unit: "gal" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isFreeTextKey(key: string): boolean {
  return FREE_TEXT_KEYS.has(normalizeKey(key));
}

function humanizeKey(key: string): string {
  const normalized = normalizeKey(key)
    .replace(/_(lbs?|gpm|psi|hp|in|gal)$/i, "")
    .replace(/\bhp\b/g, "horsepower");
  return normalized
    .split("_")
    .filter(Boolean)
    .map((word, index) => {
      if (word === "rpm") return "RPM";
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

function priorityForKey(key: string): { priority: number; label?: string; unit?: string } {
  const normalized = normalizeKey(key);
  return PRIORITY_RULES.find((rule) => rule.match.test(normalized)) ?? { priority: 500 };
}

function inferredUnitForKey(key: string): string | null {
  const normalized = normalizeKey(key);
  const priorityUnit = priorityForKey(normalized).unit;
  if (priorityUnit) return priorityUnit;
  if (/(^|_)lbs?$/.test(normalized)) return "lb";
  if (/(^|_)gpm$/.test(normalized)) return "GPM";
  if (/(^|_)psi$/.test(normalized)) return "PSI";
  if (/(^|_)hp$/.test(normalized)) return "HP";
  if (/(^|_)in$/.test(normalized)) return "in";
  return null;
}

function displayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const text = value.trim().replace(/\s+/g, " ");
    if (!text || text.length > MAX_SPEC_VALUE_LENGTH) return null;
    return text;
  }
  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const text = displayValue(item);
      return text ? [text] : [];
    });
    const joined = items.join(", ");
    return joined && joined.length <= MAX_SPEC_VALUE_LENGTH ? joined : null;
  }
  return null;
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function makeSpec(
  rawKey: string,
  rawValue: unknown,
  options: { label?: string | null; unit?: string | null; category?: string | null } = {},
): CatalogStructuredSpec | null {
  if (!rawKey || isFreeTextKey(rawKey)) return null;
  const value = displayValue(rawValue);
  if (!value) return null;

  const normalizedKey = normalizeKey(rawKey);
  const priority = priorityForKey(normalizedKey);
  const unit = options.unit ?? inferredUnitForKey(normalizedKey);
  const label = options.label?.trim() || priority.label || humanizeKey(normalizedKey);
  if (!label) return null;

  return {
    key: normalizedKey,
    label,
    value,
    unit: unit?.trim() || null,
    category: options.category?.trim() || null,
    priority: priority.priority,
    source: SOURCE,
  };
}

function looksLikeValueRecord(record: Record<string, unknown>): boolean {
  return "value" in record || "amount" in record;
}

function shouldDescendIntoSpecField(key: string): boolean {
  const normalized = normalizeKey(key);
  return !isFreeTextKey(normalized) && !["key", "label", "name", "title", "unit", "units", "uom", "category", "group"].includes(normalized);
}

function specFromValueRecord(record: Record<string, unknown>, path: string[]): CatalogStructuredSpec | null {
  const rawKey = stringValue(record, "key", "name", "id") ?? path[path.length - 1] ?? stringValue(record, "label");
  const rawValue = "value" in record ? record.value : "amount" in record ? record.amount : null;
  const label = stringValue(record, "label", "title") ?? (rawKey ? humanizeKey(rawKey) : null);
  const unit = stringValue(record, "unit", "units", "uom");
  const category = stringValue(record, "category", "group") ?? (path.length > 1 ? humanizeKey(path[path.length - 2]) : null);
  return rawKey ? makeSpec(rawKey, rawValue, { label, unit, category }) : null;
}

function collectSpecs(value: unknown, path: string[], out: CatalogStructuredSpec[], depth = 0): void {
  if (depth > 3 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) {
        if (looksLikeValueRecord(item)) {
          const spec = specFromValueRecord(item, path);
          if (spec) out.push(spec);
        } else {
          collectSpecs(item, path, out, depth + 1);
        }
      }
    }
    return;
  }

  if (!isRecord(value)) {
    const spec = makeSpec(path[path.length - 1] ?? "value", value, {
      category: path.length > 1 ? humanizeKey(path[path.length - 2]) : null,
    });
    if (spec) out.push(spec);
    return;
  }

  if (looksLikeValueRecord(value) && ("value" in value || "amount" in value)) {
    const spec = specFromValueRecord(value, path);
    if (spec) out.push(spec);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (!shouldDescendIntoSpecField(key)) continue;
    const childPath = [...path, key];
    if (isRecord(child) || Array.isArray(child)) {
      collectSpecs(child, childPath, out, depth + 1);
    } else {
      const spec = makeSpec(key, child, {
        category: path.length > 0 ? humanizeKey(path[path.length - 1]!) : null,
      });
      if (spec) out.push(spec);
    }
  }
}

function sortAndDedupe(specs: CatalogStructuredSpec[]): CatalogStructuredSpec[] {
  const seen = new Set<string>();
  return specs
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
    .filter((spec) => {
      const dedupeKey = [spec.key, spec.value.toLowerCase(), spec.unit?.toLowerCase() ?? ""].join("|");
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
}

export function formatCatalogStructuredSpec(spec: CatalogStructuredSpec): string {
  const hasUnit = spec.unit && !spec.value.toLowerCase().endsWith(spec.unit.toLowerCase());
  return `${spec.label}: ${spec.value}${hasUnit ? ` ${spec.unit}` : ""}`;
}

export function projectCatalogSpecs(
  specs: unknown,
  options: { maxSpecs?: number; maxBullets?: number } = {},
): CatalogSpecsProjection {
  const collected: CatalogStructuredSpec[] = [];
  if (isRecord(specs) || Array.isArray(specs)) {
    collectSpecs(specs, [], collected);
  }

  const structuredSpecs = sortAndDedupe(collected).slice(0, options.maxSpecs ?? DEFAULT_MAX_SPECS);
  const specBullets = structuredSpecs
    .map(formatCatalogStructuredSpec)
    .slice(0, options.maxBullets ?? DEFAULT_MAX_BULLETS);
  const searchText = structuredSpecs
    .flatMap((spec) => [spec.key, spec.label, spec.value, spec.unit, spec.category])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return { structuredSpecs, specBullets, searchText };
}

export function hasMeaningfulCatalogSpecs(value: unknown): boolean {
  return projectCatalogSpecs(value, { maxSpecs: 1, maxBullets: 1 }).structuredSpecs.length > 0;
}

export function canonicalizeCatalogSpecsForDiff(value: unknown): unknown | null {
  const projection = projectCatalogSpecs(value, { maxSpecs: Number.MAX_SAFE_INTEGER, maxBullets: 0 });
  if (projection.structuredSpecs.length === 0) return null;
  return projection.structuredSpecs.map(({ key, label, value: specValue, unit, category }) => ({
    key,
    label,
    value: specValue,
    unit,
    category,
  }));
}
