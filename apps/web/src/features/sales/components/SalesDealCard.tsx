import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  PhoneCall,
  FileText,
  ArrowRight,
  Zap,
  User2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { advanceDealStage } from "../lib/sales-api";
import type { RepPipelineDeal } from "../lib/types";

/* ── Heat dot ───────────────────────────────────────────── */
function HeatDot({ heat }: { heat: string }) {
  const color =
    heat === "warm"
      ? "bg-amber-400"
      : heat === "cold"
        ? "bg-blue-400"
        : "bg-red-500";
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className={`absolute inset-0 rounded-full ${color} ${heat === "warm" ? "animate-ping opacity-50" : ""}`}
      />
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

/* ── Stage color mapping ────────────────────────────────── */
function getStageColor(stage: string): string {
  const s = stage.toLowerCase();
  if (s.includes("closing") || s.includes("close")) return "text-emerald-400";
  if (s.includes("negotiat")) return "text-qep-orange";
  if (s.includes("quot")) return "text-amber-400";
  if (s.includes("qualif")) return "text-purple-400";
  return "text-blue-400";
}

function getStageBgColor(stage: string): string {
  const s = stage.toLowerCase();
  if (s.includes("closing") || s.includes("close")) return "bg-emerald-400";
  if (s.includes("negotiat")) return "bg-qep-orange";
  if (s.includes("quot")) return "bg-amber-400";
  if (s.includes("qualif")) return "bg-purple-400";
  return "bg-blue-400";
}

/* ── Heat color mapping ─────────────────────────────────── */
function getHeatColor(heat: string): string {
  if (heat === "warm") return "bg-amber-400";
  if (heat === "cold") return "bg-blue-400";
  return "bg-red-500";
}

/* ── Stage percentage mapping ───────────────────────────── */
function getStagePercent(sortOrder: number, totalStages: number): number {
  if (totalStages <= 1) return 50;
  return Math.round(((sortOrder) / (totalStages - 1)) * 100);
}

/* ── Money formatting ───────────────────────────────────── */
function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return "";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

/* ── Component ──────────────────────────────────────────── */
export function SalesDealCard({
  deal,
  stages,
}: {
  deal: RepPipelineDeal;
  stages: Array<{ id: string; name: string; sort_order: number }>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const nextStage = stages.find((s) => s.sort_order > deal.stage_sort);
  const heatColor = getHeatColor(deal.heat_status);
  const stageColor = getStageColor(deal.stage);
  const stageBgColor = getStageBgColor(deal.stage);
  const stagePercent = getStagePercent(deal.stage_sort, stages.length);
  const stalled = (deal.days_since_activity ?? 0) >= 10;
  const closesInDays = deal.expected_close_on
    ? Math.ceil(
        (new Date(deal.expected_close_on).getTime() - Date.now()) / 86_400_000,
      )
    : null;
  const money = formatMoney(deal.amount);

  // Stage progress pips
  const stagePips = stages.map((s) => s.sort_order <= deal.stage_sort);

  async function handleAdvance() {
    if (!nextStage || advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await advanceDealStage(deal.deal_id, nextStage.id);
      await queryClient.invalidateQueries({ queryKey: ["sales", "pipeline"] });
    } catch (err) {
      console.error("[SalesDealCard] stage advance failed:", err);
      setAdvanceError("Failed to advance stage. Try again.");
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div
      onClick={() => navigate(`/sales/customers/${deal.company_id}`)}
      className={`relative rounded-[14px] bg-[hsl(var(--card))] border overflow-hidden cursor-pointer transition-all duration-150 hover:border-white/20 hover:shadow-lg hover:shadow-black/20 ${
        stalled ? "border-amber-500/35" : "border-white/[0.06]"
      }`}
    >
      {/* Left heat stripe */}
      <div className={`absolute top-0 left-0 w-1 h-full ${heatColor}`} />

      <div className="p-3.5">
        {/* Top row: stage info + money */}
        <div className="flex items-start justify-between gap-2.5 mb-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <HeatDot heat={deal.heat_status} />
              <span
                className={`text-[10px] font-extrabold uppercase tracking-[0.08em] ${stageColor}`}
              >
                {deal.stage}
              </span>
              {closesInDays != null && closesInDays >= 0 && closesInDays <= 14 && (
                <span className="text-[10px] font-bold px-[7px] py-[2px] rounded-[10px] bg-emerald-500/15 text-emerald-400 uppercase tracking-[0.04em]">
                  Closes {closesInDays}d
                </span>
              )}
              {stalled && (
                <span className="text-[10px] font-bold px-[7px] py-[2px] rounded-[10px] bg-amber-500/15 text-amber-400 uppercase tracking-[0.04em]">
                  Stalled
                </span>
              )}
            </div>
            <p className="text-base font-extrabold text-foreground tracking-[-0.01em] mb-0.5">
              {deal.customer_name}
            </p>
            <p className="text-xs text-muted-foreground">{deal.deal_name}</p>
          </div>
          <div className="text-right shrink-0">
            {money && (
              <p className="text-lg font-black text-foreground tracking-[-0.01em]">
                {money}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/60 font-semibold">
              {stagePercent}% likely
            </p>
          </div>
        </div>

        {/* Stage progress pips */}
        <div className="flex gap-[3px] mb-2.5">
          {stagePips.map((filled, i) => (
            <div
              key={i}
              className={`flex-1 h-1 rounded-sm ${filled ? stageBgColor : "bg-foreground/[0.06]"}`}
            />
          ))}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground/60 mb-0">
          <span
            className={`flex items-center gap-1 ${stalled ? "text-amber-400 font-bold" : ""}`}
          >
            <Clock className="w-[11px] h-[11px]" />
            {deal.days_since_activity ?? 0}d in stage
          </span>
          <span className="text-white/[0.08]">&bull;</span>
          <span>
            Last:{" "}
            {deal.last_activity_at
              ? new Date(deal.last_activity_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : "N/A"}
          </span>
          {deal.primary_contact_name && (
            <>
              <span className="text-white/[0.08]">&bull;</span>
              <span className="flex items-center gap-1">
                <User2 className="w-[10px] h-[10px]" />
                {deal.primary_contact_name.split(" ")[0]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Quick actions footer */}
      <div
        className="flex border-t border-white/[0.06] bg-foreground/[0.02]"
        onClick={(e) => e.stopPropagation()}
      >
        {deal.primary_contact_phone ? (
          <a
            href={`tel:${deal.primary_contact_phone}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-foreground text-xs font-bold hover:bg-foreground/[0.04] transition-colors"
          >
            <PhoneCall className="w-[13px] h-[13px] text-qep-orange" />
            Call
          </a>
        ) : (
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-foreground text-xs font-bold hover:bg-foreground/[0.04] transition-colors">
            <PhoneCall className="w-[13px] h-[13px] text-qep-orange" />
            Call
          </button>
        )}
        <div className="w-px bg-white/[0.06]" />
        <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-foreground text-xs font-bold hover:bg-foreground/[0.04] transition-colors">
          <FileText className="w-[13px] h-[13px] text-blue-400" />
          Quote
        </button>
        <div className="w-px bg-white/[0.06]" />
        <button
          onClick={handleAdvance}
          disabled={!nextStage || advancing}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-foreground text-xs font-bold hover:bg-foreground/[0.04] transition-colors disabled:opacity-40"
        >
          <ArrowRight className="w-[13px] h-[13px] text-emerald-400" />
          {advancing ? "Moving..." : "Advance"}
        </button>
      </div>

      {advanceError && (
        <p className="px-3.5 py-1.5 text-xs text-red-400 text-center bg-red-500/10">
          {advanceError}
        </p>
      )}
    </div>
  );
}
