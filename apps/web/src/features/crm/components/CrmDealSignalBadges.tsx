import { AlertTriangle, Clock3 } from "lucide-react";
import type { CrmRepSafeDeal, CrmWeightedDeal } from "../lib/types";
import { getDealSignalState } from "../lib/deal-signals";

type DealSignalInput = Pick<CrmRepSafeDeal, "nextFollowUpAt" | "lastActivityAt" | "createdAt"> |
  Pick<CrmWeightedDeal, "nextFollowUpAt" | "lastActivityAt" | "createdAt">;

interface CrmDealSignalBadgesProps {
  deal: DealSignalInput;
}

export function CrmDealSignalBadges({ deal }: CrmDealSignalBadgesProps) {
  const { isOverdueFollowUp, isStalled } = getDealSignalState(deal);

  if (!isOverdueFollowUp && !isStalled) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Deal status signals">
      {isOverdueFollowUp && (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/45 bg-gradient-to-br from-rose-400/22 to-rose-950/12 px-2 py-0.5 text-xs font-medium text-rose-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-rose-400/18 dark:to-rose-950/38 dark:text-rose-50">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Overdue Follow-Up
        </span>
      )}
      {isStalled && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-gradient-to-br from-amber-400/22 to-amber-950/12 px-2 py-0.5 text-xs font-medium text-amber-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-amber-400/18 dark:to-amber-950/38 dark:text-amber-50">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          Stalled
        </span>
      )}
    </div>
  );
}
