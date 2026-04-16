/**
 * TeamSignalsGrid — per-rep YTD performance panel for Tier 5.
 *
 * Reads owner_team_signals() and renders a compact leaderboard with
 * outlier highlighting (top 25% = green ring, bottom 25% = amber).
 */
import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp } from "lucide-react";
import { fetchOwnerTeamSignals, type TeamSignalRep, type TeamSignalsResponse } from "../lib/owner-api";

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function quartile(value: number, values: number[]): number {
  if (values.length < 2) return 2;
  const sorted = [...values].sort((a, b) => b - a);
  const rank = sorted.indexOf(value);
  const pct = rank / Math.max(1, sorted.length - 1);
  if (pct <= 0.25) return 1; // top
  if (pct <= 0.5) return 2;
  if (pct <= 0.75) return 3;
  return 4; // bottom
}

export function TeamSignalsGrid() {
  const q = useQuery<TeamSignalsResponse>({
    queryKey: ["owner", "team-signals"],
    queryFn: () => fetchOwnerTeamSignals(12),
    refetchInterval: 180_000,
  });

  const reps = q.data?.reps ?? [];
  const bookings = reps.map((r) => Number(r.ytd_bookings ?? 0));
  const closeRates = reps.map((r) => Number(r.close_rate_pct ?? 0));

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            Team Signals
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">Rep Performance · YTD</h3>
          <p className="mt-1 text-xs text-slate-400">
            Green ring = top quartile · amber = bottom quartile.
          </p>
        </div>
        <Users className="h-6 w-6 text-qep-orange/70" />
      </div>

      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.isError && (
        <p className="text-sm text-rose-300">{(q.error as Error).message}</p>
      )}
      {q.data && reps.length === 0 && (
        <p className="text-sm text-slate-400">
          No rep bookings recorded this year yet.
        </p>
      )}

      {reps.length > 0 && (
        <ul className="space-y-2">
          {reps.map((rep) => (
            <RepRow
              key={`${rep.rep_id}-${rep.rep_name}`}
              rep={rep}
              bookingsQ={quartile(Number(rep.ytd_bookings ?? 0), bookings)}
              closeRateQ={quartile(Number(rep.close_rate_pct ?? 0), closeRates)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RepRow({
  rep,
  bookingsQ,
  closeRateQ,
}: {
  rep: TeamSignalRep;
  bookingsQ: number;
  closeRateQ: number;
}) {
  const ring =
    bookingsQ === 1
      ? "ring-emerald-400/40"
      : bookingsQ === 4
      ? "ring-amber-400/40"
      : "ring-white/10";
  return (
    <li className={`flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 ring-1 ring-inset ${ring}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{rep.rep_name}</p>
        <p className="text-[11px] text-slate-500">
          {rep.ytd_wins} won · {rep.open_deals} open
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-white tabular-nums">
          {fmtUsd(Number(rep.ytd_bookings ?? 0))}
        </p>
        <p className={`text-[11px] tabular-nums ${
          closeRateQ === 1 ? "text-emerald-300" : closeRateQ === 4 ? "text-amber-300" : "text-slate-400"
        }`}>
          <TrendingUp className="mr-0.5 inline h-2.5 w-2.5" />
          {rep.close_rate_pct != null ? `${Number(rep.close_rate_pct).toFixed(0)}% close` : "—"}
          {rep.avg_close_days != null ? ` · ${Math.round(Number(rep.avg_close_days))}d` : ""}
        </p>
      </div>
    </li>
  );
}
