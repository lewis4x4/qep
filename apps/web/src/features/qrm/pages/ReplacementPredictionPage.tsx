import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Gauge, Sparkles, TimerReset } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildReplacementPredictionBoard } from "../lib/replacement-prediction";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

function windowTone(window: "30d" | "60d" | "90d" | "180d"): string {
  switch (window) {
    case "30d":
      return "text-red-400";
    case "60d":
      return "text-amber-400";
    case "90d":
      return "text-qep-orange";
    default:
      return "text-blue-400";
  }
}

export function ReplacementPredictionPage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "replacement-prediction"],
    queryFn: async () => {
      const [fleetResult, equipmentResult] = await Promise.all([
        supabase
          .from("fleet_intelligence")
          .select("id, customer_name, customer_profile_id, make, model, year, equipment_serial, current_hours, predicted_replacement_date, replacement_confidence, outreach_deal_value")
          .not("predicted_replacement_date", "is", null)
          .limit(1000),
        supabase
          .from("crm_equipment")
          .select("id, company_id, serial_number")
          .is("deleted_at", null)
          .limit(1000),
      ]);

      if (fleetResult.error) throw new Error(fleetResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);

      const equipmentBySerial = new Map(
        (equipmentResult.data ?? [])
          .filter((row) => row.serial_number)
          .map((row) => [String(row.serial_number).trim().toLowerCase(), { equipmentId: row.id, companyId: row.company_id }]),
      );

      return buildReplacementPredictionBoard(
        (fleetResult.data ?? []).map((row) => {
          const serialKey = row.equipment_serial ? String(row.equipment_serial).trim().toLowerCase() : "";
          const equipment = serialKey ? equipmentBySerial.get(serialKey) ?? null : null;
          return {
            fleetIntelligenceId: row.id,
            equipmentId: equipment?.equipmentId ?? null,
            companyId: equipment?.companyId ?? null,
            customerName: row.customer_name,
            make: row.make,
            model: row.model,
            year: row.year,
            equipmentSerial: row.equipment_serial,
            currentHours: row.current_hours,
            predictedReplacementDate: row.predicted_replacement_date,
            replacementConfidence: row.replacement_confidence,
            outreachDealValue: row.outreach_deal_value,
          };
        }),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Replacement Prediction"
        subtitle="Fleet units entering 30, 60, 90, and 180-day replacement windows with confidence and drill paths."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading replacement predictions…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Replacement prediction is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={CalendarDays} label="30 Days" value={String(board.summary.due30d)} />
            <SummaryCard icon={TimerReset} label="60 Days" value={String(board.summary.due60d)} />
            <SummaryCard icon={Gauge} label="90 Days" value={String(board.summary.due90d)} />
            <SummaryCard icon={Sparkles} label="180 Days" value={String(board.summary.due180d)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Prediction queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ranked by nearest replacement date first, then confidence. Each prediction stays tied to the current fleet model and visible drill paths.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {board.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fleet units are currently in the 180-day replacement window.</p>
              ) : (
                board.items.map((item) => (
                  <div key={item.fleetIntelligenceId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{item.title}</p>
                          <span className={`text-[11px] font-medium ${windowTone(item.window)}`}>
                            {item.window}
                          </span>
                          <span className={`text-[11px] font-medium ${confidenceTone(item.confidenceBand)}`}>
                            {item.confidenceBand} confidence
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.customerName}
                          {item.currentHours != null ? ` · ${Math.round(item.currentHours).toLocaleString()}h` : ""}
                          {item.equipmentSerial ? ` · S/N ${item.equipmentSerial}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Replacement date {new Date(item.predictedReplacementDate).toLocaleDateString()} · {item.daysUntil} day{item.daysUntil === 1 ? "" : "s"} out
                          {item.outreachDealValue != null ? ` · upside $${Math.round(item.outreachDealValue).toLocaleString()}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {item.companyId ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link to={buildAccountCommandHref(item.companyId)}>
                              Account <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        ) : null}
                        {item.equipmentId ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/equipment/${item.equipmentId}`}>
                              Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
