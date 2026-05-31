import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Search, Lightbulb } from "lucide-react";
import type { QuoteRecommendation } from "../../../../../../shared/qep-moonshot-contracts";

interface AiRecommendationCardProps {
  recommendation: QuoteRecommendation;
  voiceSummary?: string | null;
  onSelectPrimary: () => void;
  onSelectAlternative?: () => void;
  onBrowseCatalog: () => void;
}

export function AiRecommendationCard({
  recommendation,
  voiceSummary,
  onSelectPrimary,
  onSelectAlternative,
  onBrowseCatalog,
}: AiRecommendationCardProps) {
  const alt = recommendation.alternative;
  const considerations = recommendation.jobConsiderations;

  return (
    <Card className="border-qep-orange/30 bg-qep-orange/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-qep-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">AI Recommendation</p>
      </div>

      {/* Primary recommendation */}
      <div className="rounded-lg border border-qep-orange/20 bg-background/60 p-3 space-y-2">
        <p className="text-sm font-semibold text-foreground">{recommendation.machine}</p>
        {recommendation.attachments?.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Attachments: {recommendation.attachments.join(", ")}
          </p>
        )}
        <p className="text-sm italic text-foreground/80">{recommendation.reasoning}</p>
        <Button size="sm" onClick={onSelectPrimary} className="mt-1">
          Select Recommended <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Alternative */}
      {alt && alt.machine && (
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Alternative</p>
          <p className="text-sm font-medium text-foreground">{alt.machine}</p>
          {alt.attachments?.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Attachments: {alt.attachments.join(", ")}
            </p>
          )}
          <p className="text-xs italic text-foreground/70">{alt.reasoning}</p>
          {onSelectAlternative && (
            <Button size="sm" variant="outline" onClick={onSelectAlternative}>
              Select Alternative
            </Button>
          )}
        </div>
      )}

      {/* Job considerations */}
      {considerations && considerations.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Lightbulb className="h-3 w-3 text-qep-orange" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Job Considerations</p>
          </div>
          <ul className="space-y-0.5 pl-4">
            {considerations.map((c, i) => (
              <li key={i} className="text-xs text-foreground/70 list-disc">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Voice transcript */}
      {voiceSummary && (
        <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">
          Source: {voiceSummary.length > 120 ? voiceSummary.slice(0, 120) + "…" : voiceSummary}
        </p>
      )}

      {/* Browse catalog fallback */}
      <Button size="sm" variant="ghost" onClick={onBrowseCatalog} className="w-full">
        <Search className="mr-1 h-3.5 w-3.5" /> Browse Catalog Instead
      </Button>
    </Card>
  );
}
