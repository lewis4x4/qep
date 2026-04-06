import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate, getFutureFollowUpIso } from "../lib/pipeline-utils";
import { patchCrmDeal } from "../lib/qrm-api";
import { QrmDealSignalBadges } from "./QrmDealSignalBadges";
import { SlaCountdown } from "./SlaCountdown";
import { DepositGateBadge } from "./DepositGateBadge";
import { FollowUpQuickActions } from "./FollowUpQuickActions";
import type { QrmRepSafeDeal } from "../lib/types";

export function PipelineDealCard({
  deal,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
}: {
  deal: QrmRepSafeDeal;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [displayFollowUpAt, setDisplayFollowUpAt] = useState<string | null>(deal.nextFollowUpAt);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setDisplayFollowUpAt(deal.nextFollowUpAt);
    setErrorMessage(null);
  }, [deal.id, deal.nextFollowUpAt]);

  const effectiveDeal = useMemo(
    () => ({ ...deal, nextFollowUpAt: displayFollowUpAt }),
    [deal, displayFollowUpAt]
  );

  async function handleSetFollowUp(daysAhead: number): Promise<void> {
    const nextFollowUpAt = getFutureFollowUpIso(daysAhead);
    const previousFollowUpAt = displayFollowUpAt;
    const previousDetailDeal = queryClient.getQueryData<QrmRepSafeDeal | null>(["crm", "deal", deal.id]) ?? null;

    setErrorMessage(null);
    setIsPending(true);
    setDisplayFollowUpAt(nextFollowUpAt);
    queryClient.setQueryData(["crm", "deal", deal.id], (current: QrmRepSafeDeal | null | undefined) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        nextFollowUpAt,
      };
    });

    try {
      const updatedDeal = await patchCrmDeal(deal.id, {
        nextFollowUpAt,
        followUpReminderSource: "pipeline_quick",
      });
      setDisplayFollowUpAt(updatedDeal.nextFollowUpAt);
      onCommitPipelineFollowUp(deal.id, updatedDeal.nextFollowUpAt);
      queryClient.setQueryData(["crm", "deal", deal.id], updatedDeal);
      onSchedulePipelineRefresh(deal.id);
    } catch (error) {
      setDisplayFollowUpAt(previousFollowUpAt);
      if (previousDetailDeal) {
        queryClient.setQueryData(["crm", "deal", deal.id], previousDetailDeal);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["crm", "deal", deal.id] });
      }
      setErrorMessage(error instanceof Error ? error.message : "Could not update follow-up. Try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <Link
          to={`/crm/deals/${deal.id}`}
          className="text-sm font-semibold text-foreground hover:text-primary"
        >
          {effectiveDeal.name}
        </Link>
        <SlaCountdown deadline={effectiveDeal.slaDeadlineAt ?? null} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatMoney(effectiveDeal.amount)} • Follow-up {formatDate(effectiveDeal.nextFollowUpAt)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <QrmDealSignalBadges deal={effectiveDeal} />
        <DepositGateBadge
          depositStatus={effectiveDeal.depositStatus ?? null}
          depositAmount={effectiveDeal.depositAmount ?? null}
        />
      </div>
      <div className="mt-2 flex gap-2">
        <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
          <Link to={`/crm/deals/${deal.id}`}>Open</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
          <Link
            to={`/quote?crm_deal_id=${deal.id}${deal.primaryContactId ? `&crm_contact_id=${deal.primaryContactId}` : ""}`}
          >
            <FileText className="mr-1 h-3.5 w-3.5" />
            Quote
          </Link>
        </Button>
      </div>
      <div className="mt-2">
        <FollowUpQuickActions
          isPending={isPending}
          errorMessage={errorMessage}
          compact
          onSetFollowUp={(daysAhead) => void handleSetFollowUp(daysAhead)}
        />
      </div>
    </article>
  );
}
