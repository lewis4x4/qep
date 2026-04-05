import { useState, useCallback } from "react";
import { SERVICE_STAGES, STAGE_LABELS, STAGE_COLORS } from "../lib/constants";
import type { ServiceStage } from "../lib/constants";
import type { ServiceJobWithRelations } from "../lib/types";
import { ServiceJobCard } from "./ServiceJobCard";
import { useTransitionServiceJob } from "../hooks/useServiceJobMutation";

interface Props {
  jobs: ServiceJobWithRelations[];
  onJobClick: (jobId: string) => void;
}

const VISIBLE_STAGES = SERVICE_STAGES.filter((s) => s !== "paid_closed");

export function ServiceKanbanBoard({ jobs, onJobClick }: Props) {
  const transition = useTransitionServiceJob();
  const [dragJobId, setDragJobId] = useState<string | null>(null);

  const jobsByStage = VISIBLE_STAGES.reduce<Record<string, ServiceJobWithRelations[]>>(
    (acc, stage) => {
      acc[stage] = jobs.filter((j) => j.current_stage === stage);
      return acc;
    },
    {},
  );

  const handleDragStart = useCallback((jobId: string) => {
    setDragJobId(jobId);
  }, []);

  const handleDrop = useCallback(
    (targetStage: string) => {
      if (!dragJobId) return;
      const job = jobs.find((j) => j.id === dragJobId);
      if (!job || job.current_stage === targetStage) {
        setDragJobId(null);
        return;
      }
      transition.mutate(
        { id: dragJobId, toStage: targetStage },
        { onSettled: () => setDragJobId(null) },
      );
    },
    [dragJobId, jobs, transition],
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-16rem)]">
      {VISIBLE_STAGES.map((stage) => {
        const stageJobs = jobsByStage[stage] ?? [];
        return (
          <div
            key={stage}
            className="flex-shrink-0 w-72 flex flex-col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stage)}
          >
            {/* Column header */}
            <div className={`rounded-t-lg px-3 py-2 ${STAGE_COLORS[stage as ServiceStage]}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{STAGE_LABELS[stage as ServiceStage]}</span>
                <span className="text-[10px] font-medium opacity-75">{stageJobs.length}</span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex-1 bg-muted/30 rounded-b-lg p-2 space-y-2 min-h-[8rem]">
              {stageJobs.map((job) => (
                <div
                  key={job.id}
                  draggable
                  onDragStart={() => handleDragStart(job.id)}
                >
                  <ServiceJobCard job={job} onClick={() => onJobClick(job.id)} />
                </div>
              ))}
              {stageJobs.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4 italic">Empty</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
