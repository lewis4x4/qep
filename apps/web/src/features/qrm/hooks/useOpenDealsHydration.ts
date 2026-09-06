import { startTransition, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { listCrmDealStages, listCrmOpenDealsForBoard } from "../lib/qrm-api";
import type { QrmRepSafeDeal } from "../lib/types";
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
  cacheScope?: string,
): {
  hydratedDeals: QrmRepSafeDeal[] | null;
  setHydratedDeals: Dispatch<SetStateAction<QrmRepSafeDeal[] | null>>;
  isHydratingRemainingDeals: boolean;
  dealHydrationWarning: string | null;
  hydrationAttempt: number;
  setHydrationAttempt: Dispatch<SetStateAction<number>>;
} {
  const [hydratedDeals, setHydratedDeals] = useState<QrmRepSafeDeal[] | null>(null);
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
      setDealHydrationWarning(firstPage.nextCursor ? "Saved snapshot is incomplete. Reconnect and retry before exporting." : "Showing a saved snapshot. Reconnect and retry for current results.");
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

      // N7.1: resolve open stage ids ONCE for the whole hydration walk —
      // each page used to re-fetch the entire crm_deal_stages table.
      let openStageIds: string[] | undefined;
      try {
        const stages = await listCrmDealStages();
        openStageIds = stages
          .filter((stage) => !stage.isClosedWon && !stage.isClosedLost)
          .map((stage) => stage.id);
      } catch {
        openStageIds = undefined; // per-page fallback resolves stages itself
      }

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
            openStageIds,
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
        writeCachedOpenDeals({ items: mergedItems, nextCursor: cursor }, cacheScope);
        setIsHydratingRemainingDeals(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dealsQueryData, dealsQueryDataUpdatedAt, hydrationAttempt, cacheScope]);

  return {
    hydratedDeals,
    setHydratedDeals,
    isHydratingRemainingDeals,
    dealHydrationWarning,
    hydrationAttempt,
    setHydrationAttempt,
  };
}
