import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, DollarSign, RefreshCcw, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  buildRentalCommandCenter,
  type RentalFleetUnit,
  type RentalReturnCase,
  type RentalTrafficTicket,
} from "../lib/rental-command";

interface EquipmentRow {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  availability: RentalFleetUnit["availability"];
  location_description: string | null;
  daily_rental_rate: number | null;
  current_market_value: number | null;
}

interface ReturnRow {
  id: string;
  equipment_id: string | null;
  status: string;
  charge_amount: number | null;
  has_charges: boolean | null;
  aging_bucket: string | null;
  work_order_number: string | null;
  created_at: string;
}

interface TrafficRow {
  id: string;
  equipment_id: string | null;
  status: RentalTrafficTicket["status"];
  ticket_type: string;
  to_location: string;
  promised_delivery_at: string | null;
  created_at: string;
}

export function RentalCommandCenterPage() {
  const commandQuery = useQuery({
    queryKey: ["qrm", "rental-command"],
    queryFn: async () => {
      const [equipmentResult, returnsResult, trafficResult] = await Promise.all([
        supabase
          .from("crm_equipment")
          .select("id, name, make, model, year, availability, location_description, daily_rental_rate, current_market_value")
          .eq("ownership", "rental_fleet")
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("rental_returns")
          .select("id, equipment_id, status, charge_amount, has_charges, aging_bucket, work_order_number, created_at")
          .neq("status", "completed")
          .limit(500),
        supabase
          .from("traffic_tickets")
          .select("id, equipment_id, status, ticket_type, to_location, promised_delivery_at, created_at")
          .in("ticket_type", ["rental", "re_rent", "customer_transfer", "location_transfer"])
          .neq("status", "completed")
          .limit(500),
      ]);

      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (returnsResult.error) throw new Error(returnsResult.error.message);
      if (trafficResult.error) throw new Error(trafficResult.error.message);

      return buildRentalCommandCenter(
        ((equipmentResult.data ?? []) as EquipmentRow[]).map((row) => ({
          id: row.id,
          name: row.name,
          make: row.make,
          model: row.model,
          year: row.year,
          availability: row.availability,
          locationDescription: row.location_description,
          dailyRentalRate: row.daily_rental_rate,
          currentMarketValue: row.current_market_value,
        })),
        ((returnsResult.data ?? []) as ReturnRow[]).map((row) => ({
          id: row.id,
          equipmentId: row.equipment_id,
          status: row.status,
          chargeAmount: row.charge_amount,
          hasCharges: row.has_charges,
          agingBucket: row.aging_bucket,
          workOrderNumber: row.work_order_number,
          createdAt: row.created_at,
        })),
        ((trafficResult.data ?? []) as TrafficRow[]).map((row) => ({
          id: row.id,
          equipmentId: row.equipment_id,
          status: row.status,
          ticketType: row.ticket_type,
          toLocation: row.to_location,
          promisedDeliveryAt: row.promised_delivery_at,
          createdAt: row.created_at,
        })),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const center = commandQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Rental Command Center"
        subtitle="Dedicated rental operations across utilization, returns, work recovery, and movement risk."
      />
      <QrmSubNav />

      {commandQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading rental command…</Card>
      ) : commandQuery.isError || !center ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {commandQuery.error instanceof Error ? commandQuery.error.message : "Rental command is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={Truck} label="Fleet" value={String(center.summary.totalFleet)} detail="Active rental fleet units." />
            <SummaryCard icon={DollarSign} label="On rent" value={String(center.summary.onRentCount)} detail={`Daily revenue in play ${formatCurrency(center.summary.dailyRevenueInPlay)}`} />
            <SummaryCard icon={RefreshCcw} label="Ready" value={String(center.summary.readyCount)} detail={`${Math.round(center.summary.utilizationPct * 100)}% utilization`} />
            <SummaryCard icon={Wrench} label="Recovery" value={String(center.summary.recoveryCount)} detail={`${center.summary.returnsInFlight} return cases in flight`} tone="warn" />
            <SummaryCard icon={Truck} label="Motion risk" value={String(center.summary.motionRiskCount)} detail={`${center.summary.motionCount} rental moves open`} tone={center.summary.motionRiskCount > 0 ? "warn" : "default"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <UnitListCard
              title="On rent now"
              description="Units currently generating rental revenue."
              items={center.onRentUnits}
              emptyText="No units are out on rent right now."
            />
            <UnitListCard
              title="Ready to turn"
              description="Rental units available in yard and ready for the next move."
              items={center.readyUnits}
              emptyText="No rental units are sitting ready right now."
            />
            <UnitListCard
              title="Recovery"
              description="Units in service or tied to damaged-return recovery."
              items={center.recoveryUnits}
              emptyText="No rental units are in recovery."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Return queue</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Open returns, aging, and charge exposure pulled from the live return workflow.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/ops/returns">
                    Open returns <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {center.returnQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rental returns in flight.</p>
                ) : (
                  center.returnQueue.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{item.unit?.name ?? "Unlinked rental return"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.status.replace(/_/g, " ")}
                            {item.agingBucket ? ` · aging ${item.agingBucket}` : ""}
                            {item.workOrderNumber ? ` · ${item.workOrderNumber}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.hasCharges ? `Charge exposure ${formatCurrency(item.chargeAmount)}` : "No charge exposure flagged"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Rental movement</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rental and re-rent moves that still need operational control.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/ops/traffic">
                    Open traffic <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {center.motionQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rental moves are open right now.</p>
                ) : (
                  center.motionQueue.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{item.unit?.name ?? "Unlinked rental move"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.ticketType.replace(/_/g, " ")} · {item.status.replace(/_/g, " ")} · {item.toLocation}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.promisedDeliveryAt
                              ? `Promised ${new Date(item.promisedDeliveryAt).toLocaleDateString()}`
                              : "No promised delivery window set"}
                          </p>
                        </div>
                        <RiskPill riskLevel={item.riskLevel} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function UnitListCard({
  title,
  description,
  items,
  emptyText,
}: {
  title: string;
  description: string;
  items: RentalFleetUnit[];
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[item.year, item.make, item.model].filter(Boolean).join(" ")}
                    {item.locationDescription ? ` · ${item.locationDescription}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.dailyRentalRate != null ? `${formatCurrency(item.dailyRentalRate)} / day` : "Rate not set"}
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/equipment/${item.id}`}>
                    Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RiskPill({ riskLevel }: { riskLevel: "high" | "medium" | "low" }) {
  const tone = riskLevel === "high"
    ? "bg-red-500/10 text-red-300"
    : riskLevel === "medium"
      ? "bg-amber-500/10 text-amber-200"
      : "bg-emerald-500/10 text-emerald-200";

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {riskLevel} risk
    </span>
  );
}
