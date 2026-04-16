/**
 * OwnerKpiTile — the premium KPI card for /owner.
 *
 * Shares the visual language of ExecutiveKpiCard (dark glass, orange rail,
 * text-4xl hero number) but is self-contained so the owner page can render
 * without the exec lens/metric definition plumbing.
 */
import { Card } from "@/components/ui/card";
import { ArrowRight, Activity, TrendingDown, TrendingUp, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Tone = "neutral" | "good" | "warning" | "critical";

export interface OwnerKpiTileProps {
  eyebrow: string;
  label: string;
  hero: string;
  subline?: string;
  delta?: { pct?: number | null; label?: string; tone?: Tone };
  secondary?: { label: string; value: string }[];
  icon?: LucideIcon;
  tone?: Tone;
  onDrill?: () => void;
  drillLabel?: string;
}

const toneRing: Record<Tone, string> = {
  neutral: "border-white/10",
  good: "border-emerald-400/25",
  warning: "border-amber-500/30",
  critical: "border-rose-500/40",
};

export function OwnerKpiTile({
  eyebrow,
  label,
  hero,
  subline,
  delta,
  secondary,
  icon: Icon = Activity,
  tone = "neutral",
  onDrill,
  drillLabel = "Drill down",
}: OwnerKpiTileProps) {
  const deltaTone: Tone = delta?.tone ?? (
    delta?.pct == null ? "neutral" : delta.pct >= 0 ? "good" : "warning"
  );
  const deltaColor =
    deltaTone === "good"
      ? "text-emerald-300"
      : deltaTone === "warning"
      ? "text-amber-300"
      : deltaTone === "critical"
      ? "text-rose-300"
      : "text-slate-400";
  const DeltaIcon = delta?.pct == null ? Waves : delta.pct >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card
      className={`group relative flex min-h-[220px] flex-col overflow-hidden rounded-[1.5rem] border bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-5 shadow-[0_20px_40px_rgba(2,6,23,0.18)] transition duration-200 hover:border-qep-orange/35 hover:shadow-[0_24px_60px_rgba(2,6,23,0.28)] ${toneRing[tone]}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
              {eyebrow}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2">
            <h3 className="text-base font-semibold leading-tight text-white sm:text-lg">
              {label}
            </h3>
          </div>
          {subline && (
            <p className="mt-2 text-sm leading-5 text-slate-400">{subline}</p>
          )}
        </div>
        <span className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-qep-orange">
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-6 flex items-end gap-3">
        <span className="text-4xl font-semibold tracking-tight text-white sm:text-[2.6rem]">
          {hero}
        </span>
      </div>

      {(delta || secondary?.length) && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {delta && (
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {delta.label ?? "Delta"}
              </p>
              <div className={`mt-2 flex items-center gap-2 text-sm ${deltaColor}`}>
                <DeltaIcon className="h-3.5 w-3.5" />
                {delta.pct != null ? (
                  <span>
                    {delta.pct >= 0 ? "+" : ""}
                    {delta.pct.toFixed(1)}%
                  </span>
                ) : (
                  <span>No comparison yet</span>
                )}
              </div>
            </div>
          )}
          {secondary?.slice(0, 1).map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {s.label}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-200">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {onDrill && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
          <button
            type="button"
            onClick={onDrill}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-qep-orange/25 bg-qep-orange/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-qep-orange transition hover:border-qep-orange/40 hover:bg-qep-orange/15"
          >
            {drillLabel} <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  );
}
