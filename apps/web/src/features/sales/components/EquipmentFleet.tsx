import { Wrench, AlertTriangle } from "lucide-react";
import type { CustomerEquipment } from "../lib/types";

function estimateTradeWindow(hours: number | null, year: number | null): string | null {
  if (!hours) return null;
  if (hours > 7000) return "Trade window: NOW";
  if (hours > 5000) return "1-2 years out";
  if (hours > 3000) return "2-3 years out";
  return null;
}

export function EquipmentFleet({
  equipment,
}: {
  equipment: CustomerEquipment[];
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Wrench className="w-4 h-4" />
        Equipment Fleet
        {equipment.length > 0 && (
          <span className="text-slate-400 normal-case font-normal">
            ({equipment.length})
          </span>
        )}
      </h2>

      {equipment.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-6 text-center">
          <p className="text-sm text-slate-500">No equipment on file.</p>
          <p className="text-xs text-slate-400 mt-1">
            Log what you see on-site during your next visit.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {equipment.map((eq) => {
            const tradeWindow = estimateTradeWindow(eq.engine_hours, eq.year);
            const isTradeNow = tradeWindow === "Trade window: NOW";

            return (
              <div
                key={eq.id}
                className={`bg-white rounded-xl border px-4 py-3 ${
                  isTradeNow
                    ? "border-amber-300 bg-amber-50/50"
                    : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {eq.make ?? ""} {eq.model ?? eq.name ?? "Unknown"}{" "}
                      {eq.year ? `\u00B7 ${eq.year}` : ""}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {eq.engine_hours != null && (
                        <span className="text-xs text-slate-500">
                          {eq.engine_hours.toLocaleString()} hrs
                        </span>
                      )}
                      {eq.serial_number && (
                        <span className="text-xs text-slate-400">
                          S/N: {eq.serial_number}
                        </span>
                      )}
                    </div>
                  </div>

                  {tradeWindow && (
                    <span
                      className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap flex items-center gap-1 ${
                        isTradeNow
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {isTradeNow && (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {tradeWindow}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
