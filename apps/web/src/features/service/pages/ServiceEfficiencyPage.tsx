import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function ServiceEfficiencyPage() {
  const { data: openMetrics = [], isLoading: loadingOpen } = useQuery({
    queryKey: ["service-tat-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_tat_metrics")
        .select("id, job_id, segment_name, target_duration_hours, actual_duration_hours, is_machine_down")
        .is("completed_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: completedMetrics = [], isLoading: loadingDone } = useQuery({
    queryKey: ["service-tat-metrics-completed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_tat_metrics")
        .select("id, job_id, segment_name, target_duration_hours, actual_duration_hours, completed_at")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: techRows = [] } = useQuery({
    queryKey: ["technician-workload-efficiency"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technician_profiles")
        .select("user_id, active_workload, branch_id")
        .order("active_workload", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  const onTimePct = (() => {
    const rows = completedMetrics as Array<{
      target_duration_hours?: number | null;
      actual_duration_hours?: number | null;
    }>;
    if (rows.length === 0) return null;
    let ok = 0;
    for (const m of rows) {
      const tgt = Number(m.target_duration_hours ?? 0);
      const act = Number(m.actual_duration_hours ?? 0);
      if (tgt <= 0) continue;
      if (act <= tgt * 1.05) ok++;
    }
    return Math.round((ok / rows.length) * 100);
  })();

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Service efficiency</h1>
        <p className="text-sm text-muted-foreground">
          Open TAT segments, recent completed segments, and technician workload (utilization proxy).
        </p>
      </div>

      {onTimePct != null && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">On-time (completed segments, ~5% tolerance)</p>
          <p className="text-2xl font-semibold">{onTimePct}%</p>
          <p className="text-xs text-muted-foreground">Based on last {completedMetrics.length} completed rows</p>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium mb-2">Technician workload (active job count)</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Branch</th>
                <th className="text-right p-2">Load</th>
              </tr>
            </thead>
            <tbody>
              {techRows.map((t: Record<string, unknown>) => (
                <tr key={String(t.user_id)} className="border-t">
                  <td className="p-2 font-mono text-xs">{String(t.user_id).slice(0, 8)}…</td>
                  <td className="p-2">{String(t.branch_id ?? "—")}</td>
                  <td className="p-2 text-right">{Number(t.active_workload ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-2">Active TAT segments</h2>
        {loadingOpen ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MetricsTable metrics={openMetrics} showCompleted={false} />
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium mb-2">Recently completed segments</h2>
        {loadingDone ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MetricsTable metrics={completedMetrics} showCompleted />
        )}
      </div>
    </div>
  );
}

function MetricsTable({
  metrics,
  showCompleted,
}: {
  metrics: Record<string, unknown>[];
  showCompleted: boolean;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2">Job</th>
            <th className="text-left p-2">Stage</th>
            <th className="text-right p-2">Target h</th>
            <th className="text-right p-2">Actual h</th>
            {showCompleted && <th className="text-left p-2">Completed</th>}
            <th className="text-left p-2">Health</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m: Record<string, unknown>) => {
            const tgt = Number(m.target_duration_hours ?? 0);
            const act = Number(m.actual_duration_hours ?? 0);
            const ratio = tgt > 0 ? act / tgt : 0;
            const health = ratio <= 1 ? "ok" : ratio <= 1.25 ? "warn" : "bad";
            const cls =
              health === "ok"
                ? "text-green-600"
                : health === "warn"
                  ? "text-amber-600"
                  : "text-red-600";
            return (
              <tr key={m.id as string} className="border-t">
                <td className="p-2 font-mono text-xs">{(m.job_id as string).slice(0, 8)}…</td>
                <td className="p-2">{m.segment_name as string}</td>
                <td className="p-2 text-right">{tgt}</td>
                <td className="p-2 text-right">{act}</td>
                {showCompleted && (
                  <td className="p-2 text-xs text-muted-foreground">
                    {m.completed_at ? new Date(String(m.completed_at)).toLocaleString() : "—"}
                  </td>
                )}
                <td className={`p-2 capitalize ${cls}`}>{health}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
