import { startTransition, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { listCrmOpenDealsForBoard } from "../lib/crm-api";
import type { CrmRepSafeDeal } from "../lib/types";
import {
  HYDRATION_UPDATE_BATCH_PAGES,
  OPEN_DEALS_PAGE_SIZE,
  writeCachedOpenDeals,
  type OpenDealsFirstPageResult,
} from "../lib/pipeline-utils";

/**
 * Paginates open deals after the first query page into `hydratedDeals` for board/table views.
 */
export function useOpenDealsHydration(
  dealsQueryData: OpenDealsFirstPageResult | undefined,
  dealsQueryDataUpdatedAt: number,
): {
  hydratedDeals: CrmRepSafeDeal[] | null;
  setHydratedDeals: Dispatch<SetStateAction<CrmRepSafeDeal[] | null>>;
  isHydratingRemainingDeals: boolean;
  dealHydrationWarning: string | null;
  hydrationAttempt: number;
  setHydrationAttempt: Dispatch<SetStateAction<number>>;
} {
  const [hydratedDeals, setHydratedDeals] = useState<CrmRepSafeDeal[] | null>(null);
  const [isHydratingRemainingDeals, setIsHydratingRemainingDeals] = useState(false);
  const [dealHydrationWarning, setDealHydrationWarning] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);

  useEffect(() => {
    const firstPage = dealsQueryData;
    if (!firstPage) {
      setHydratedDeals(null);
      setIsHydratingRemainingDeals(false);
      setDealHydrationWarning(null);
      return;
    }

    let cancelled = false;
    const seenCursors = new Set<string>();
    let mergedItems = [...firstPage.items];
    setHydratedDeals(mergedItems);
    setDealHydrationWarning(null);

    if (firstPage.fromCache) {
      setIsHydratingRemainingDeals(false);
      return () => {
        cancelled = true;
      };
    }

    if (!firstPage.nextCursor) {
      setIsHydratingRemainingDeals(false);
      return () => {
        cancelled = true;
      };
    }

    setIsHydratingRemainingDeals(true);
    void (async () => {
      let cursor = firstPage.nextCursor;
      let pagesSinceLastUpdate = 0;

      while (cursor && !cancelled) {
        if (seenCursors.has(cursor)) {
          setDealHydrationWarning(
            "Stopped loading additional deals due to a pagination loop. Showing partial results.",
          );
          break;
        }
        seenCursors.add(cursor);

        try {
          const pageResult = await listCrmOpenDealsForBoard({
            limit: OPEN_DEALS_PAGE_SIZE,
            cursor,
          });
          mergedItems = [...mergedItems, ...pageResult.items];
          pagesSinceLastUpdate += 1;
          if (!cancelled && (pagesSinceLastUpdate >= HYDRATION_UPDATE_BATCH_PAGES || !pageResult.nextCursor)) {
            const snapshot = mergedItems;
            startTransition(() => {
              setHydratedDeals(snapshot);
            });
            pagesSinceLastUpdate = 0;
          }
          cursor = pageResult.nextCursor;
        } catch {
          if (!cancelled) {
            setDealHydrationWarning("Could not load all deal pages. Showing partial results.");
          }
          break;
        }
      }

      if (!cancelled) {
        writeCachedOpenDeals({ items: mergedItems, nextCursor: null });
        setIsHydratingRemainingDeals(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dealsQueryData, dealsQueryDataUpdatedAt, hydrationAttempt]);

  return {
    hydratedDeals,
    setHydratedDeals,
    isHydratingRemainingDeals,
    dealHydrationWarning,
    hydrationAttempt,
    setHydrationAttempt,
  };
}
