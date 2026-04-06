import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type AuditChannel = "portal" | "shop" | "vendor" | "system";

/** Infer channel for legacy rows (DB triggers, older payloads without audit_channel). */
function inferAuditChannel(eventType: string, payload: unknown): AuditChannel {
  const p =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const ac = p.audit_channel;
  if (ac === "vendor" || ac === "shop" || ac === "system") return ac;
  if (ac === "portal") return "portal";

  if (eventType.startsWith("order_status_")) return "portal";
  if (
    eventType.includes("vendor_inbound") ||
    eventType.includes("vendor_escalation")
  ) {
    return "vendor";
  }
  if (eventType.includes("portal") || eventType === "portal_submitted") return "portal";
  return "shop";
}

function labelEventType(eventType: string): string {
  const map: Record<string, string> = {
    portal_submitted: "Portal order submitted",
    shop_vendor_inbound: "Vendor inbound (PO / dates)",
    shop_vendor_escalation_seeded: "Vendor escalation opened",
    shop_vendor_escalation_step: "Vendor escalation step",
    shop_parts_plan_batch: "Shop parts plan batch",
    shop_parts_action: "Shop parts action",
    service_job_linked: "Service job linked to run",
    service_job_unlinked: "Service job unlinked",
  };
  if (map[eventType]) return map[eventType];
  if (eventType.startsWith("order_status_")) {
    const st = eventType.replace("order_status_", "");
    return `Portal order → ${st}`;
  }
  return eventType.replace(/_/g, " ");
}

function channelPillClass(ch: AuditChannel): string {
  switch (ch) {
    case "portal":
      return "border-sky-500/35 bg-sky-500/12 text-sky-900 dark:text-sky-100";
    case "vendor":
      return "border-violet-500/35 bg-violet-500/12 text-violet-950 dark:text-violet-100";
    case "system":
      return "border-slate-500/35 bg-slate-500/12 text-slate-900 dark:text-slate-100";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100";
  }
}

function channelLabel(ch: AuditChannel): string {
  switch (ch) {
    case "portal":
      return "Portal";
    case "vendor":
      return "Vendor";
    case "system":
      return "System";
    default:
      return "Shop";
  }
}

export function FulfillmentRunDetailPage() {
  const { runId = "" } = useParams<{ runId: string }>();
  const trimmed = runId.trim();

  const runQuery = useQuery({
    queryKey: ["parts-fulfillment-run", trimmed],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_fulfillment_runs")
        .select("id, workspace_id, status, created_at, updated_at")
        .eq("id", trimmed)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: trimmed.length > 0,
  });

  const eventsQuery = useQuery({
    queryKey: ["parts-fulfillment-events", trimmed],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_fulfillment_events")
        .select("id, event_type, payload, created_at, idempotency_key")
        .eq("fulfillment_run_id", trimmed)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    enabled: trimmed.length > 0 && !!runQuery.data,
  });

  const jobsQuery = useQuery({
    queryKey: ["service-jobs-by-fulfillment-run", trimmed],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select("id, current_stage, customer_problem_summary, created_at")
        .eq("fulfillment_run_id", trimmed)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: trimmed.length > 0 && !!runQuery.data,
  });

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <ServiceSubNav />
      <main aria-labelledby="fulfillment-run-title" className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/service/parts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Parts queue
        </Link>
      </div>

      <div>
        <h1 id="fulfillment-run-title" className="text-2xl font-semibold">
          Fulfillment run
        </h1>
        <p className="text-sm text-muted-foreground">
          Shared audit trail: portal order status, shop picks/plans, and vendor inbound/escalations
          (when the run is linked to a service job).
        </p>
      </div>

      {trimmed.length === 0 && (
        <p className="text-sm text-destructive">Missing run id in URL.</p>
      )}

      {runQuery.isLoading && (
        <div
          className="flex justify-center py-16"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading fulfillment run</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      )}

      {runQuery.isError && (
        <p className="text-sm text-destructive">
          {(runQuery.error as Error)?.message ?? "Failed to load run"}
        </p>
      )}

      {runQuery.data && (
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-sm">
            <span className="text-muted-foreground">Status:</span>{" "}
            <span className="font-medium">{runQuery.data.status}</span>
          </p>
          <p className="text-xs font-mono break-all text-muted-foreground">{runQuery.data.id}</p>
          <p className="text-xs text-muted-foreground">
            Workspace: {runQuery.data.workspace_id}
          </p>
        </div>
      )}

      {runQuery.data === null && !runQuery.isLoading && trimmed.length > 0 && (
        <p className="text-sm text-muted-foreground">
          No fulfillment run found (check workspace access or id).
        </p>
      )}

      {runQuery.data && (
        <>
          <div>
            <h2 className="text-sm font-medium mb-2">Linked service jobs</h2>
            {jobsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (jobsQuery.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No jobs linked to this run.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Stage</th>
                      <th className="text-left p-2">Summary</th>
                      <th className="text-right p-2">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobsQuery.data ?? []).map((j) => (
                      <tr key={j.id} className="border-t">
                        <td className="p-2">{String(j.current_stage ?? "—")}</td>
                        <td className="p-2 max-w-md truncate text-muted-foreground">
                          {String(j.customer_problem_summary ?? "—")}
                        </td>
                        <td className="p-2 text-right">
                          <Link
                            to={`/service?job=${encodeURIComponent(j.id)}`}
                            className="text-primary text-xs underline-offset-2 hover:underline"
                          >
                            Job
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">Events (newest first)</h2>
            <p className="text-[11px] text-muted-foreground mb-2">
              Channel badges: Shop (counter/system), Portal (customer order), Vendor (inbound webhooks /
              escalations). Older rows infer channel from event type when needed. Vendor retries show an
              idempotency key when present (migration 131).
            </p>
            {eventsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (eventsQuery.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No events recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {(eventsQuery.data ?? []).map((ev) => {
                  const ch = inferAuditChannel(ev.event_type, ev.payload);
                  return (
                    <li
                      key={ev.id}
                      className="rounded border border-border/80 bg-muted/20 p-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              channelPillClass(ch),
                            )}
                          >
                            {channelLabel(ch)}
                          </span>
                          <span className="min-w-0 font-sans text-sm font-medium text-foreground">
                            {labelEventType(ev.event_type)}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {ev.created_at ? new Date(ev.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground break-all">
                        {ev.event_type}
                      </p>
                      {ev.idempotency_key ? (
                        <p className="mt-0.5 font-mono text-[10px] text-amber-800/90 dark:text-amber-200/90 break-all">
                          idempotency_key: {String(ev.idempotency_key)}
                        </p>
                      ) : null}
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      </main>
    </div>
  );
}
