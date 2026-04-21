import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Inbox, AlertOctagon, AlertTriangle, Info, Check, X, RotateCcw, ChevronRight,
} from "lucide-react";
import { AskIronAdvisorButton, FilterBar, type FilterDef } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { resolveEntityAction, resolveExceptionPlaybook } from "../lib/action-links";

interface ExceptionRow {
  id: string;
  source: string;
  severity: "info" | "warn" | "error" | "critical";
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  entity_table: string | null;
  entity_id: string | null;
  status: "open" | "in_progress" | "resolved" | "dismissed";
  created_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  tax_failed:              "Tax lookup failed",
  price_unmatched:         "Price file unmatched row",
  health_refresh_failed:   "Health score refresh failed",
  ar_override_pending:     "AR override pending approval",
  stripe_mismatch:         "Stripe webhook mismatch",
  portal_reorder_approval: "Portal reorder approval",
  sop_evidence_mismatch:   "SOP evidence mismatch",
  geofence_conflict:       "Geofence event conflict",
  stale_telematics:        "Stale telematics",
  doc_visibility:          "Document visibility issue",
  data_quality:            "Data quality issue",
};

const SEVERITY: Record<string, { icon: React.ReactNode; color: string }> = {
  critical: { icon: <AlertOctagon className="h-3 w-3" />,    color: "text-red-400 border-red-500/50" },
  error:    { icon: <AlertOctagon className="h-3 w-3" />,    color: "text-red-400 border-red-500/30" },
  warn:     { icon: <AlertTriangle className="h-3 w-3" />,   color: "text-amber-400 border-amber-500/30" },
  info:     { icon: <Info className="h-3 w-3" />,            color: "text-blue-400 border-blue-500/30" },
};

const FILTERS: FilterDef[] = [
  {
    key: "severity", label: "Severity", type: "select",
    options: [
      { value: "critical", label: "Critical" },
      { value: "error",    label: "Error" },
      { value: "warn",     label: "Warning" },
      { value: "info",     label: "Info" },
    ],
  },
];

export function ExceptionInboxPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<Record<string, string>>({});

  const { data = [], isLoading } = useQuery({
    queryKey: ["exceptions", "inbox"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: Record<string, boolean>) => { limit: (n: number) => Promise<{ data: ExceptionRow[] | null; error: unknown }> } } } };
      }).from("exception_queue")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("Failed to load exceptions");
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; status: ExceptionRow["status"]; reason?: string }) => {
      const patch: Record<string, unknown> = { status: input.status };
      if (input.status === "resolved" || input.status === "dismissed") {
        patch.resolved_at = new Date().toISOString();
        if (input.reason) patch.resolution_reason = input.reason;
      }
      const { error } = await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
      }).from("exception_queue").update(patch).eq("id", input.id);
      if (error) throw new Error("Update failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exceptions", "inbox"] }),
  });

  const filtered = useMemo(() => {
    const sev = filterValue.severity;
    return sev ? data.filter((e) => e.severity === sev) : data;
  }, [data, filterValue]);

  const counts = useMemo(() => {
    const out = { critical: 0, error: 0, warn: 0, info: 0 };
    for (const e of data) out[e.severity] = (out[e.severity] ?? 0) + 1;
    return out;
  }, [data]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Exception Inbox</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cross-functional human work queue. Anything that needs a person to look at it lands here.
          </p>
        </div>
        <AskIronAdvisorButton contextType="exception_inbox" variant="inline" />
      </div>

      {/* Severity tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Critical" value={counts.critical} color="text-red-400" />
        <Tile label="Error"    value={counts.error}    color="text-red-400" />
        <Tile label="Warn"     value={counts.warn}     color="text-amber-400" />
        <Tile label="Info"     value={counts.info}     color="text-blue-400" />
      </div>

      <FilterBar filters={FILTERS} value={filterValue} onChange={setFilterValue} />

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Check className="mx-auto h-8 w-8 text-emerald-400 mb-2" aria-hidden />
          <p className="text-sm text-foreground">Inbox zero.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            New exceptions show up here when an edge function flags something a human needs to handle.
          </p>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((e) => {
            const sev = SEVERITY[e.severity];
            const isExpanded = expandedId === e.id;
            const entityAction = resolveEntityAction(e);
            const playbookAction = resolveExceptionPlaybook(e.source, e);
            return (
              <Card key={e.id} className={`p-3 ${sev?.color ?? ""}`}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-start gap-2">
                    {sev?.icon}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                          {SOURCE_LABELS[e.source] ?? e.source}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-foreground">{e.title}</p>
                      {e.detail && !isExpanded && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{e.detail}</p>
                      )}
                    </div>
                    <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-3 border-t border-border pt-3 space-y-2">
                    {e.detail && <p className="text-xs text-foreground">{e.detail}</p>}
                    {Object.keys(e.payload ?? {}).length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">
                          Payload
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted/20 p-2 text-[10px] text-muted-foreground">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      {entityAction && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to={entityAction.href}>{entityAction.label}</Link>
                        </Button>
                      )}
                      {playbookAction && (
                        <Button asChild size="sm" variant="outline">
                          <Link to={playbookAction.href}>{playbookAction.label}</Link>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateMutation.mutate({ id: e.id, status: "in_progress" })}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" /> Take it
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateMutation.mutate({ id: e.id, status: "dismissed", reason: "dismissed from inbox" })}
                      >
                        <X className="mr-1 h-3 w-3" /> Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateMutation.mutate({ id: e.id, status: "resolved" })}
                      >
                        <Check className="mr-1 h-3 w-3" /> Resolve
                      </Button>
                    </div>
                    {updateMutation.isError && updateMutation.variables?.id === e.id && (
                      <p className="mt-1 text-xs text-destructive">
                        {(updateMutation.error as Error)?.message ?? "Update failed"}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </Card>
  );
}
