import { Card } from "@/components/ui/card";
import { PipelineDealTableRow } from "./PipelineDealTableRow";
import type { QrmRepSafeDeal } from "../lib/types";

interface PipelineDealsTableViewProps {
  deals: QrmRepSafeDeal[];
  stageNameById: Map<string, string>;
  healthProfileByCompanyId: Map<string, { profileId: string; score: number | null }>;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
  onOpenHealthProfile: (profileId: string) => void;
}

export function PipelineDealsTableView({
  deals,
  stageNameById,
  healthProfileByCompanyId,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
  onOpenHealthProfile,
}: PipelineDealsTableViewProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" aria-label="QRM deals table">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Deal</th>
              <th className="px-4 py-2 text-left">Stage</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-left">Target Close</th>
              <th className="px-4 py-2 text-left">Follow-up</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <PipelineDealTableRow
                key={deal.id}
                deal={deal}
                stageName={stageNameById.get(deal.stageId) ?? "Unknown stage"}
                healthProfile={deal.companyId ? healthProfileByCompanyId.get(deal.companyId) ?? null : null}
                onCommitPipelineFollowUp={onCommitPipelineFollowUp}
                onSchedulePipelineRefresh={onSchedulePipelineRefresh}
                onOpenHealthProfile={onOpenHealthProfile}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
