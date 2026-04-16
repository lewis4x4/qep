/**
 * PredictiveInterventionPanel — forward-looking "what happens if" cards.
 *
 * Slice B placeholder: renders the panel scaffold + a static preview card.
 * Claude-powered scenario generation lands in Slice E.
 */
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Compass } from "lucide-react";
import {
  fetchPredictiveInterventions,
  type PredictiveIntervention,
  type PredictiveInterventionsResponse,
} from "../lib/owner-api";

const SEVERITY_STYLE = {
  high: "border-rose-500/30 text-rose-300",
  medium: "border-amber-500/30 text-amber-300",
  low: "border-emerald-500/25 text-emerald-300",
};

export function PredictiveInterventionPanel() {
  const navigate = useNavigate();
  const q = useQuery<PredictiveInterventionsResponse>({
    queryKey: ["owner", "predictive-interventions"],
    queryFn: fetchPredictiveInterventions,
    staleTime: 30 * 60_000,
    retry: 0,
  });

  const items = q.data?.interventions ?? FALLBACK;

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-qep-orange/90">
            Forward View
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Predictive Interventions
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Claude projects where trends lead and what to do about it. Scenario engine ships in Slice E.
          </p>
        </div>
        <Compass className="h-6 w-6 text-qep-orange/70" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i, idx) => (
          <article
            key={`${i.title}-${idx}`}
            className={`flex flex-col gap-3 rounded-2xl border bg-white/[0.02] p-4 ${SEVERITY_STYLE[i.severity]}`}
          >
            <span className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
              {i.severity}
            </span>
            <h3 className="text-sm font-semibold text-white">{i.title}</h3>
            <p className="text-sm leading-snug text-slate-200">{i.projection}</p>
            <p className="text-xs leading-snug text-slate-400">{i.rationale}</p>
            <button
              type="button"
              onClick={() => navigate(i.action.route)}
              className="mt-auto inline-flex w-fit items-center gap-1 rounded-full border border-qep-orange/30 bg-qep-orange/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-qep-orange hover:bg-qep-orange/20"
            >
              {i.action.label} <ArrowRight className="h-3 w-3" />
            </button>
          </article>
        ))}
      </div>

      {q.isError && !q.data && (
        <p className="mt-3 text-xs text-amber-400/80">
          Showing preview scenarios — live engine pending deploy.
        </p>
      )}
    </div>
  );
}

const FALLBACK: PredictiveIntervention[] = [
  {
    title: "Dead capital trajectory",
    projection: "At the current growth rate, dead capital crosses $100K in ~6 weeks.",
    rationale: "12 SKUs drive 60% of the accumulation — most in the Bandit knife family and Yanmar idle filters.",
    severity: "medium",
    action: { label: "Run clearance", route: "/parts/companion/intelligence" },
  },
  {
    title: "Pipeline fade risk",
    projection: "Pipeline closes $80K below forecast without intervention on 4 stalled deals.",
    rationale: "Deals haven't moved in 12+ days. Two are at proposal, two at verbal commit.",
    severity: "high",
    action: { label: "Open deal board", route: "/qrm/deals" },
  },
  {
    title: "Critical stockout pressure",
    projection: "Service jobs will start waiting on parts within 10 days if replenish queue isn't released.",
    rationale: "Oil filters, hydraulic hoses, and Yanmar belts are all at or below reorder point.",
    severity: "high",
    action: { label: "Review queue", route: "/parts/companion/replenish" },
  },
];
