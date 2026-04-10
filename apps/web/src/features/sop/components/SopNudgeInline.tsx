import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, BookOpen, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import {
  fetchSopSuggestions,
  startSopExecution,
  type SopExecution,
  type SopSuggestion,
} from "../lib/sop-api";

interface SopNudgeInlineProps {
  contextEntityType: "deal";
  contextEntityId: string;
  stage?: string | null;
}

interface ActiveExecutionRow extends Pick<SopExecution, "id" | "status" | "sop_template_id"> {
  sop_templates?: { title: string } | null;
}

export function SopNudgeInline({
  contextEntityType,
  contextEntityId,
  stage,
}: SopNudgeInlineProps) {
  const executionQuery = useQuery({
    queryKey: ["sop", "active-execution", contextEntityType, contextEntityId],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (column: string, value: string) => {
              eq: (column: string, value: string) => {
                order: (column: string, options: Record<string, boolean>) => Promise<{ data: ActiveExecutionRow[] | null; error: { message?: string } | null }>;
              };
            };
          };
        };
      })
        .from("sop_executions")
        .select("id, status, sop_template_id, sop_templates(title)")
        .eq("context_entity_type", contextEntityType)
        .eq("context_entity_id", contextEntityId)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message ?? "Failed to load SOP execution.");
      const active = (data ?? []).find((row: ActiveExecutionRow) => row.status === "in_progress") ?? null;
      if (!active) {
        return { activeExecution: null, skippedCount: 0 };
      }

      const { count } = await (supabase as unknown as {
        from: (table: string) => {
          select: (_columns: string, opts: { count: string; head: boolean }) => {
            eq: (column: string, value: string) => Promise<{ count: number | null; error: { message?: string } | null }>;
          };
        };
      })
        .from("sop_step_skips")
        .select("*", { count: "exact", head: true })
        .eq("sop_execution_id", active.id);

      return {
        activeExecution: active,
        skippedCount: count ?? 0,
      };
    },
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
