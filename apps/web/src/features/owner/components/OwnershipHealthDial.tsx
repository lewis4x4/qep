/**
 * OwnershipHealthDial — circular SVG dial for the composite 0–100 score.
 *
 * Slice B placeholder: renders the live score + per-dimension sub-scores as a
 * summary card. The animated SVG arc + dimensional breakdown drawer lands in
 * Slice C so we can ship the skeleton now.
 */
import { useQuery } from "@tanstack/react-query";
import { Gauge, ShieldCheck, AlertTriangle, TrendingUp } from "lucide-react";
import { fetchOwnershipHealthScore, type OwnershipHealthScore } from "../lib/owner-api";

const TIER_STYLES: Record<OwnershipHealthScore["tier"], { label: string; ring: string; text: string; bg: string }> = {
  excellent: { label: "Excellent", ring: "ring-emerald-400/40", text: "text-emerald-300", bg: "from-emerald-500/10" },
  healthy:   { label: "Healthy",   ring: "ring-qep-orange/40", text: "text-qep-orange", bg: "from-orange-500/10" },
  attention: { label: "Attention", ring: "ring-amber-400/40", text: "text-amber-300", bg: "from-amber-500/10" },
  critical:  { label: "Critical",  ring: "ring-rose-500/50",  text: "text-rose-300",  bg: "from-rose-500/10" },
};

export function OwnershipHealthDial() {
  const q = useQuery<OwnershipHealthScore>({
    queryKey: ["owner", "health-score"],
    queryFn: fetchOwnershipHealthScore,
    refetchInterval: 120_000,
  });

  const tier = q.data?.tier ?? "healthy";
  const style = TIER_STYLES[tier];
  const score = q.data?.score ?? null;
  const dims = q.data?.dimensions;

  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-gradient-to-br ${style.bg} to-transparent p-6 backdrop-blur`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            Ownership Health
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Composite Score
          </h2>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${style.ring} ${style.text}`}>
          {tier === "excellent" ? <ShieldCheck className="h-3 w-3" /> : tier === "critical" ? <AlertTriangle className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
          {style.label}
        </span>
      </div>

      <div className="mt-6 flex items-center gap-5">
        <div className="relative grid h-32 w-32 place-items-center rounded-full border border-white/10 bg-black/30">
          <Gauge className="absolute h-28 w-28 text-white/10" />
          <span className={`relative text-5xl font-semibold tracking-tight ${style.text}`}>
            {q.isLoading ? "…" : q.isError ? "!" : score ?? "—"}
          </span>
        </div>
        <div className="flex-1 space-y-2">
          {dims ? (
            (Object.entries(dims) as [keyof typeof dims, number][]).map(([k, v]) => (
              <DimBar key={k} name={k} value={v} />
            ))
          ) : (
            <p className="text-sm text-slate-400">Score is loading…</p>
          )}
        </div>
      </div>

      <p className="mt-5 text-xs text-slate-400">
        Weighted across Parts · Sales · Service · Rental · Finance. Animated dial + trend arrow ship in Slice C.
      </p>
    </div>
  );
}

function DimBar({ name, value }: { name: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = value >= 85 ? "bg-emerald-400" : value >= 70 ? "bg-qep-orange" : value >= 55 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {name}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-medium text-slate-200">
        {value}
      </span>
    </div>
  );
}
