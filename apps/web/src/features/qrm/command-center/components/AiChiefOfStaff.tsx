import { Brain, Compass, Flame, ShieldAlert, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  AiChiefOfStaffPayload,
  RecommendationCardPayload,
  SectionFreshness,
} from "../api/commandCenter.types";
import { RecommendationCard } from "./RecommendationCard";

interface AiChiefOfStaffProps {
  payload: AiChiefOfStaffPayload;
  freshness: SectionFreshness;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

interface HeroSlotProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  card: RecommendationCardPayload | null;
  emptyLabel: string;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

function HeroSlot({ title, subtitle, icon: Icon, card, emptyLabel, onAccept, onDismiss }: HeroSlotProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-qep-orange" />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="text-[10px] text-muted-foreground/80">{subtitle}</div>
        </div>
      </div>
      {card ? (
        <RecommendationCard card={card} variant="hero" showLaneBadge={false} onAccept={onAccept} onDismiss={onDismiss} />
      ) : (
        <Card className="border-dashed border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
          {emptyLabel}
        </Card>
      )}
    </div>
  );
}

export function AiChiefOfStaff({ payload, freshness, onAccept, onDismiss }: AiChiefOfStaffProps) {
  return (
    <Card className="border-qep-orange/20 bg-card/40 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-qep-orange" />
          <h2 className="text-base font-semibold text-foreground">AI Chief of Staff</h2>
          <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Sparkles className="mr-1 h-3 w-3" />
            {payload.source === "rules" ? "Rules-based" : "Rules + LLM"}
          </Badge>
        </div>
        {freshness.source === "degraded" && freshness.reason && (
          <span className="text-[11px] text-amber-500" title={freshness.reason}>
            Degraded · {freshness.reason}
          </span>
        )}
      </div>
      <div
        className={cn(
          "grid grid-cols-1 gap-4 lg:grid-cols-3",
        )}
      >
        <HeroSlot
          title="Best move now"
          subtitle="Highest leverage you can take today."
          icon={Flame}
          card={payload.bestMove}
          emptyLabel="No revenue-ready deals to recommend right now."
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
        <HeroSlot
          title="Biggest risk now"
          subtitle="Most expensive blocker on the board."
          icon={ShieldAlert}
          card={payload.biggestRisk}
          emptyLabel="No critical blockers right now. Quiet board."
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
        <HeroSlot
          title="Fastest path to revenue"
          subtitle="Closest dollar you can move this week."
          icon={Compass}
          card={payload.fastestPath}
          emptyLabel="No deals close enough to surface a fast path."
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      </div>
    </Card>
  );
}
