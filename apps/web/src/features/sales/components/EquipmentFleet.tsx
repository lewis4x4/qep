import { Truck, Flame } from "lucide-react";
import type { CustomerEquipment } from "../lib/types";

/* ── Trade status classification ────────────────────────── */
function getTradeStatus(hours: number | null): {
  label: string;
  status: "trade_ready" | "trade_soon" | "good";
  iconBg: string;
  iconColor: string;
  dotBg: string;
  dotText: string;
} {
  if (hours != null && hours > 7000) {
    return {
      label: "Trade Ready",
      status: "trade_ready",
      iconBg: "bg-red-500/10",
      iconColor: "text-red-500",
      dotBg: "bg-red-500/15",
      dotText: "text-red-400",
    };
  }
  if (hours != null && hours > 5000) {
    return {
      label: "Trade Soon",
      status: "trade_soon",
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-500",
      dotBg: "bg-amber-500/15",
      dotText: "text-amber-400",
    };
  }
  return {
    label: "Good",
    status: "good",
    iconBg: "bg-foreground/[0.04]",
    iconColor: "text-muted-foreground",
    dotBg: "bg-emerald-500/15",
    dotText: "text-emerald-400",
  };
}

export function EquipmentFleet({
  equipment,
}: {
  equipment: CustomerEquipment[];
}) {
  const tradeReadyCount = equipment.filter(
    (eq) => eq.engine_hours != null && eq.engine_hours > 7000,
  ).length;

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-qep-orange" />
          <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.1em]">
            Equipment Fleet
          </span>
          <span className="text-[11px] text-muted-foreground/50">
            ({equipment.length})
          </span>
        </div>
        {tradeReadyCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-[3px] rounded-[10px] bg-red-500/10">
            <Flame className="w-[10px] h-[10px] text-red-400" />
            <span className="text-[10px] font-extrabold text-red-400 uppercase tracking-[0.04em]">
              {tradeReadyCount} Trade Ready
            </span>
          </div>
        )}
      </div>

      {equipment.length === 0 ? (
        <div className="bg-[hsl(var(--card))] border border-dashed border-white/[0.12] rounded-[14px] px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No equipment on file.</p>
          <p className="text-xs text-muted-foreground/50 mt-1">
            Log what you see on-site during your next visit.
          </p>
        </div>
      ) : (
        <div className="bg-[hsl(var(--card))] rounded-[14px] border border-white/[0.06] overflow-hidden">
          {equipment.map((eq, i) => {
            const trade = getTradeStatus(eq.engine_hours);
            return (
              <div
                key={eq.id}
                className={`flex items-center gap-3 p-3.5 ${
                  i < equipment.length - 1
                    ? "border-b border-white/[0.06]"
                    : ""
                }`}
              >
                {/* Equipment icon */}
                <div
                  className={`w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 ${trade.iconBg}`}
                >
                  <Truck
                    className={`w-[18px] h-[18px] ${trade.iconColor}`}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {eq.make ?? ""} {eq.model ?? eq.name ?? "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {eq.year ? `${eq.year} · ` : ""}
                    {eq.engine_hours != null
                      ? `${eq.engine_hours.toLocaleString()} hrs`
                      : ""}
                    {eq.serial_number ? ` · S/N: ${eq.serial_number}` : ""}
                  </p>
                </div>

                {/* Trade status dot */}
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${trade.dotBg}`}
                >
                  <span
                    className={`w-[6px] h-[6px] rounded-full ${
                      trade.status === "trade_ready"
                        ? "bg-red-400"
                        : trade.status === "trade_soon"
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                    }`}
                  />
                  <span
                    className={`text-[10px] font-bold ${trade.dotText}`}
                  >
                    {trade.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
