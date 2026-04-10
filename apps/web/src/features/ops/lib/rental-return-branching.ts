import type { Json } from "@/lib/database.types";

export interface ReturnInspectionItem {
  item: string;
  completed: boolean;
}

export const DEFAULT_RETURN_CHECKLIST: ReturnInspectionItem[] = [
  { item: "Inspect exterior condition", completed: false },
  { item: "Inspect tires, tracks, and attachment wear", completed: false },
  { item: "Capture condition photo evidence", completed: false },
  { item: "Record hour meter and return notes", completed: false },
];

export function normalizeReturnChecklist(value: Json | null | undefined): ReturnInspectionItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_RETURN_CHECKLIST;
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return DEFAULT_RETURN_CHECKLIST[index] ?? { item: `Inspection step ${index + 1}`, completed: false };
    }
    return {
      item: String((entry as { item?: unknown }).item ?? DEFAULT_RETURN_CHECKLIST[index]?.item ?? `Inspection step ${index + 1}`),
      completed: Boolean((entry as { completed?: unknown }).completed),
    };
  });
}

export function serializeReturnChecklist(items: ReturnInspectionItem[]): Json {
  return items.map((item) => ({
    item: item.item,
    completed: item.completed,
  }));
}

export function updateReturnChecklistItem(
  items: ReturnInspectionItem[],
  itemLabel: string,
  completed: boolean,
): ReturnInspectionItem[] {
  return items.map((item) => (item.item === itemLabel ? { ...item, completed } : item));
}

export function inspectionComplete(items: ReturnInspectionItem[], photoCount: number): boolean {
  return items.every((item) => item.completed) && photoCount > 0;
}

export function computeDamageAssessment(
  chargeAmount: number | null | undefined,
  depositAmount: number | null | undefined,
): { depositCoversCharges: boolean | null; balanceDue: number | null } {
  if (chargeAmount == null) {
    return { depositCoversCharges: null, balanceDue: null };
  }

  const safeCharge = Number(chargeAmount) || 0;
  const safeDeposit = Number(depositAmount) || 0;
  const balanceDue = Math.max(safeCharge - safeDeposit, 0);

  return {
    depositCoversCharges: safeDeposit >= safeCharge,
    balanceDue,
  };
}

export function refundMethodMatchesOriginal(
  originalMethod: string | null | undefined,
  refundMethod: string | null | undefined,
): boolean {
  if (!originalMethod || !refundMethod) return false;
  return originalMethod === refundMethod;
}
