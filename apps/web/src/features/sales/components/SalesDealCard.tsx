import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { advanceDealStage } from "../lib/sales-api";
import type { RepPipelineDeal } from "../lib/types";

const HEAT_COLORS: Record<string, string> = {
  warm: "bg-emerald-500",
  cooling: "bg-amber-400",
  cold: "bg-red-500",
};

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
      className="bg-white rounded-xl border border-slate-200 px-4 py-3.5 hover:shadow-sm transition-shadow cursor-pointer active:bg-slate-50"
    >
      <div className="flex items-start gap-3">
        {/* Heat indicator */}
        <div
          className={cn(
            "w-2.5 h-2.5 rounded-full mt-1.5 shrink-0",
            HEAT_COLORS[deal.heat_status] ?? "bg-slate-300",
          )}
          title={`${deal.heat_status} — ${deal.days_since_activity ?? "?"}d since activity`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {deal.customer_name}
            </p>
            {deal.amount != null && (
              <span className="text-sm font-bold text-slate-800 shrink-0 ml-2">
                ${deal.amount >= 1000
                  ? `${(deal.amount / 1000).toFixed(0)}K`
                  : deal.amount.toLocaleString()}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600 mt-0.5 truncate">
            {deal.deal_name}
          </p>

          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
              {deal.stage}
            </span>
            {deal.days_since_activity != null && (
              <span className="text-[10px] text-slate-400">
                {deal.days_since_activity}d since activity
              </span>
            )}
          </div>

          {deal.expected_close_on && (
            <p className="text-[10px] text-slate-400 mt-1">
              Expected close:{" "}
              {new Date(deal.expected_close_on).toLocaleDateString()}
            </p>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
      </div>

      {/* Quick advance button */}
      {nextStage && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAdvance();
          }}
          disabled={advancing}
          className="mt-2 w-full py-2 text-xs font-medium text-qep-orange bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50"
        >
          {advancing
            ? "Moving..."
            : `Move to ${nextStage.name} \u2192`}
        </button>
      )}
      {advanceError && (
        <p className="mt-1 text-xs text-red-500 text-center">{advanceError}</p>
      )}
    </div>
  );
}
