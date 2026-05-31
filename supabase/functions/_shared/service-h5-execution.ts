export const H5_PHOTO_PHASES = ["before", "during", "after"] as const;
export type H5PhotoPhase = typeof H5_PHOTO_PHASES[number];

export const H5_PHOTO_CATEGORIES = [
  "overall_condition",
  "hour_meter",
  "problem_area",
  "fluids",
  "failed_components",
  "fault_codes",
  "other",
] as const;
export type H5PhotoCategory = typeof H5_PHOTO_CATEGORIES[number];

export const H5_LABOR_STORY_FIELDS = [
  "labor_story",
  "labor_story_complaint_verification",
  "labor_story_diagnostic_steps",
  "labor_story_root_cause",
  "labor_story_parts_used",
  "labor_story_work_performed",
] as const;
export type H5LaborStoryField = typeof H5_LABOR_STORY_FIELDS[number];

export type H5OverrunStatus =
  | "not_evaluated"
  | "within_budget"
  | "overrun_unacknowledged"
  | "overrun_acknowledged";

export interface H5LaborStoryValidation {
  ok: boolean;
  missing: H5LaborStoryField[];
  fieldLengths: Record<H5LaborStoryField, number>;
}

export interface H5QuotedTimeOverrunInput {
  quotedLaborHours?: unknown;
  estimatedHours?: unknown;
  actualHours?: unknown;
  thresholdPct?: unknown;
  acknowledgedAt?: unknown;
}

export interface H5QuotedTimeOverrunResult {
  status: H5OverrunStatus;
  budgetHours: number | null;
  actualHours: number | null;
  thresholdPct: number;
  thresholdHours: number | null;
  overrunHours: number | null;
  overrunPct: number | null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function normalizeH5PhotoPhase(value: unknown): H5PhotoPhase | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (H5_PHOTO_PHASES as readonly string[]).includes(normalized)
    ? normalized as H5PhotoPhase
    : null;
}

export function normalizeH5PhotoCategory(value: unknown): H5PhotoCategory {
  if (typeof value !== "string") return "other";
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return (H5_PHOTO_CATEGORIES as readonly string[]).includes(normalized)
    ? normalized as H5PhotoCategory
    : "other";
}

export function validateH5LaborStory(
  input: Record<string, unknown>,
): H5LaborStoryValidation {
  const fieldLengths = Object.fromEntries(
    H5_LABOR_STORY_FIELDS.map((field) => [
      field,
      normalizeText(input[field]).length,
    ]),
  ) as Record<H5LaborStoryField, number>;

  const missing = H5_LABOR_STORY_FIELDS.filter((field) => {
    const min = field === "labor_story" ? 40 : 10;
    return fieldLengths[field] < min;
  });

  return { ok: missing.length === 0, missing, fieldLengths };
}

export function calculateQuotedTimeOverrun(
  input: H5QuotedTimeOverrunInput,
): H5QuotedTimeOverrunResult {
  const quoted = finiteNumber(input.quotedLaborHours);
  const estimated = finiteNumber(input.estimatedHours);
  const actual = finiteNumber(input.actualHours);
  const rawThreshold = finiteNumber(input.thresholdPct);
  const thresholdPct = rawThreshold === null ? 10 : Math.max(0, rawThreshold);
  const budget = quoted ?? estimated;

  if (budget === null || budget <= 0 || actual === null || actual < 0) {
    return {
      status: "not_evaluated",
      budgetHours: budget,
      actualHours: actual,
      thresholdPct,
      thresholdHours: null,
      overrunHours: null,
      overrunPct: null,
    };
  }

  const thresholdHours = round2(budget * (1 + thresholdPct / 100));
  if (actual <= thresholdHours) {
    return {
      status: "within_budget",
      budgetHours: budget,
      actualHours: actual,
      thresholdPct,
      thresholdHours,
      overrunHours: 0,
      overrunPct: 0,
    };
  }

  const status: H5OverrunStatus = normalizeText(input.acknowledgedAt).length > 0
    ? "overrun_acknowledged"
    : "overrun_unacknowledged";

  return {
    status,
    budgetHours: budget,
    actualHours: actual,
    thresholdPct,
    thresholdHours,
    overrunHours: round2(actual - budget),
    overrunPct: round4(((actual - budget) / budget) * 100),
  };
}
