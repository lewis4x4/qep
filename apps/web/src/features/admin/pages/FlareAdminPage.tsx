import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Flame, AlertOctagon, Bug, Search, Lightbulb } from "lucide-react";
import { ForwardForecastBar, FilterBar, StatusChipStack, type FilterDef } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { FlareDetailDrawer, type FlareReportRow } from "../components/flare/FlareDetailDrawer";

const SEVERITY_TONE: Record<string, "red" | "orange" | "yellow" | "blue" | "neutral"> = {
  blocker: "red",
  bug: "orange",
  annoyance: "yellow",
  idea: "blue",
};

const STATUS_TONE: Record<string, "blue" | "purple" | "orange" | "green" | "neutral"> = {
  new: "blue",
  triaged: "purple",
  in_progress: "orange",
  fixed: "green",
  wontfix: "neutral",
  duplicate: "neutral",
};

const FILTERS: FilterDef[] = [
  {
    key: "severity", label: "Severity", type: "select",
    options: [
      { value: "blocker", label: "Blocker" },
      { value: "bug", label: "Bug" },
      { value: "annoyance", label: "Annoyance" },
      { value: "idea", label: "Idea" },
    ],
  },
  {
    key: "status", label: "Status", type: "select",
    options: [
      { value: "new", label: "New" },
      { value: "triaged", label: "Triaged" },
      { value: "in_progress", label: "In progress" },
      { value: "fixed", label: "Fixed" },
      { value: "wontfix", label: "Won't fix" },
    ],
  },
  { key: "route", label: "Route", type: "text" },
];

export function FlareAdminPage() {
  const [selectedReport, setSelectedReport] = useState<FlareReportRow | null>(null);
  const [filterValue, setFilterValue] = useState<Record<string, string>>({});

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["flare-admin-queue"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string, o: Record<string, boolean>) => { limit: (n: number) => Promise<{ data: FlareReportRow[] | null; error: unknown }> } } };
      }).from("flare_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("Failed to load flares");
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (filterValue.severity && r.severity !== filterValue.severity) return false;
      if (filterValue.status && r.status !== filterValue.status) return false;
      if (filterValue.route && !(r.route ?? "").includes(filterValue.route)) return false;
      return true;
    });
  }, [reports, filterValue]);

  // Rollup tile counts
  const counts = useMemo(() => {
    const blockers = reports.filter((r) => r.severity === "blocker" && !["fixed", "wontfix", "duplicate"].includes(r.status)).length;
    const bugs = reports.filter((r) => r.severity === "bug" && !["fixed", "wontfix", "duplicate"].includes(r.status)).length;
    const ideas = reports.filter((r) => r.severity === "idea").length;
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;
    const fixedRecent = reports.filter((r) => r.status === "fixed" && r.fixed_at && new Date(r.fixed_at).getTime() > sevenDaysAgo).length;
    return { blockers, bugs, ideas, fixedRecent };
  }, [reports]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div>
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-qep-orange" aria-hidden />
          <h1 className="text-xl font-bold text-foreground">Flare Triage</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Wave 6.11 — in-app context-aware bug capture. Press <kbd className="rounded bg-muted px-1 text-[10px]">⌘+⇧+B</kbd> on any page to file a flare.
        </p>
      </div>

      <ForwardForecastBar
        counters={[
          { label: "Open blockers", value: counts.blockers, tone: "red", icon: <AlertOctagon className="h-4 w-4" /> },
          { label: "Open bugs", value: counts.bugs, tone: "orange", icon: <Bug className="h-4 w-4" /> },
          { label: "Ideas", value: counts.ideas, tone: "blue", icon: <Lightbulb className="h-4 w-4" /> },
          { label: "Fixed last 7d", value: counts.fixedRecent, tone: "green", icon: <Search className="h-4 w-4" /> },
        ]}
      />

      <FilterBar filters={FILTERS} value={filterValue} onChange={setFilterValue} />

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Flame className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-foreground">No flares match the current filter.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {reports.length === 0
              ? "No flares submitted yet. Press ⌘+⇧+B on any page to file the first one."
              : "Try clearing filters above."}
          </p>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card className="overflow-x-auto p-3">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 text-left">Severity / status</th>
                <th className="py-2 text-left">Description</th>
                <th className="py-2 text-left">Reporter</th>
                <th className="py-2 text-left">Route</th>
                <th className="py-2 text-left">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border/50 hover:bg-muted/30"
                  onClick={() => setSelectedReport(r)}
                >
                  <td className="py-2">
                    <StatusChipStack chips={[
                      { label: r.severity, tone: SEVERITY_TONE[r.severity] ?? "neutral" },
                      { label: r.status.replace(/_/g, " "), tone: STATUS_TONE[r.status] ?? "neutral" },
                    ]} />
                  </td>
                  <td className="py-2 text-foreground max-w-md truncate">{r.user_description}</td>
                  <td className="py-2 text-muted-foreground">{r.reporter_email ?? "—"}</td>
                  <td className="py-2 text-muted-foreground font-mono text-[10px]">{r.route ?? "—"}</td>
                  <td className="py-2 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <FlareDetailDrawer report={selectedReport} onClose={() => setSelectedReport(null)} />
    </div>
  );
}
