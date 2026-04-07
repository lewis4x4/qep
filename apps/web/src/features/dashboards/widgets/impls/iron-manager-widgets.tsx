/**
 * Iron Manager widget impls — pipeline-by-rep, approval queue, inventory aging.
 *
 * Each is a thin presentation wrapper over useIronManagerData. They share the
 * same React Query cache so mounting all three on one dashboard issues a
 * single network round-trip.
 */
import { Widget } from "../Widget";
import { PipelineHealthByRepCard } from "../../components/PipelineHealthByRepCard";
import { ApprovalQueue } from "../../components/ApprovalQueue";
import { InventoryAgingCard } from "../../components/InventoryAgingCard";
import { useIronManagerData } from "../../hooks/useDashboardData";
import { Users, AlertTriangle, Package } from "lucide-react";

/** PostgREST may return numeric columns as strings; calling .toFixed on a string throws. */
function formatPercentLabel(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(1);
}

export function PipelineByRepWidget() {
  const { data, isLoading, isError } = useIronManagerData();
  return (
    <Widget
      title="Pipeline by advisor"
      description="Open-deal swim lanes for each advisor."
      icon={<Users className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load pipeline." : null}
    >
      <PipelineHealthByRepCard rows={data?.pipelineHealthByRep ?? []} />
    </Widget>
  );
}

export function ApprovalQueueWidget() {
  const { data, isLoading, isError } = useIronManagerData();
  const items = [
    ...(data?.pendingDemos ?? []).map((d: any) => ({
      id: d.id,
      deal_id: d.deal_id,
      type: "demo" as const,
      label: "Demo Request",
      detail: `${d.equipment_category} demo`,
    })),
    ...(data?.pendingTrades ?? []).map((t: any) => ({
      id: t.id,
      deal_id: t.deal_id,
      type: "trade" as const,
      label: `${t.make} ${t.model}`,
      detail: `Preliminary: $${t.preliminary_value?.toLocaleString() ?? "N/A"}`,
    })),
    ...(data?.marginFlags ?? []).map((m: any) => ({
      id: m.id,
      deal_id: m.id,
      type: "margin" as const,
      label: m.name,
      detail: `Margin: ${formatPercentLabel(m.margin_pct)}%`,
    })),
  ];
  return (
    <Widget
      title="Approvals waiting"
      description="Demos, trades, and margin flags."
      icon={<AlertTriangle className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load approvals." : null}
    >
      <ApprovalQueue items={items} />
    </Widget>
  );
}

export function InventoryAgingWidget() {
  const { data, isLoading, isError } = useIronManagerData();
  return (
    <Widget
      title="Aging fleet"
      description="Equipment 90+ days in registry."
      icon={<Package className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load inventory." : null}
    >
      <InventoryAgingCard items={data?.agingEquipment ?? []} />
    </Widget>
  );
}
