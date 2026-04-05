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
import { Truck, AlertTriangle, Shield, Clock, Package, User2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  job: ServiceJobWithRelations;
  onClick?: () => void;
  variant?: "default" | "kanban";
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

const TAT_INDICATOR: Record<string, { dot: string; label: string }> = {
  green: { dot: "bg-emerald-500 shadow-emerald-500/30", label: "On track" },
  yellow: { dot: "bg-amber-400 shadow-amber-400/30", label: "At risk" },
  red: { dot: "bg-red-500 shadow-red-500/30 animate-pulse", label: "Overdue" },
};

export function ServiceJobCard({ job, onClick, variant = "default" }: Props) {
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

  const isKanban = variant === "kanban";
  const tatInfo = TAT_INDICATOR[tatHealth];

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "cursor-pointer transition-all duration-150",
        isKanban
          ? cn(
              "rounded-r-xl p-3",
              "hover:bg-muted/20 dark:hover:bg-white/[0.03]",
              isMachineDown && "ring-1 ring-inset ring-red-500/25 bg-red-500/[0.03]"
            )
          : cn(
              "rounded-xl border bg-card p-4 shadow-sm",
              "hover:border-primary/20 hover:shadow-md hover:-translate-y-px",
              "dark:border-white/[0.06] dark:hover:border-primary/20",
              isMachineDown
                ? "border-red-400/40 ring-1 ring-red-500/15 dark:border-red-500/30"
                : "border-border/50"
            )
      )}
    >
      {/* Row 1: Customer + Priority */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn(
            "font-semibold truncate text-foreground",
            isKanban ? "text-[13px]" : "text-sm"
          )}>
            {customerName}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate leading-tight">
            {machineSummary}
          </p>
        </div>
        <span className={cn(
          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold shrink-0 leading-tight",
          PRIORITY_COLORS[job.priority]
        )}>
          {PRIORITY_LABELS[job.priority]}
        </span>
      </div>

      {/* Row 2: Problem summary */}
      {job.customer_problem_summary && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
          {job.customer_problem_summary}
        </p>
      )}

      {/* Row 3: Stage + TAT indicator */}
      <div className="mt-2.5 flex items-center gap-2">
        <span className={cn(
          "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold leading-tight",
          STAGE_COLORS[stage]
        )}>
          {STAGE_LABELS[stage]}
        </span>
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0 shadow-[0_0_4px]", tatInfo.dot)}
          title={tatInfo.label}
        />
      </div>

      {/* Row 4: Meta chips */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {partsTotal > 0 && (
          <span className="inline-flex items-center gap-1">
            <Package className="h-3 w-3" />
            <span className="tabular-nums">{partsReady}/{partsTotal}</span>
          </span>
        )}
        {job.technician?.full_name && (
          <span className="inline-flex items-center gap-1 truncate max-w-[7rem]">
            <User2 className="h-3 w-3 shrink-0" />
            {job.technician.full_name.split(" ")[0]}
          </span>
        )}
        {quoteStatus && (
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {quoteStatus}
            {quoteTotal != null && (
              <span className="font-medium text-foreground/70">${Number(quoteTotal).toLocaleString()}</span>
            )}
          </span>
        )}
        {blockerCount > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-red-500 dark:text-red-400">
            <AlertTriangle className="h-3 w-3" />
            {blockerCount} blocker{blockerCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Row 5: Flag icons */}
      {(job.haul_required || isMachineDown || isWarranty || tatHealth === "red") && (
        <div className="mt-2 flex items-center gap-2">
          {job.haul_required && (
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan-600 dark:text-cyan-400">
              <Truck className="h-3 w-3" /> Haul
            </span>
          )}
          {isMachineDown && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" /> Down
            </span>
          )}
          {isWarranty && (
            <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-medium text-purple-600 dark:text-purple-400">
              <Shield className="h-3 w-3" /> Warranty
            </span>
          )}
          {tatHealth === "red" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-600 dark:text-red-400">
              <Clock className="h-3 w-3" /> Overdue
            </span>
          )}
        </div>
      )}
    </div>
  );
}
