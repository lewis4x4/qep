import type { Json } from "@/lib/database.types";

export interface IntakeCardRecord {
  id: string;
  current_stage: number;
  stock_number: string | null;
  ship_to_branch: string | null;
  arrival_photos: Json | null;
  pdi_checklist: Json | null;
  pdi_completed: boolean | null;
  photo_ready: boolean | null;
  listing_photos: Json | null;
  crm_equipment?:
    | {
        name?: string | null;
      }
    | Array<{
        name?: string | null;
      }>
    | null;
}

export interface StageGateResult {
  allowed: boolean;
  reason: string | null;
}

function asArray(value: Json | null | undefined): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getEquipmentLabel(record: IntakeCardRecord): string {
  const equipment = Array.isArray(record.crm_equipment)
    ? record.crm_equipment[0]
    : record.crm_equipment;
  return equipment?.name?.trim() || "Equipment intake";
}

export function getPhotoCount(record: IntakeCardRecord): number {
  return asArray(record.arrival_photos).length + asArray(record.listing_photos).length;
}

export function getChecklistProgress(record: IntakeCardRecord): { completed: number; total: number } {
  const checklist = asArray(record.pdi_checklist);
  const completed = checklist.filter((entry) =>
    entry &&
    typeof entry === "object" &&
    "status" in entry &&
    ["pass", "fail", "skip"].includes(String((entry as { status?: unknown }).status))
  ).length;

  return {
    completed,
    total: checklist.length,
  };
}

export function validateIntakeStageAdvance(
  record: IntakeCardRecord,
  targetStage: number,
): StageGateResult {
  if (targetStage === record.current_stage) {
    return { allowed: true, reason: null };
  }

  if (targetStage < 1 || targetStage > 8) {
    return { allowed: false, reason: "Target stage is outside the intake pipeline." };
  }

  if (record.current_stage === 2 && targetStage > 2 && getPhotoCount({ ...record, listing_photos: null }) === 0) {
    return { allowed: false, reason: "Arrival photos are required before moving past Equipment Arrival." };
  }

  if (record.current_stage === 3 && targetStage > 3 && !record.pdi_completed) {
    return { allowed: false, reason: "PDI must be completed before moving past PDI Completion." };
  }

  if (record.current_stage === 5 && targetStage > 5 && !record.photo_ready) {
    return { allowed: false, reason: "Photo readiness must be confirmed before moving into Online Listing." };
  }

  if (record.current_stage === 6 && targetStage > 6 && asArray(record.listing_photos).length === 0) {
    return { allowed: false, reason: "Listing photos are required before the unit can move beyond Online Listing." };
  }

  return { allowed: true, reason: null };
}
