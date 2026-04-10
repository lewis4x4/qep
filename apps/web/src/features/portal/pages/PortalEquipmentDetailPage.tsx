import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, MessageSquare, Package, Shield, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AssetCountdownStack, StatusChipStack } from "@/components/primitives";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";

interface MaintenanceScheduleRow {
  id: string;
  label?: string | null;
  next_due_date?: string | null;
  next_due_hours?: number | null;
}

interface PortalFleetDetailItem {
  id: string;
  equipment_id?: string | null;
  make: string | null;
  model: string | null;
  name?: string | null;
  year: number | null;
  serial_number: string | null;
  current_hours: number | null;
  warranty_expiry: string | null;
  next_service_due: string | null;
  trade_in_interest?: boolean;
  portal_status?: {
    label: string;
    source_label: string;
    eta: string | null;
    last_updated_at: string | null;
  } | null;
  maintenance_schedules?: MaintenanceScheduleRow[] | null;
}

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
    const rows = (data?.fleet ?? []) as unknown as PortalFleetDetailItem[];
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
          </div>
          <div className="flex flex-wrap gap-2">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Service mirror</p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <Wrench className="h-4 w-4 text-qep-orange" />
              <span>{item.portal_status?.label ?? "Operational"}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Source: {item.portal_status?.source_label ?? "Portal fleet record"}
            </p>
            <p className="text-xs text-muted-foreground">
              ETA: {formatDate(item.portal_status?.eta ?? item.next_service_due)}
            </p>
            <p className="text-xs text-muted-foreground">
              Last updated: {formatDate(item.portal_status?.last_updated_at)}
            </p>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ownership snapshot</p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <Shield className="h-4 w-4 text-emerald-400" />
              <span>Warranty expires {formatDate(item.warranty_expiry)}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground">
              <Package className="h-4 w-4 text-blue-400" />
              <span>Next service due {formatDate(item.next_service_due)}</span>
            </div>
            {item.trade_in_interest ? (
              <p className="text-xs font-medium text-qep-orange">Trade-in interest is flagged for this machine.</p>
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
