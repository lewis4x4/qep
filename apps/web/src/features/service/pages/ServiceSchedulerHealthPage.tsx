import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { Activity } from "lucide-react";

type CronRun = {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  error: string | null;
  metadata: Record<string, unknown>;
};

/** Same worker started twice within this window (possible Path A + Path B overlap). */
const DUPLICATE_WINDOW_MS = 90_000;

function findCloseStartPairs(runs: CronRun[]): { job_name: string; first: string; second: string; deltaSec: number }[] {
  const byJob = new Map<string, CronRun[]>();
  for (const r of runs) {
    const list = byJob.get(r.job_name) ?? [];
    list.push(r);
    byJob.set(r.job_name, list);
  }
  const out: { job_name: string; first: string; second: string; deltaSec: number }[] = [];
  for (const [name, list] of byJob) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const t0 = new Date(sorted[i].started_at).getTime();
      const t1 = new Date(sorted[i + 1].started_at).getTime();
      const delta = t1 - t0;
      if (delta >= 0 && delta < DUPLICATE_WINDOW_MS) {
        out.push({
          job_name: name,
          first: sorted[i].started_at,
          second: sorted[i + 1].started_at,
          deltaSec: Math.round(delta / 1000),
        });
      }
    }
  }
  return out.sort((a, b) => a.deltaSec - b.deltaSec);
}

/**
 * Owner/manager visibility for edge cron workers (service_cron_runs).
 * Scheduler path (GitHub Actions vs pg_cron) is documented in-repo — see SERVICE_ENGINE_PRODUCTION_SIGNOFF.
 */
export function ServiceSchedulerHealthPage() {
  const { data: runs = [], isLoading, error } = useQuery({
    queryKey: ["service-cron-runs"],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("service_cron_runs")
        .select("id, job_name, started_at, finished_at, ok, error, metadata")
        .order("started_at", { ascending: false })
        .limit(150);
      if (qErr) throw qErr;
      return (data ?? []) as CronRun[];
    },
  });

  const byJob = new Map<string, CronRun[]>();
  for (const r of runs) {
    const list = byJob.get(r.job_name) ?? [];
    list.push(r);
    byJob.set(r.job_name, list);
  }

  const recentFailures = runs.filter((r) => !r.ok).slice(0, 20);

  const closePairs = useMemo(() => findCloseStartPairs(runs), [runs]);
  const closePairsPreview = closePairs.slice(0, 15);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduler health</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Recent runs from <code className="text-xs">service_cron_runs</code> (written when workers
            enable logging). Default production path is{" "}
            <strong>GitHub Actions</strong> — see{" "}
            <code className="text-xs">docs/SERVICE_ENGINE_PRODUCTION_SIGNOFF.md</code> for Path A/B and
            duplicate-firing risk. Repo build runs{" "}
            <code className="text-xs">bun run service:cron:path-check</code> so the sign-off doc cannot
            drift unnoticed.
          </p>
        </div>
        <ServiceSubNav />
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-primary" />
          Last run by worker (most recent first)
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...byJob.entries()].map(([name, list]) => {
            const last = list[0];
            return (
              <div
                key={name}
                className="rounded-lg border bg-muted/30 px-3 py-2 text-sm"
              >
                <div className="font-mono text-xs text-foreground">{name}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {last
                    ? `${last.started_at?.slice(0, 19)?.replace("T", " ")} UTC · ${
                        last.ok ? "ok" : "failed"
                      }`
                    : "—"}
                </div>
              </div>
            );
          })}
        </div>
        {byJob.size === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">
            No cron run rows yet. Workers populate this when{" "}
            <code className="text-xs">SERVICE_CRON_RUNS_DISABLED</code> is not set and logging is
            enabled.
          </p>
        )}
      </div>

      {closePairs.length > 0 && (
        <div className="rounded-xl border border-amber-600/35 bg-amber-500/5 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
            Possible duplicate firings
          </h2>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Same <code className="text-[10px]">job_name</code> started twice within{" "}
            {DUPLICATE_WINDOW_MS / 1000}s — often indicates overlapping schedulers (e.g. pg_cron + GitHub
            Actions). Review{" "}
            <code className="text-[10px]">docs/SERVICE_ENGINE_PRODUCTION_SIGNOFF.md</code> and{" "}
            <code className="text-[10px]">bun run service:cron:path-check</code>.
          </p>
          <ul className="space-y-1.5 text-xs font-mono text-amber-950/90 dark:text-amber-100/90">
            {closePairsPreview.map((p) => (
              <li key={`${p.job_name}-${p.first}-${p.second}`} className="break-all">
                {p.job_name} · {p.deltaSec}s apart · {p.first?.slice(0, 19)} → {p.second?.slice(0, 19)}
              </li>
            ))}
          </ul>
          {closePairs.length > closePairsPreview.length && (
            <p className="text-[11px] text-muted-foreground">
              +{closePairs.length - closePairsPreview.length} more in this window
            </p>
          )}
        </div>
      )}

      {recentFailures.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold text-destructive mb-2">Recent failures</h2>
          <ul className="space-y-2 text-sm font-mono text-xs">
            {recentFailures.map((r) => (
              <li key={r.id} className="break-all">
                {r.job_name} · {r.started_at} · {r.error ?? "unknown"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden">
        <div className="bg-muted/50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Raw log (newest 150)
        </div>
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <p className="p-4 text-sm text-destructive">
            {(error as Error).message ?? "Failed to load"}
          </p>
        )}
        {!isLoading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">OK</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">{r.job_name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {r.started_at?.slice(0, 19)?.replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{r.ok ? "yes" : "no"}</td>
                    <td className="px-3 py-2 text-xs text-destructive break-all max-w-md">
                      {r.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
