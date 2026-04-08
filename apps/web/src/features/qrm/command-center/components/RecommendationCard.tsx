import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Flame,
  Lock,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LaneKey, RecommendationCardPayload } from "../api/commandCenter.types";

const SNOOZE_KEY_PREFIX = "qrm.cc.snooze.";
const SNOOZE_HOURS = 8;

function isSnoozed(recommendationKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY_PREFIX + recommendationKey);
    if (!raw) return false;
    const until = Number.parseInt(raw, 10);
    if (!Number.isFinite(until)) return false;
    return until > Date.now();
  } catch {
    return false;
  }
}

function snooze(recommendationKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const until = Date.now() + SNOOZE_HOURS * 60 * 60 * 1000;
    window.localStorage.setItem(SNOOZE_KEY_PREFIX + recommendationKey, String(until));
  } catch {
    // best effort
  }
}

function formatCurrency(amount: number | null): string | null {
  if (amount === null) return null;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

const LANE_TONE: Record<LaneKey, { className: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  revenue_ready: {
    className: "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-500",
    label: "Revenue ready",
    Icon: Flame,
  },
  revenue_at_risk: {
    className: "border-amber-500/40 bg-amber-500/[0.06] text-amber-500",
    label: "At risk",
    Icon: Clock,
  },
  blockers: {
    className: "border-rose-500/40 bg-rose-500/[0.06] text-rose-500",
    label: "Blocker",
    Icon: Lock,
  },
};

interface RecommendationCardProps {
  card: RecommendationCardPayload;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
  variant?: "hero" | "compact";
  showLaneBadge?: boolean;
}

export function RecommendationCard({
  card,
  onAccept,
  onDismiss,
  variant = "compact",
  showLaneBadge = true,
}: RecommendationCardProps) {
  const [hidden, setHidden] = useState<boolean>(() => isSnoozed(card.recommendationKey));

  if (hidden) return null;

  const tone = LANE_TONE[card.lane];
  const ToneIcon = tone.Icon;
  const amountLabel = formatCurrency(card.amount);
  const subline = [card.companyName, card.contactName].filter(Boolean).join(" · ");

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-4",
        variant === "hero" && "border-qep-orange/30 bg-gradient-to-br from-qep-orange/[0.05] to-transparent shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {showLaneBadge && (
              <Badge variant="outline" className={cn("gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wide", tone.className)}>
                <ToneIcon className="h-3 w-3" />
                {tone.label}
              </Badge>
            )}
            {card.stageName && (
              <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{card.stageName}</span>
            )}
          </div>
          <h3
            className={cn(
              "mt-1 truncate font-semibold leading-tight text-foreground",
              variant === "hero" ? "text-base" : "text-sm",
            )}
            title={card.headline}
          >
            {card.headline}
          </h3>
          {subline && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={subline}>
              {subline}
            </p>
          )}
        </div>
        {amountLabel && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Deal value</div>
            <div className="text-sm font-bold text-foreground">{amountLabel}</div>
          </div>
        )}
      </div>

      <ul className="space-y-1">
        {card.rationale.map((line, idx) => (
          <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-qep-orange/80" />
            <span className="leading-snug">{line}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {card.primaryAction.href ? (
          <Button asChild size="sm" className="h-8 gap-1 bg-qep-orange text-white hover:bg-qep-orange/90">
            <Link to={card.primaryAction.href}>
              <Zap className="h-3.5 w-3.5" />
              {card.primaryAction.label}
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 gap-1 bg-qep-orange text-white hover:bg-qep-orange/90"
            onClick={() => onAccept?.(card)}
          >
            <Zap className="h-3.5 w-3.5" />
            {card.primaryAction.label}
          </Button>
        )}
        {card.secondaryAction?.href && (
          <Button asChild size="sm" variant="outline" className="h-8 gap-1">
            <Link to={card.secondaryAction.href}>
              <ArrowUpRight className="h-3.5 w-3.5" />
              {card.secondaryAction.label}
            </Link>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => {
              snooze(card.recommendationKey);
              setHidden(true);
            }}
          >
            <Clock className="mr-1 h-3 w-3" /> Snooze {SNOOZE_HOURS}h
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => {
              onDismiss?.(card);
              setHidden(true);
            }}
          >
            <X className="mr-1 h-3 w-3" /> Dismiss
          </Button>
          {onAccept && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-emerald-500 hover:text-emerald-400"
              onClick={() => onAccept(card)}
            >
              <CheckCircle2 className="mr-1 h-3 w-3" /> Acknowledge
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
