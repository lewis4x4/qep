import type { UserRole } from "./dge-auth.ts";

export const RESTRICTED_EQUIPMENT_FINANCIAL_FIELDS = [
  "purchasePrice",
  "currentMarketValue",
  "replacementCost",
  "dailyRentalRate",
  "weeklyRentalRate",
  "monthlyRentalRate",
] as const;

export const RESTRICTED_EQUIPMENT_FINANCIAL_COLUMNS = [
  "purchase_price",
  "current_market_value",
  "replacement_cost",
  "daily_rental_rate",
  "weekly_rental_rate",
  "monthly_rental_rate",
] as const;

export interface EquipmentFinancialAccessCaller {
  isServiceRole: boolean;
  role: UserRole | null;
}

export function canAccessEquipmentFinancials(
  caller: EquipmentFinancialAccessCaller,
): boolean {
  return caller.isServiceRole ||
    caller.role === "admin" ||
    caller.role === "manager" ||
    caller.role === "owner";
}

export function hasRestrictedEquipmentFinancialPayload(
  payload: Partial<Record<(typeof RESTRICTED_EQUIPMENT_FINANCIAL_FIELDS)[number], unknown>>,
): boolean {
  return RESTRICTED_EQUIPMENT_FINANCIAL_FIELDS.some((field) => payload[field] !== undefined);
}
