import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Package,
  Shield,
  Wrench,
  Activity,
  Gauge,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AssetCountdownStack, AskIronAdvisorButton, StatusChipStack } from "@/components/primitives";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";
import { derivePortalAssetLifecycleState } from "../lib/portal-asset-360";
import { normalizePortalFleetDetailItems } from "../lib/portal-row-normalizers";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PortalEquipmentDetailPage() {
  const { equipmentId } = useParams<{ equipmentId: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "fleet-with-status"],
    queryFn: portalApi.getFleetWithStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const item = useMemo(() => {
    const rows = normalizePortalFleetDetailItems(data?.fleet);
    return rows.find((row) => row.id === equipmentId) ?? null;
  }, [data?.fleet, equipmentId]);

  if (isLoading) {
    return (
      <PortalLayout>
        <Card className="h-64 animate-pulse" />
      </PortalLayout>
    );
  }

  if (isError || !item) {
    return (
      <PortalLayout>
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load this machine.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/portal/fleet">
              <ArrowLeft className="mr-1 h-3 w-3" />
              Back to fleet map
            </Link>
          </Button>
        </Card>
      </PortalLayout>
    );
  }

  const title = [item.year, item.make, item.model].filter(Boolean).join(" ") || item.name || "Equipment";
  const lifecycle = derivePortalAssetLifecycleState({
    id: item.id,
    make: item.make ?? "",
    model: item.model ?? "",
    year: item.year,
    serialNumber: item.serial_number,
    currentHours: item.current_hours,
    warrantyExpiry: item.warranty_expiry,
    nextServiceDue: item.next_service_due,
    tradeInInterest: item.trade_in_interest,
    activeServiceJob: item.portal_status?.source_label === "Live shop status"
      ? {
        serviceJobId: "portal-service-job",
        currentStage: item.portal_status.label,
        estimatedCompletion: item.portal_status.eta,
        status: item.portal_status.label,
        lastUpdatedAt: item.portal_status.last_updated_at ?? new Date().toISOString(),
      }
      : null,
    portalStatus: item.portal_status
      ? {
        label: item.portal_status.label,
        source: item.portal_status.source_label === "Live shop status" ? "service_job" : "default",
        sourceLabel: item.portal_status.source_label,
        eta: item.portal_status.eta,
        lastUpdatedAt: item.portal_status.last_updated_at,
      }
      : null,
  });
  const chips: Array<{ label: string; tone: "blue" | "neutral" | "orange" }> = [];
  if (item.serial_number) chips.push({ label: `S/N ${item.serial_number}`, tone: "neutral" });
  if (item.current_hours != null) chips.push({ label: `${Math.round(item.current_hours).toLocaleString()} hrs`, tone: "orange" });
  if (item.portal_status?.label) chips.push({ label: item.portal_status.label, tone: "blue" });

  return (
    <PortalLayout>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="mb-2 h-7 text-[11px]">
          <Link to="/portal/fleet">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to fleet map
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Portal asset view</p>
            <h1 className="mt-1 text-xl font-bold text-foreground">{title}</h1>
            {item.name && item.name !== title ? (
              <p className="mt-1 text-xs text-muted-foreground">{item.name}</p>
            ) : null}
            <div className="mt-2">
              <StatusChipStack chips={chips} />
            </div>
            <div className="mt-3 inline-flex rounded-full border border-qep-orange/25 bg-qep-orange/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-qep-orange">
              {lifecycle.label}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AskIronAdvisorButton
              contextType="portal-asset"
              contextId={item.id}
              contextTitle={title}
              draftPrompt={`I’m reviewing the portal asset ${title}. Explain this machine’s service posture, warranty posture, maintenance timing, and what the customer should do next.`}
              evidence={[
                `Machine: ${title}`,
                `Status: ${item.portal_status?.label ?? "Operational"}`,
                `Warranty expiry: ${item.warranty_expiry ?? "none"}`,
                `Next service due: ${item.next_service_due ?? "none"}`,
                `Current hours: ${item.current_hours ?? "unknown"}`,
              ].join("\n")}
              preferredSurface="sheet"
              variant="inline"
              label="Ask Iron"
            />
            <Button asChild size="sm" variant="outline">
              <Link to={`/portal/service?fleet_id=${item.id}&request_type=repair`}>
                <MessageSquare className="mr-1 h-3.5 w-3.5" />
                Talk to your rep
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/portal/documents?fleet_id=${item.id}`}>
                <FileText className="mr-1 h-3.5 w-3.5" />
                Documents
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Asset lifecycle</p>
          <div className="mt-3 flex items-start gap-3">
            <div className="rounded-xl bg-qep-orange/10 p-2">
              <Sparkles className="h-4 w-4 text-qep-orange" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{lifecycle.label}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{lifecycle.detail}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Activity className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] uppercase tracking-[0.16em]">Service state</p>
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{item.portal_status?.label ?? "Operational"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{item.portal_status?.source_label ?? "Portal fleet record"}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Shield className="h-4 w-4 text-emerald-400" />
                <p className="text-[10px] uppercase tracking-[0.16em]">Warranty</p>
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{formatDate(item.warranty_expiry)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Coverage visibility</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Gauge className="h-4 w-4 text-blue-400" />
                <p className="text-[10px] uppercase tracking-[0.16em]">Hours</p>
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {item.current_hours == null ? "—" : `${Math.round(item.current_hours).toLocaleString()} hrs`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Metered operating time</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Action rail</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-border/60 p-3">
              <p className="text-sm font-semibold text-foreground">Next service due</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.next_service_due)}</p>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <p className="text-sm font-semibold text-foreground">Estimated completion</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.portal_status?.eta ?? item.next_service_due)}</p>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <p className="text-sm font-semibold text-foreground">Last updated</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.portal_status?.last_updated_at)}</p>
            </div>
            {item.trade_in_interest ? (
              <div className="rounded-xl border border-qep-orange/30 bg-qep-orange/5 p-3">
                <p className="text-sm font-semibold text-qep-orange">Trade conversation open</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This machine is flagged for replacement or trade-up discussion with the dealership.
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {item.equipment_id ? (
          <AssetCountdownStack equipmentId={item.equipment_id} />
        ) : (
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Countdowns</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Countdown bars will appear here once this machine is linked to an internal equipment record.
            </p>
          </Card>
        )}

        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Upcoming maintenance</p>
          <div className="mt-2 space-y-2">
            {(item.maintenance_schedules ?? []).length > 0 ? (
              (item.maintenance_schedules ?? []).map((schedule) => (
                <div key={schedule.id} className="rounded-md border border-border/60 px-3 py-2">
                  <p className="text-sm font-medium text-foreground">{schedule.label ?? "Maintenance checkpoint"}</p>
                  <p className="text-xs text-muted-foreground">
                    Due date: {formatDate(schedule.next_due_date)}
                    {schedule.next_due_hours != null ? ` · Due at ${Math.round(schedule.next_due_hours).toLocaleString()} hrs` : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No maintenance schedules are published for this machine yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </PortalLayout>
  );
}
