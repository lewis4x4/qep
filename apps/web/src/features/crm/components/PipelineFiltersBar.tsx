import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UrgencyFilter } from "../hooks/useCrmPipelineComputed";

interface StageOption {
  id: string;
  name: string;
}

interface UrgencyCounts {
  all: number;
  attention: number;
  overdue_follow_up: number;
  no_follow_up: number;
  stalled: number;
  data_issues: number;
}

interface PipelineFiltersBarProps {
  selectedStageId: string;
  onStageChange: (stageId: string) => void;
  stageOptions: StageOption[];
  urgencyFilter: UrgencyFilter;
  onUrgencyChange: (filter: UrgencyFilter) => void;
  urgencyCounts: UrgencyCounts;
  viewMode: "board" | "table";
  onViewModeChange: (mode: "board" | "table") => void;
}

export function PipelineFiltersBar({
  selectedStageId,
  onStageChange,
  stageOptions,
  urgencyFilter,
  onUrgencyChange,
  urgencyCounts,
  viewMode,
  onViewModeChange,
}: PipelineFiltersBarProps) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label
            htmlFor="crm-stage-filter"
            className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Filter stage
          </label>
          <select
            id="crm-stage-filter"
            value={selectedStageId}
            onChange={(event) => onStageChange(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="all">All open stages</option>
            {stageOptions.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="crm-urgency-filter"
            className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Follow-up queue
          </label>
          <select
            id="crm-urgency-filter"
            value={urgencyFilter}
            onChange={(event) => onUrgencyChange(event.target.value as UrgencyFilter)}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="all">All deals in stage ({urgencyCounts.all})</option>
            <option value="attention">Needs attention ({urgencyCounts.attention})</option>
            <option value="overdue_follow_up">Overdue follow-up ({urgencyCounts.overdue_follow_up})</option>
            <option value="no_follow_up">No follow-up scheduled ({urgencyCounts.no_follow_up})</option>
            <option value="stalled">Stalled activity ({urgencyCounts.stalled})</option>
            <option value="data_issues">Data issues ({urgencyCounts.data_issues})</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Counts reflect the currently selected stage.</p>
        </div>
        <div>
          <p className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">View</p>
          <div className="flex rounded-md border border-input bg-card p-1">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "board" ? "default" : "ghost"}
              className="h-8 flex-1"
              onClick={() => onViewModeChange("board")}
            >
              Board
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "table" ? "default" : "ghost"}
              className="h-8 flex-1"
              onClick={() => onViewModeChange("table")}
            >
              Table
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
