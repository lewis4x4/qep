import { listCrmOpenDealsForBoard } from "./qrm-api";
import type { QrmRepSafeDeal } from "./types";

export const OPEN_DEALS_PAGE_SIZE = 500;
export const HYDRATION_UPDATE_BATCH_PAGES = 10;
export const PIPELINE_CACHE_KEY = "qep-crm-open-deals-cache-v1";

export interface DealUrgencyState {
  isOverdueFollowUp: boolean;
  hasNoFollowUp: boolean;
  isStalled: boolean;
  hasDataIssue: boolean;
  needsAttention: boolean;
}

export interface CachedOpenDealsPayload {
  items: QrmRepSafeDeal[];
  nextCursor: string | null;
}

export interface OpenDealsFirstPageResult extends CachedOpenDealsPayload {
  fromCache: boolean;
}

export function formatMoney(value: number | null): string {
  if (value === null) {
    return "Amount TBD";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Invalid date";
  }

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getFollowUpSortTime(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

export function getFutureFollowUpIso(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString();
}

export function updateDealNextFollowUp(
  deals: QrmRepSafeDeal[] | null,
  dealId: string,
  nextFollowUpAt: string | null
): QrmRepSafeDeal[] | null {
  return deals?.map((deal) => (deal.id === dealId ? { ...deal, nextFollowUpAt } : deal)) ?? deals;
}

export function readCachedOpenDeals(): CachedOpenDealsPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PIPELINE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedOpenDealsPayload>;
    if (!Array.isArray(parsed.items)) {
      return null;
    }

    return {
      items: parsed.items as QrmRepSafeDeal[],
      nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : null,
    };
  } catch (error) {
    return null;
  }
}

export function writeCachedOpenDeals(payload: CachedOpenDealsPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PIPELINE_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore cache write failures; this is a best-effort resilience layer.
  }
}

export async function fetchOpenDealsFirstPage(): Promise<OpenDealsFirstPageResult> {
  try {
    const result = await listCrmOpenDealsForBoard({ limit: OPEN_DEALS_PAGE_SIZE });
    writeCachedOpenDeals({ items: result.items, nextCursor: result.nextCursor });
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      fromCache: false,
    };
  } catch (error) {
    const cached = readCachedOpenDeals();
    if (cached) {
      return {
        items: cached.items,
        nextCursor: cached.nextCursor,
        fromCache: true,
      };
    }
    throw error;
  }
}
