import { Flame, Lock, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  ActionLanesPayload,
  RecommendationCardPayload,
  SectionFreshness,
} from "../api/commandCenter.types";
import { ActionLaneCard } from "./ActionLaneCard";

interface ActionLanesProps {
  payload: ActionLanesPayload;
  freshness: SectionFreshness;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

interface LaneColumnProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "ready" | "risk" | "blocker";
  cards: RecommendationCardPayload[];
  emptyHealthyLabel: string;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

function LaneColumn({
  title,
  description,
  icon: Icon,
  tone,
  cards,
  emptyHealthyLabel,
  onAccept,
  onDismiss,
}: LaneColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-center justify-between rounded-lg border px-3 py-2",
          tone === "ready" && "border-emerald-500/40 bg-emerald-500/[0.05]",
          tone === "risk" && "border-amber-500/40 bg-amber-500/[0.05]",
          tone === "blocker" && "border-rose-500/40 bg-rose-500/[0.05]",
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4",
              tone === "ready" && "text-emerald-500",
              tone === "risk" && "text-amber-500",
              tone === "blocker" && "text-rose-500",
            )}
          />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-[10px] text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            tone === "ready" && "border-emerald-500/40 text-emerald-500",
            tone === "risk" && "border-amber-500/40 text-amber-500",
            tone === "blocker" && "border-rose-500/40 text-rose-500",
          )}
        >
          {cards.length}
        </Badge>
      </div>

      {cards.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
          {emptyHealthyLabel}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <ActionLaneCard
              key={card.recommendationKey}
              card={card}
              onAccept={onAccept}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionLanes({ payload, freshness, onAccept, onDismiss }: ActionLanesProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Action Lanes</h2>
        {freshness.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness.source}</span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LaneColumn
          title="Revenue ready"
          description="Closeable this week — clear the runway."
          icon={Flame}
          tone="ready"
          cards={payload.revenueReady}
          emptyHealthyLabel="No closeable revenue queued in the next 7 days. Build pipeline."
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
        <LaneColumn
          title="Revenue at risk"
          description="Stalled, overdue, or aging — re-engage now."
          icon={ShieldAlert}
          tone="risk"
          cards={payload.revenueAtRisk}
          emptyHealthyLabel="No deals at risk in this scope. Quiet board."
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
        <LaneColumn
          title="Operational blockers"
          description="Approvals, deposits, or anomalies gating revenue."
          icon={Lock}
          tone="blocker"
          cards={payload.blockers}
          emptyHealthyLabel="No blocked deals right now. Good position."
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      </div>
    </section>
  );
}
