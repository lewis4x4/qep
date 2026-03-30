import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CrmDealStage } from "../lib/types";

interface CrmDealUpdateCardProps {
  stages: CrmDealStage[];
  stageId: string;
  setStageId: Dispatch<SetStateAction<string>>;
  nextFollowUpInput: string;
  setNextFollowUpInput: Dispatch<SetStateAction<string>>;
  isElevatedRole: boolean;
  showClosedLostFields: boolean;
  lossReason: string;
  setLossReason: Dispatch<SetStateAction<string>>;
  competitor: string;
  setCompetitor: Dispatch<SetStateAction<string>>;
  formError: string | null;
  saveError: boolean;
  savePending: boolean;
  stagesLoading: boolean;
  onSave: () => void;
}

export function CrmDealUpdateCard({
  stages,
  stageId,
  setStageId,
  nextFollowUpInput,
  setNextFollowUpInput,
  isElevatedRole,
  showClosedLostFields,
  lossReason,
  setLossReason,
  competitor,
  setCompetitor,
  formError,
  saveError,
  savePending,
  stagesLoading,
  onSave,
}: CrmDealUpdateCardProps) {
  const visibleStages = isElevatedRole
    ? stages
    : stages.filter((stage) => !stage.isClosedLost || stage.id === stageId);

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="crm-deal-stage" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
            Stage
          </label>
          <select
            id="crm-deal-stage"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
          >
            {visibleStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="crm-next-follow-up" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
            Next follow-up
          </label>
          <input
            id="crm-next-follow-up"
            type="datetime-local"
            value={nextFollowUpInput}
            onChange={(event) => setNextFollowUpInput(event.target.value)}
            className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
          />
        </div>
      </div>

      {isElevatedRole && showClosedLostFields && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="crm-loss-reason" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
              Loss reason
            </label>
            <textarea
              id="crm-loss-reason"
              rows={3}
              value={lossReason}
              onChange={(event) => setLossReason(event.target.value)}
              placeholder="Capture why this opportunity was lost."
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-sm leading-6 text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="crm-loss-competitor" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
              Competitor
            </label>
            <input
              id="crm-loss-competitor"
              value={competitor}
              onChange={(event) => setCompetitor(event.target.value)}
              placeholder="e.g. Local Dealer Inc."
              className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
            />
          </div>
        </div>
      )}

      {formError && <p className="text-sm text-[#B91C1C]">{formError}</p>}
      {saveError && !formError && <p className="text-sm text-[#B91C1C]">Couldn&apos;t save updates. Please retry.</p>}

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={savePending || stagesLoading}>
          {savePending ? "Saving..." : "Save Deal Updates"}
        </Button>
      </div>
    </Card>
  );
}
