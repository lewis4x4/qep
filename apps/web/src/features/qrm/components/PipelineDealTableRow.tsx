import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HealthScorePill } from "../../nervous-system/components/HealthScorePill";
import { formatMoney, formatDate, getFutureFollowUpIso } from "../lib/pipeline-utils";
import { patchCrmDeal } from "../lib/qrm-api";
import type { QrmRepSafeDeal } from "../lib/types";
import { FollowUpQuickActions } from "./FollowUpQuickActions";

export function PipelineDealTableRow({
  deal,
  stageName,
  healthProfile,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
  onOpenHealthProfile,
}: {
  deal: QrmRepSafeDeal;
  stageName: string;
  healthProfile: { profileId: string; score: number | null } | null;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
  onOpenHealthProfile: (profileId: string) => void;
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
    <tr className="border-t border-border">
      <td className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/crm/deals/${deal.id}`} className="font-semibold text-foreground hover:text-primary">
            {effectiveDeal.name}
          </Link>
          {healthProfile && (
            <HealthScorePill
              score={healthProfile.score}
              onClick={() => onOpenHealthProfile(healthProfile.profileId)}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">Last activity: {formatDate(effectiveDeal.lastActivityAt)}</p>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{stageName}</td>
      <td className="px-4 py-3 text-right text-muted-foreground">{formatMoney(effectiveDeal.amount)}</td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(effectiveDeal.expectedCloseOn)}</td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(effectiveDeal.nextFollowUpAt)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              to={`/quote-v2?crm_deal_id=${effectiveDeal.id}${effectiveDeal.primaryContactId ? `&crm_contact_id=${effectiveDeal.primaryContactId}` : ""}`}
            >
              <FileText className="mr-1 h-4 w-4" />
              New Quote
            </Link>
          </Button>
          <FollowUpQuickActions
            isPending={isPending}
            errorMessage={errorMessage}
            onSetFollowUp={(daysAhead) => void handleSetFollowUp(daysAhead)}
          />
        </div>
      </td>
    </tr>
  );
}
