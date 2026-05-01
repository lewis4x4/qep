import type { Json } from "./database.types";

type JsonRecord = { [key: string]: Json | undefined };

export interface AssetBadgeData {
  open_work_orders: number;
  open_quotes: number;
  pending_parts_orders: number;
  overdue_intervals: number;
  trade_up_score: number;
  lifetime_parts_spend: number;
}

export const EMPTY_ASSET_BADGES: AssetBadgeData = {
  open_work_orders: 0,
  open_quotes: 0,
  pending_parts_orders: 0,
  overdue_intervals: 0,
  trade_up_score: 0,
  lifetime_parts_spend: 0,
};

function readNumber(value: Json | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isJsonRecord(value: Json | null): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAssetBadges(value: Json | null): AssetBadgeData {
  if (!isJsonRecord(value)) {
    return EMPTY_ASSET_BADGES;
  }

  return {
    open_work_orders: readNumber(value.open_work_orders),
    open_quotes: readNumber(value.open_quotes),
    pending_parts_orders: readNumber(value.pending_parts_orders),
    overdue_intervals: readNumber(value.overdue_intervals),
    trade_up_score: readNumber(value.trade_up_score),
    lifetime_parts_spend: readNumber(value.lifetime_parts_spend),
  };
}
