import { useNavigate } from "react-router-dom";
import { Sunrise, ChevronRight } from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";

export interface TomorrowFirstMoveProps {
  pipeline: RepPipelineDeal[];
}

interface Move {
  reason: string;
  customer: string;
  deal: string;
  dealId: string;
  suggestedTime: string;
  urgencyColor: string;
}

function pickFirstMove(pipeline: RepPipelineDeal[]): Move | null {
  if (pipeline.length === 0) return null;

  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;

  // Priority 1: closing this week + cooling/cold
  const closingHot = pipeline.find(
    (d) =>
      d.expected_close_on &&
      new Date(d.expected_close_on).getTime() - now < week &&
      (d.heat_status === "cooling" || d.heat_status === "cold"),
  );
  if (closingHot) {
    return {
      reason: "Closes this week & going quiet",
      customer: closingHot.customer_name,
      deal: closingHot.deal_name,
      dealId: closingHot.deal_id,
      suggestedTime: "First call, 8:15 AM",
      urgencyColor: "text-red-400",
    };
  }

  // Priority 2: highest-value cold deal
  const coldDeals = pipeline
    .filter((d) => d.heat_status === "cold")
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  if (coldDeals[0]) {
    const d = coldDeals[0];
    return {
      reason: `Cold ${d.days_since_activity ?? "?"}d, $${(d.amount ?? 0).toLocaleString()} on the table`,
      customer: d.customer_name,
      deal: d.deal_name,
      dealId: d.deal_id,
      suggestedTime: "Recover before 10 AM",
      urgencyColor: "text-amber-400",
    };
  }

  // Priority 3: closing this week regardless of heat
  const closing = pipeline
    .filter(
      (d) =>
        d.expected_close_on &&
        new Date(d.expected_close_on).getTime() - now < week,
    )
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  if (closing[0]) {
    const d = closing[0];
    return {
      reason: `Closes ${formatRelativeDate(d.expected_close_on!)}`,
      customer: d.customer_name,
      deal: d.deal_name,
      dealId: d.deal_id,
      suggestedTime: "Confirm details by noon",
      urgencyColor: "text-qep-orange",
    };
  }

  // Priority 4: highest-scored deal
  const scored = pipeline
    .filter((d) => d.deal_score != null)
    .sort((a, b) => (b.deal_score ?? 0) - (a.deal_score ?? 0));
  const pick = scored[0] ?? pipeline[0];
  return {
    reason: "Top-scored deal, keep momentum",
    customer: pick.customer_name,
    deal: pick.deal_name,
    dealId: pick.deal_id,
    suggestedTime: "Touch before lunch",
    urgencyColor: "text-emerald-400",
  };
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TomorrowFirstMove({ pipeline }: TomorrowFirstMoveProps) {
  const navigate = useNavigate();
  const move = pickFirstMove(pipeline);
  if (!move) return null;

  return (
    <button
      type="button"
      data-testid="tomorrow-first-move"
      onClick={() => navigate(`/sales/deals/${move.dealId}`)}
      className="w-full text-left bg-[hsl(var(--card))] border border-white/[0.08] rounded-xl px-4 py-3.5 active:scale-[0.99] transition-transform hover:border-white/[0.15]"
    >
      <div className="flex items-center gap-2 mb-2">
        <Sunrise className="w-3.5 h-3.5 text-qep-orange" />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Tomorrow's First Move
        </span>
        <div className="flex-1 h-px bg-white/[0.06]" />
        <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-semibold text-foreground leading-tight">
        {move.customer}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">
        {move.deal}
      </p>
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-[11px] font-semibold ${move.urgencyColor}`}>
          {move.suggestedTime}
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-[11px] text-muted-foreground/80">
          {move.reason}
        </span>
      </div>
    </button>
  );
}
