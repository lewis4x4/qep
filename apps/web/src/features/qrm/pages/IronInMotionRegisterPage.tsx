import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, DollarSign, ShieldAlert, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  buildIronInMotionRegister,
  summarizeIronInMotion,
  type IronInMotionAsset,
  type IronInMotionTicket,
} from "../lib/iron-in-motion";

interface EquipmentRow {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  availability: IronInMotionAsset["availability"];
  ownership: IronInMotionAsset["ownership"];
  location_description: string | null;
  created_at: string;
  purchase_price: number | null;
  current_market_value: number | null;
  replacement_cost: number | null;
}

interface TrafficRow {
  id: string;
  equipment_id: string | null;
  status: IronInMotionTicket["status"];
  ticket_type: string;
  from_location: string;
  to_location: string;
  shipping_date: string | null;
  promised_delivery_at: string | null;
  blocker_reason: string | null;
  created_at: string;
}

export function IronInMotionRegisterPage() {
  const registerQuery = useQuery({
    queryKey: ["qrm", "iron-in-motion"],
    queryFn: async () => {
      const [equipmentResult, trafficResult] = await Promise.all([
        supabase
          .from("crm_equipment")
          .select("id, name, make, model, year, availability, ownership, location_description, created_at, purchase_price, current_market_value, replacement_cost")
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("traffic_tickets")
          .select("id, equipment_id, status, ticket_type, from_location, to_location, shipping_date, promised_delivery_at, blocker_reason, created_at")
          .neq("status", "completed")
          .limit(500),
      ]);

      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (trafficResult.error) throw new Error(trafficResult.error.message);

      const ticketsByEquipment = new Map<string, IronInMotionTicket[]>();
      for (const row of (trafficResult.data ?? []) as TrafficRow[]) {
        if (!row.equipment_id) continue;
        const list = ticketsByEquipment.get(row.equipment_id) ?? [];
        list.push({
          id: row.id,
          status: row.status,
          ticketType: row.ticket_type,
          fromLocation: row.from_location,
          toLocation: row.to_location,
          shippingDate: row.shipping_date,
          promisedDeliveryAt: row.promised_delivery_at,
          blockerReason: row.blocker_reason,
          createdAt: row.created_at,
        });
        ticketsByEquipment.set(row.equipment_id, list);
      }

      const assets: IronInMotionAsset[] = ((equipmentResult.data ?? []) as EquipmentRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        make: row.make,
        model: row.model,
        year: row.year,
        availability: row.availability,
        ownership: row.ownership,
        locationDescription: row.location_description,
        createdAt: row.created_at,
        purchasePrice: row.purchase_price,
        currentMarketValue: row.current_market_value,
        replacementCost: row.replacement_cost,
        tickets: ticketsByEquipment.get(row.id) ?? [],
      }));

      return buildIronInMotionRegister(assets);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const summary = useMemo(() => summarizeIronInMotion(registerQuery.data ?? []), [registerQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Iron in Motion Register"
        subtitle="Every machine in motion or awaiting delivery, with carrying cost, decay exposure, and risk surfaced from live traffic and machine status."
      />
      <QrmSubNav />

      {registerQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading iron in motion…</Card>
      ) : registerQuery.isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {registerQuery.error instanceof Error ? registerQuery.error.message : "Iron in motion is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Truck} label="Units in motion" value={String(summary.totalUnits)} detail="Machines not yet back in yard or delivered." />
            <SummaryCard icon={ShieldAlert} label="High risk" value={String(summary.highRiskUnits)} detail="Blocked, overdue, or missing traffic control." tone="warn" />
            <SummaryCard icon={DollarSign} label="Carry per day" value={formatCurrency(summary.carryingCostPerDay)} detail="Estimated daily holding cost across active motion." />
            <SummaryCard icon={DollarSign} label="Decay per day" value={formatCurrency(summary.decayValuePerDay)} detail="Estimated daily value erosion across active motion." />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Register</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Built from active traffic tickets plus in-transit machine status. Carrying cost assumes an 18% annual hold rate; decay is a motion heuristic, not a posted ledger.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/ops/traffic">
                  Open traffic queue <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Motion</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Carry / day</TableHead>
                    <TableHead className="text-right">Decay / day</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(registerQuery.data ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{item.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[item.year, item.make, item.model].filter(Boolean).join(" ")}
                            {item.locationDescription ? ` · ${item.locationDescription}` : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.primaryTicket ? `${item.primaryTicket.fromLocation} → ${item.primaryTicket.toLocation}` : "No active route on file"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.primaryTicket
                          ? `${humanizeMotionLabel(item.primaryTicket.ticketType)} · ${humanizeMotionLabel(item.primaryTicket.status)}`
                          : "in transit"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{item.daysInMotion}d</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatCurrency(item.carryingCostPerDay)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(item.decayValuePerDay)}
                        <span className="ml-1 text-[11px] text-muted-foreground/70">({item.decayRate30dPct}% / 30d)</span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <RiskPill riskLevel={item.riskLevel} />
                          <p className="text-xs text-muted-foreground">{item.riskReasons.join(" · ")}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/equipment/${item.id}`}>
                              Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(registerQuery.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                        No machines are in motion right now.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function humanizeMotionLabel(value: string): string {
  return value.replace(/_/g, " ");
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
