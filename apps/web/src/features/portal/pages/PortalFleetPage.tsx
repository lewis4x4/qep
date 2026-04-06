import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Wrench, Shield, Activity, FileText, Package } from "lucide-react";

/* ── Customer-safe service stage labels (match portal server mapping) ── */
const JOB_STAGE_LABEL: Record<string, string> = {
  request_received: "Request received",
  triaging: "Being reviewed",
  diagnosis_selected: "Diagnosis confirmed",
  quote_drafted: "Quote in progress",
  quote_sent: "Quote sent",
  approved: "Approved",
  parts_pending: "Waiting on parts",
  parts_staged: "Parts ready",
  haul_scheduled: "Transport scheduled",
  scheduled: "Appointment scheduled",
  in_progress: "In progress",
  blocked_waiting: "Waiting",
  quality_check: "Quality review",
  ready_for_pickup: "Ready for pickup",
  invoice_ready: "Invoice ready",
  invoiced: "Invoiced",
  paid_closed: "Completed",
};

interface ServiceJobSummary {
  service_job_id: string;
  current_stage: string;
  estimated_completion: string | null;
  status: string;
  last_updated_at: string;
}

interface FleetItem {
  id: string;
  make: string;
  model: string;
  year: number | null;
  serial_number: string | null;
  current_hours: number | null;
  warranty_expiry: string | null;
  next_service_due: string | null;
  trade_in_interest?: boolean;
  active_service_job?: ServiceJobSummary | null;
}

function statusColor(stage: string): { bg: string; text: string } {
  if (stage === "ready_for_pickup" || stage === "paid_closed") return { bg: "bg-emerald-500/10", text: "text-emerald-400" };
  if (stage === "blocked_waiting" || stage === "parts_pending") return { bg: "bg-red-500/10", text: "text-red-400" };
  if (stage === "in_progress" || stage === "quality_check") return { bg: "bg-blue-500/10", text: "text-blue-400" };
  return { bg: "bg-amber-500/10", text: "text-amber-400" };
}

function formatETA(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function PortalFleetPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "fleet-with-status"],
    queryFn: portalApi.getFleetWithStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const fleet = (data?.fleet ?? []) as unknown as FleetItem[];

  return (
    <PortalLayout>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">My Equipment Fleet</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Live shop status, warranty coverage, and service schedules for your equipment.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-32 animate-pulse" />)}
        </div>
      )}

      {isError && (
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load fleet.</p>
        </Card>
      )}

      <div className="space-y-3">
        {fleet.map((item) => {
          const job = item.active_service_job;
          const inShop = !!job;
          const stageInfo = inShop ? statusColor(job.current_stage) : null;
          const etaLabel = job?.estimated_completion ? formatETA(job.estimated_completion) : null;

          return (
            <Card key={item.id} className={`p-4 ${inShop ? "border-l-4 border-l-blue-500" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {item.make} {item.model}{item.year ? ` (${item.year})` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    {item.serial_number && <span>S/N: {item.serial_number}</span>}
                    {item.current_hours && <span>{item.current_hours.toLocaleString()} hrs</span>}
                  </div>
                </div>

                <div className="shrink-0 text-right space-y-1">
                  {item.warranty_expiry && (
                    <div className="flex items-center justify-end gap-1 text-[11px]">
                      <Shield className={`h-3 w-3 ${new Date(item.warranty_expiry) > new Date() ? "text-emerald-400" : "text-red-400"}`} aria-hidden />
                      <span className="text-muted-foreground">{item.warranty_expiry}</span>
                    </div>
                  )}
                  {item.next_service_due && (
                    <div className="flex items-center justify-end gap-1 text-[11px]">
                      <Wrench className="h-3 w-3 text-amber-400" aria-hidden />
                      <span className="text-muted-foreground">Next: {item.next_service_due}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Live service job status block (Bobby's "your Yanmar is in the shop") */}
              {inShop && job && stageInfo && (
                <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-blue-400" aria-hidden />
                      <p className="text-xs font-bold uppercase tracking-wider text-blue-400">In the shop</p>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${stageInfo.bg} ${stageInfo.text}`}>
                        {JOB_STAGE_LABEL[job.current_stage] ?? job.current_stage}
                      </span>
                    </div>
                    {etaLabel && (
                      <p className="text-[11px] text-muted-foreground">
                        Est. completion: <strong className="text-foreground">{etaLabel}</strong>
                      </p>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Last updated: {new Date(job.last_updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
              )}

              {/* Quick actions */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm" className="h-7 text-[11px]">
                    <Link to={`/portal/documents?fleet_id=${item.id}`}>
                      <FileText className="mr-1 h-3 w-3" aria-hidden />
                      Documents
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-7 text-[11px]">
                    <Link to={`/portal/parts?fleet_id=${item.id}`}>
                      <Package className="mr-1 h-3 w-3" aria-hidden />
                      Parts history
                    </Link>
                  </Button>
                </div>
                {item.trade_in_interest && (
                  <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[9px] font-semibold text-qep-orange">
                    Trade-in interest flagged
                  </span>
                )}
              </div>
            </Card>
          );
        })}

        {!isLoading && fleet.length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No equipment in your fleet yet.</p>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
