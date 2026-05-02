/**
 * Iron Man widget impls — prep queue, PDI checklists, demo schedule, return inspections.
 *
 * All read from useIronManData and share the same React Query cache.
 */
import { Link } from "react-router-dom";
import { Widget } from "../Widget";
import { useIronManData } from "../../hooks/useDashboardData";
import { Wrench, ClipboardCheck, Truck, RotateCcw } from "lucide-react";

const INTAKE_STAGE_LABEL: Record<number, string> = {
  1: "Purchase & Logistics",
  2: "Equipment Arrival",
  3: "PDI Completion",
  4: "Inventory Labeling",
  5: "Sales Readiness",
  6: "Online Listing",
  7: "Internal Docs",
  8: "Sale Ready",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pdiChecklistEntries(value: unknown): Array<{ completed: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    completed: isRecord(entry) && entry.completed === true,
  }));
}

export function PrepQueueWidget() {
  const { data, isLoading, isError } = useIronManData();
  const items = data?.prepQueue ?? [];
  return (
    <Widget
      title="Prep queue"
      description="Equipment in arrival, PDI, or labeling (stages 2–4)."
      icon={<Wrench className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load prep queue." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in prep right now.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              to="/ops/intake"
              className="flex items-center justify-between rounded-lg border border-border p-2.5 transition hover:border-foreground/20"
            >
              <span className="text-sm font-medium text-foreground">
                {item.stock_number || "No stock #"}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">
                Stage {item.current_stage ?? "?"} ·{" "}
                {INTAKE_STAGE_LABEL[item.current_stage ?? 0] ?? "Intake"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}

export function PdiChecklistsWidget() {
  const { data, isLoading, isError } = useIronManData();
  const items = data?.pdiItems ?? [];
  return (
    <Widget
      title="PDI checklists"
      description="Open pre-delivery inspections."
      icon={<ClipboardCheck className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load PDI items." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No PDI items pending.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const checklist = pdiChecklistEntries(item.pdi_checklist);
            const completed = checklist.filter((entry) => entry.completed).length;
            const total = checklist.length || 1;
            const pct = Math.round((completed / total) * 100);

            return (
              <Link
                key={item.id}
                to="/ops/intake"
                className="block rounded-lg border border-border p-3 transition hover:border-foreground/20"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {item.stock_number || "Equipment"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {completed}/{total} items
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-qep-orange transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

export function DemoScheduleWidget() {
  const { data, isLoading, isError } = useIronManData();
  const items = data?.upcomingDemos ?? [];
  return (
    <Widget
      title="Demo schedule"
      description="Approved and scheduled equipment demos."
      icon={<Truck className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load demos." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No demos scheduled.</p>
      ) : (
        <div className="space-y-2">
          {items.map((demo) => {
            const shell = (
              <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <div>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      demo.status === "scheduled"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    {demo.status}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {demo.equipment_category ?? "Equipment"} • {demo.max_hours}hr max
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {demo.scheduled_date || "TBD"}
                </span>
              </div>
            );
            return demo.deal_id ? (
              <Link
                key={demo.id}
                to={`/crm/deals/${demo.deal_id}`}
                className="block transition hover:opacity-90"
              >
                {shell}
              </Link>
            ) : (
              <div key={demo.id}>{shell}</div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

export function ReturnInspectionsWidget() {
  const { data, isLoading, isError } = useIronManData();
  const items = data?.returnInspections ?? [];
  return (
    <Widget
      title="Return inspections"
      description="Rental returns awaiting inspection."
      icon={<RotateCcw className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load returns." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No return inspections pending.</p>
      ) : (
        <div className="space-y-2">
          {items.map((ret) => (
            <Link
              key={ret.id}
              to="/ops/returns"
              className="flex items-center justify-between rounded-lg border border-border p-2.5 transition hover:border-foreground/20"
            >
              <span className="text-sm font-medium">Rental return</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                Inspection pending
              </span>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}
