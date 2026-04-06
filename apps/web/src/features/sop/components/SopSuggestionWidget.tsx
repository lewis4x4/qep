import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb, BookOpen, Play, ChevronRight } from "lucide-react";
import { fetchSopSuggestions, type SopDepartment } from "../lib/sop-api";

interface SopSuggestionWidgetProps {
  entityType: string;
  entityId?: string;
  stage?: string;
  department?: SopDepartment;
  /** Max suggestions to show (default 3). */
  limit?: number;
  /** Compact variant: single row, no card chrome. */
  compact?: boolean;
}

/**
 * Contextual SOP nudge widget — drops into deal detail, service job, and
 * intake pages to surface the top relevant active SOPs with one-line nudges.
 *
 * Powered by the `sop-suggest` edge function which ranks active templates
 * by tag relevance against entity type + stage context.
 */
export function SopSuggestionWidget({
  entityType,
  entityId,
  stage,
  department,
  limit = 3,
  compact = false,
}: SopSuggestionWidgetProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sop", "suggestions", entityType, entityId, stage, department],
    queryFn: () => fetchSopSuggestions({ entity_type: entityType, entity_id: entityId, stage, department }),
    staleTime: 60_000,
  });

  const suggestions = (data?.suggestions ?? []).slice(0, limit);

  if (isLoading) {
    return (
      <Card className={compact ? "h-10 animate-pulse" : "h-24 animate-pulse"} />
    );
  }

  if (isError || suggestions.length === 0) {
    return null; // fail quietly — suggestions are additive
  }

  if (compact) {
    const top = suggestions[0];
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-xs">
        <Lightbulb className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
        <span className="flex-1 truncate text-foreground">{top.nudge}</span>
        <Button asChild size="sm" variant="ghost" className="h-6 shrink-0 text-[10px]">
          <Link to={`/sop/templates/${top.id}`}>
            Open <ChevronRight className="ml-0.5 h-3 w-3" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="h-4 w-4 text-amber-400" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">Suggested SOPs</h3>
        <span className="text-[10px] text-muted-foreground">
          ({data?.total_active_sops ?? 0} active · {suggestions.length} relevant)
        </span>
      </div>

      <div className="space-y-2">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="rounded-md border border-border bg-muted/20 p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <BookOpen className="h-3 w-3 shrink-0 text-qep-orange" aria-hidden />
                  <p className="text-xs font-semibold text-foreground truncate">{s.title}</p>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {s.department}
                  </span>
                  {s.relevance_score > 0 && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                      {s.relevance_score}★
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] italic text-muted-foreground">
                  {s.nudge}
                </p>
                {s.tags && s.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Button asChild size="sm" variant="outline" className="h-6 shrink-0 text-[10px]">
                <Link to={`/sop/templates/${s.id}`}>
                  <Play className="mr-0.5 h-2.5 w-2.5" />
                  Run
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
