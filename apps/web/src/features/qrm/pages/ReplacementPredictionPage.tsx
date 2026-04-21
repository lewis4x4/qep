import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildReplacementPredictionBoard } from "../lib/replacement-prediction";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, SignalChip } from "../components/command-deck";

type WindowKey = "30d" | "60d" | "90d" | "180d";

function windowTone(window: WindowKey) {
  switch (window) {
    case "30d":
      return "hot" as const;
    case "60d":
      return "warm" as const;
    case "90d":
      return "active" as const;
    default:
      return "live" as const;
  }
}

function confidenceTone(confidence: "high" | "medium" | "low") {
  switch (confidence) {
    case "high":
      return "ok" as const;
    case "medium":
      return "active" as const;
    default:
      return "cool" as const;
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
  const summary = board?.summary ?? { due30d: 0, due60d: 0, due90d: 0, due180d: 0 };
  const total = summary.due30d + summary.due60d + summary.due90d + summary.due180d;

  // Cascading Iron briefing — route to the sharpest replacement lever.
  const replaceIronHeadline = boardQuery.isLoading
    ? "Scanning fleet intelligence for replacement windows…"
    : boardQuery.isError
      ? "Replacement prediction offline. The feeder failed — check the console."
      : summary.due30d > 0
        ? `${summary.due30d} unit${summary.due30d === 1 ? "" : "s"} inside the 30-day replacement window — dispatch an upgrade touch before a competitor does. ${summary.due60d} at 60d · ${summary.due90d} at 90d.`
        : summary.due60d > 0
          ? `${summary.due60d} unit${summary.due60d === 1 ? "" : "s"} at 60 days — line up the conversation now while timing is your lever.`
          : summary.due90d > 0
            ? `${summary.due90d} unit${summary.due90d === 1 ? "" : "s"} entering the 90-day window. Start the discovery — buying cycles compound.`
            : summary.due180d > 0
              ? `${summary.due180d} unit${summary.due180d === 1 ? "" : "s"} on the 180-day horizon. Keep these warm through the quarter.`
              : "No fleet units inside the replacement horizon. Run white-space instead.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Replacement Prediction"
        subtitle="Fleet units entering 30/60/90/180-day replacement windows with confidence and drill paths."
        crumb={{ surface: "TODAY", lens: "REPLACE", count: total }}
        metrics={[
          { label: "30d", value: summary.due30d, tone: summary.due30d > 0 ? "hot" : undefined },
          { label: "60d", value: summary.due60d, tone: summary.due60d > 0 ? "warm" : undefined },
          { label: "90d", value: summary.due90d, tone: summary.due90d > 0 ? "active" : undefined },
          { label: "180d", value: summary.due180d, tone: summary.due180d > 0 ? "live" : undefined },
        ]}
        ironBriefing={{
          headline: replaceIronHeadline,
          actions: [{ label: "Fleet radar →", href: "/qrm/fleet-intelligence" }],
        }}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading replacement predictions…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Replacement prediction is unavailable right now."}
        </DeckSurface>
      ) : (
        <DeckSurface className="p-3 sm:p-4">
          <div>
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Prediction queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Nearest replacement first, then confidence. Each prediction stays tied to the current fleet model with visible drill paths.
            </p>
          </div>
          <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
            {board.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No fleet units are currently in the 180-day replacement window.</p>
            ) : (
              board.items.map((item) => {
                const wtone = windowTone(item.window);
                return (
                  <div key={item.fleetIntelligenceId} className="flex flex-col gap-2 px-3 py-2.5 transition-colors hover:bg-qep-orange/[0.04] lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-2">
                      <StatusDot tone={wtone} pulse={wtone === "hot"} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
                          <SignalChip label={item.window.toUpperCase()} tone={wtone} />
                          <SignalChip label={item.confidenceBand} tone={confidenceTone(item.confidenceBand)} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.customerName}
                          {item.currentHours != null ? ` · ${Math.round(item.currentHours).toLocaleString()}h` : ""}
                          {item.equipmentSerial ? ` · S/N ${item.equipmentSerial}` : ""}
                        </p>
                        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {new Date(item.predictedReplacementDate).toLocaleDateString()} · {item.daysUntil}d out
                          {item.outreachDealValue != null ? ` · upside $${Math.round(item.outreachDealValue).toLocaleString()}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 lg:shrink-0">
                      {item.companyId ? (
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                          <Link to={buildAccountCommandHref(item.companyId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : null}
                      {item.equipmentId ? (
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">
                          <Link to={`/equipment/${item.equipmentId}`}>
                            Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DeckSurface>
      )}
    </div>
  );
}
