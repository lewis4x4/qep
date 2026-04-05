import {
  STAGE_LABELS,
  STAGE_COLORS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  DEFAULT_TAT_TARGETS_HOURS,
  MACHINE_DOWN_TAT_TARGETS_HOURS,
} from "../lib/constants";
import type { ServiceStage } from "../lib/constants";
import type { ServiceJobWithRelations } from "../lib/types";
import { Truck, AlertTriangle, Shield, Clock } from "lucide-react";

interface Props {
  job: ServiceJobWithRelations;
  onClick?: () => void;
}

function getTatHealth(job: ServiceJobWithRelations): "green" | "yellow" | "red" {
  const stage = job.current_stage as ServiceStage;
  const isMachineDown = job.status_flags?.includes("machine_down");
  const targets = isMachineDown ? MACHINE_DOWN_TAT_TARGETS_HOURS : DEFAULT_TAT_TARGETS_HOURS;
  const target = targets[stage];
  if (!target) return "green";

  const elapsed = (Date.now() - new Date(job.updated_at).getTime()) / 3_600_000;
  if (elapsed > target) return "red";
  if (elapsed > target * 0.75) return "yellow";
  return "green";
}

const TAT_DOT: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

export function ServiceJobCard({ job, onClick }: Props) {
  const stage = job.current_stage as ServiceStage;
  const isMachineDown = job.status_flags?.includes("machine_down");
  const isWarranty = job.status_flags?.includes("warranty_recall");
  const tatHealth = getTatHealth(job);

  const customerName = job.customer?.name ?? job.requested_by_name ?? "Unknown";
  const machineSummary = job.machine
    ? `${job.machine.make} ${job.machine.model} (${job.machine.serial_number})`
    : "No machine";

  const partsArr = Array.isArray(job.parts) ? job.parts : [];
  const partsTotal = partsArr.length;
  const partsReady = partsArr.filter((p) => p.status === "staged" || p.status === "consumed").length;

  const quoteStatus = job.latest_quote?.[0]?.status ?? job.quotes?.[0]?.status;
  const quoteTotal = job.latest_quote?.[0]?.total ?? job.quotes?.[0]?.total;

  const blockerCount = Array.isArray(job.active_blockers)
    ? job.active_blockers.reduce((sum, b) => sum + (b.count ?? 0), 0)
    : 0;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border bg-card p-3 cursor-pointer hover:shadow-md transition-shadow ${
        isMachineDown ? "border-red-300 ring-1 ring-red-200" : ""
      }`}
    >
      {/* Header: customer + priority */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{customerName}</p>
          <p className="text-xs text-muted-foreground truncate">{machineSummary}</p>
        </div>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${PRIORITY_COLORS[job.priority]}`}>
          {PRIORITY_LABELS[job.priority]}
        </span>
      </div>

      {/* Job summary */}
      {job.customer_problem_summary && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {job.customer_problem_summary}
        </p>
      )}

      {/* Stage badge + TAT */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STAGE_COLORS[stage]}`}>
          {STAGE_LABELS[stage]}
        </span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${TAT_DOT[tatHealth]}`} title={`TAT: ${tatHealth}`} />
      </div>

      {/* Status row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
        {partsTotal > 0 && (
          <span>Parts: {partsReady}/{partsTotal}</span>
        )}
        {job.technician?.full_name && (
          <span>Tech: {job.technician.full_name}</span>
        )}
        {quoteStatus && (
          <span>Quote: {quoteStatus}{quoteTotal != null ? ` $${Number(quoteTotal).toLocaleString()}` : ""}</span>
        )}
        {blockerCount > 0 && (
          <span className="text-red-600 font-medium">{blockerCount} blocker{blockerCount > 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Icons */}
      <div className="flex items-center gap-1.5 mt-2">
        {job.haul_required && <Truck className="w-3.5 h-3.5 text-cyan-600" />}
        {isMachineDown && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
        {isWarranty && <Shield className="w-3.5 h-3.5 text-purple-600" />}
        {tatHealth === "red" && <Clock className="w-3.5 h-3.5 text-red-500" />}
      </div>
    </div>
  );
}
