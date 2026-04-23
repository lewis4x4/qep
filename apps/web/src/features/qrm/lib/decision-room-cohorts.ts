/**
 * Decision Room — cohort classifier.
 *
 * Deterministic buckets across three dimensions:
 *   - Equipment type (from needs_assessment.machine_interest or deal
 *     name keyword)
 *   - Deal size (from qrm_deals.amount)
 *   - Rep tenure (from profiles.created_at — days since joining)
 *
 * Every deal + rep gets classified into one bucket per dimension.
 * Moves carry the cohort of the deal + rep they were made for, which
 * lets analytics segment "what works on compact track loader deals"
 * vs "what works on backhoe deals", or "what our 6-month hires try"
 * vs "what our veterans try", or any intersection.
 *
 * Pure TS. No DB calls. Unit-tested.
 */

export type EquipmentCohort =
  | "skid_steer"
  | "track_loader"
  | "excavator"
  | "backhoe"
  | "wheel_loader"
  | "telehandler"
  | "dozer"
  | "attachment"
  | "other_machine"
  | "unknown";

export type DealSizeCohort =
  | "small"
  | "mid"
  | "large"
  | "enterprise"
  | "unsized";

export type RepTenureCohort =
  | "new"
  | "emerging"
  | "established"
  | "veteran"
  | "unknown";

export interface CohortTags {
  equipment: EquipmentCohort;
  size: DealSizeCohort;
  tenure: RepTenureCohort;
}

export interface EquipmentDef {
  key: EquipmentCohort;
  label: string;
  keywords: string[];
}

export interface DealSizeDef {
  key: DealSizeCohort;
  label: string;
  minCents: number | null; // amount field is stored in whole dollars in this schema
  maxCents: number | null;
}

export interface RepTenureDef {
  key: RepTenureCohort;
  label: string;
  minDays: number | null;
  maxDays: number | null;
}

export const EQUIPMENT_COHORTS: EquipmentDef[] = [
  { key: "track_loader", label: "Compact Track Loaders", keywords: ["track loader", "compact track", "ctl", "mtl"] },
  { key: "skid_steer", label: "Skid Steer Loaders", keywords: ["skid steer", "skidsteer", "compact loader"] },
  { key: "excavator", label: "Excavators", keywords: ["excavator", "mini excavator", "mini ex"] },
  { key: "backhoe", label: "Backhoes", keywords: ["backhoe", "loader-backhoe"] },
  { key: "wheel_loader", label: "Wheel Loaders", keywords: ["wheel loader", "front loader", "front-end loader"] },
  { key: "telehandler", label: "Telehandlers", keywords: ["telehandler", "reach forklift", "rough terrain forklift"] },
  { key: "dozer", label: "Dozers", keywords: ["bulldozer", "dozer", "crawler dozer"] },
  { key: "attachment", label: "Attachments", keywords: ["bucket", "attachment", "hammer", "thumb", "grapple"] },
];

export const DEAL_SIZE_COHORTS: DealSizeDef[] = [
  { key: "small", label: "Small (< $75K)", minCents: 0, maxCents: 75_000 },
  { key: "mid", label: "Mid ($75K–$250K)", minCents: 75_000, maxCents: 250_000 },
  { key: "large", label: "Large ($250K–$750K)", minCents: 250_000, maxCents: 750_000 },
  { key: "enterprise", label: "Enterprise ($750K+)", minCents: 750_000, maxCents: null },
  { key: "unsized", label: "Unsized (no amount)", minCents: null, maxCents: null },
];

export const REP_TENURE_COHORTS: RepTenureDef[] = [
  { key: "new", label: "New (< 6 mo)", minDays: 0, maxDays: 180 },
  { key: "emerging", label: "Emerging (6–18 mo)", minDays: 180, maxDays: 540 },
  { key: "established", label: "Established (18 mo – 5 yr)", minDays: 540, maxDays: 1_825 },
  { key: "veteran", label: "Veteran (5 yr+)", minDays: 1_825, maxDays: null },
  { key: "unknown", label: "Unknown tenure", minDays: null, maxDays: null },
];

export function classifyEquipment(input: {
  machineInterest: string | null;
  dealName: string | null;
}): EquipmentCohort {
  const haystack = `${input.machineInterest ?? ""} ${input.dealName ?? ""}`.toLowerCase();
  if (!haystack.trim()) return "unknown";
  for (const def of EQUIPMENT_COHORTS) {
    if (def.keywords.some((kw) => haystack.includes(kw))) {
      return def.key;
    }
  }
  // A machine reference exists but none of our canonical buckets match.
  return input.machineInterest ? "other_machine" : "unknown";
}

export function classifyDealSize(amount: number | null): DealSizeCohort {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return "unsized";
  if (amount < 75_000) return "small";
  if (amount < 250_000) return "mid";
  if (amount < 750_000) return "large";
  return "enterprise";
}

export function classifyRepTenure(input: {
  profileCreatedAt: string | null;
  now?: Date;
}): RepTenureCohort {
  if (!input.profileCreatedAt) return "unknown";
  const parsed = Date.parse(input.profileCreatedAt);
  if (!Number.isFinite(parsed)) return "unknown";
  const now = input.now ?? new Date();
  const days = Math.floor((now.getTime() - parsed) / (24 * 60 * 60 * 1000));
  if (days < 0) return "unknown"; // clock skew
  if (days < 180) return "new";
  if (days < 540) return "emerging";
  if (days < 1_825) return "established";
  return "veteran";
}

export function classifyCohort(input: {
  machineInterest: string | null;
  dealName: string | null;
  dealAmount: number | null;
  profileCreatedAt: string | null;
  now?: Date;
}): CohortTags {
  return {
    equipment: classifyEquipment({
      machineInterest: input.machineInterest,
      dealName: input.dealName,
    }),
    size: classifyDealSize(input.dealAmount),
    tenure: classifyRepTenure({
      profileCreatedAt: input.profileCreatedAt,
      now: input.now,
    }),
  };
}

export interface CohortFilter {
  equipment: EquipmentCohort[];
  sizes: DealSizeCohort[];
  tenures: RepTenureCohort[];
}

export const EMPTY_COHORT_FILTER: CohortFilter = {
  equipment: [],
  sizes: [],
  tenures: [],
};

export function filterMatches(tags: CohortTags, filter: CohortFilter): boolean {
  if (filter.equipment.length > 0 && !filter.equipment.includes(tags.equipment)) return false;
  if (filter.sizes.length > 0 && !filter.sizes.includes(tags.size)) return false;
  if (filter.tenures.length > 0 && !filter.tenures.includes(tags.tenure)) return false;
  return true;
}

export function isEmptyFilter(filter: CohortFilter): boolean {
  return (
    filter.equipment.length === 0 &&
    filter.sizes.length === 0 &&
    filter.tenures.length === 0
  );
}

/** Compact, human-readable summary of a cohort tag set. Used on the
 *  Simulator page card + side-by-side comparison headers. */
export function describeCohort(tags: CohortTags): string {
  const parts: string[] = [];
  const eq = EQUIPMENT_COHORTS.find((d) => d.key === tags.equipment);
  if (eq) parts.push(eq.label);
  else if (tags.equipment === "other_machine") parts.push("Other machine");
  else parts.push("Unknown equipment");

  const sz = DEAL_SIZE_COHORTS.find((d) => d.key === tags.size);
  if (sz) parts.push(sz.label);

  const tn = REP_TENURE_COHORTS.find((d) => d.key === tags.tenure);
  if (tn && tags.tenure !== "unknown") parts.push(`${tn.label} rep`);

  return parts.join(" · ");
}
