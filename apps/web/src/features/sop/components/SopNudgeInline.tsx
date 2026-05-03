import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, BookOpen, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  fetchActiveSopExecutionForContext,
  fetchSopSuggestions,
  startSopExecution,
  type SopSuggestion,
} from "../lib/sop-api";

interface SopNudgeInlineProps {
  contextEntityType: "deal";
  contextEntityId: string;
  stage?: string | null;
}

export function SopNudgeInline({
  contextEntityType,
  contextEntityId,
  stage,
}: SopNudgeInlineProps) {
  const executionQuery = useQuery({
    queryKey: ["sop", "active-execution", contextEntityType, contextEntityId],
    queryFn: () => fetchActiveSopExecutionForContext({ contextEntityType, contextEntityId }),
    staleTime: 30_000,
  });

  const suggestionQuery = useQuery({
    queryKey: ["sop", "suggestion-inline", contextEntityType, contextEntityId, stage],
    queryFn: () => fetchSopSuggestions({
      entity_type: contextEntityType,
      entity_id: contextEntityId,
      stage: stage ?? undefined,
      department: "sales",
    }),
    enabled: !executionQuery.data?.activeExecution,
    staleTime: 60_000,
  });

  const startMutation = useMutation({
    mutationFn: (templateId: string) => startSopExecution({
      sop_template_id: templateId,
      context_entity_type: contextEntityType,
      context_entity_id: contextEntityId,
    }),
  });

  const topSuggestion = useMemo<SopSuggestion | null>(
    () => suggestionQuery.data?.suggestions?.[0] ?? null,
    [suggestionQuery.data],
  );

  if (executionQuery.isLoading || suggestionQuery.isLoading) {
    return <Card className="mt-2 h-10 animate-pulse" />;
  }

  if (executionQuery.isError) {
    return null;
  }

  if (executionQuery.data?.activeExecution) {
    const execution = executionQuery.data.activeExecution;
    const skippedCount = executionQuery.data.skippedCount;
    const hasDrift = skippedCount > 0;
    return (
      <div className={`mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
        hasDrift
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-blue-500/20 bg-blue-500/5"
      }`}>
        {hasDrift ? (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
        ) : (
          <BookOpen className="h-3 w-3 shrink-0 text-blue-400" aria-hidden />
        )}
        <span className="flex-1 truncate text-foreground">
          {hasDrift
            ? `${skippedCount} skipped step${skippedCount === 1 ? "" : "s"} on active SOP: ${execution.sop_templates?.title ?? "SOP"}`
            : `Active SOP: ${execution.sop_templates?.title ?? "SOP"}`
          }
        </span>
        <Button asChild size="sm" variant="ghost" className="h-6 shrink-0 text-[10px]">
          <Link to={`/sop/executions/${execution.id}`}>
            Continue <ChevronRight className="ml-0.5 h-3 w-3" />
          </Link>
        </Button>
      </div>
    );
  }

  if (suggestionQuery.isError || !topSuggestion) {
    return null;
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-xs">
      <BookOpen className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
      <span className="flex-1 truncate text-foreground">{topSuggestion.nudge}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 text-[10px]"
        disabled={startMutation.isPending}
        onClick={() => startMutation.mutate(topSuggestion.id, {
          onSuccess: (result) => {
            window.location.href = `/sop/executions/${result.execution.id}`;
          },
        })}
      >
        <Play className="mr-0.5 h-3 w-3" />
        Run
      </Button>
    </div>
  );
}
