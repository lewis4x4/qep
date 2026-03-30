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
        <span className="inline-flex items-center gap-1 rounded-full border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 text-xs font-medium text-[#991B1B]">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Overdue Follow-Up
        </span>
      )}
      {isStalled && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-xs font-medium text-[#92400E]">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          Stalled
        </span>
      )}
    </div>
  );
}
