import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, SignalChip, StatusDot, type StatusTone } from "../components/command-deck";
import {
  buildIronInMotionRegister,
  summarizeIronInMotion,
  type IronInMotionAsset,
  type IronInMotionTicket,
} from "../lib/iron-in-motion";

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function riskTone(level: "high" | "medium" | "low"): StatusTone {
  if (level === "high") return "hot";
  if (level === "medium") return "warm";
  return "ok";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAvailability(value: unknown): IronInMotionAsset["availability"] | null {
  switch (value) {
    case "available":
    case "rented":
    case "sold":
    case "in_service":
    case "in_transit":
    case "reserved":
    case "decommissioned":
      return value;
    default:
      return null;
  }
}

function normalizeOwnership(value: unknown): IronInMotionAsset["ownership"] | null {
  switch (value) {
    case "owned":
    case "leased":
    case "customer_owned":
    case "rental_fleet":
    case "consignment":
      return value;
    default:
      return null;
  }
}

function normalizeTicketStatus(value: unknown): IronInMotionTicket["status"] | null {
  switch (value) {
    case "haul_pending":
    case "scheduled":
    case "being_shipped":
    case "completed":
      return value;
    default:
      return null;
  }
}

function normalizeTicketsByEquipment(rows: unknown): Map<string, IronInMotionTicket[]> {
  const ticketsByEquipment = new Map<string, IronInMotionTicket[]>();
  if (!Array.isArray(rows)) return ticketsByEquipment;

  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.equipment_id !== "string") continue;

    const status = normalizeTicketStatus(row.status);
    if (!status) continue;

    const list = ticketsByEquipment.get(row.equipment_id) ?? [];
    list.push({
      id: row.id,
      status,
      ticketType: requiredString(row.ticket_type, "unknown"),
      fromLocation: requiredString(row.from_location, "Unknown origin"),
      toLocation: requiredString(row.to_location, "Unknown destination"),
      shippingDate: nullableString(row.shipping_date),
      promisedDeliveryAt: nullableString(row.promised_delivery_at),
      blockerReason: nullableString(row.blocker_reason),
      createdAt: requiredString(row.created_at, new Date(0).toISOString()),
    });
    ticketsByEquipment.set(row.equipment_id, list);
  }

  return ticketsByEquipment;
}

function normalizeAssets(rows: unknown, ticketsByEquipment: Map<string, IronInMotionTicket[]>): IronInMotionAsset[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    const availability = normalizeAvailability(row.availability);
    const ownership = normalizeOwnership(row.ownership);
    if (!availability || !ownership) return [];

    return [{
      id: row.id,
      name: requiredString(row.name, "Unnamed machine"),
      make: nullableString(row.make),
      model: nullableString(row.model),
      year: nullableNumber(row.year),
      availability,
      ownership,
      locationDescription: nullableString(row.location_description),
      createdAt: requiredString(row.created_at, new Date(0).toISOString()),
      purchasePrice: nullableNumber(row.purchase_price),
      currentMarketValue: nullableNumber(row.current_market_value),
      replacementCost: nullableNumber(row.replacement_cost),
      tickets: ticketsByEquipment.get(row.id) ?? [],
    }];
  });
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

      const ticketsByEquipment = normalizeTicketsByEquipment(trafficResult.data);
      const assets = normalizeAssets(equipmentResult.data, ticketsByEquipment);

      return buildIronInMotionRegister(assets);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const summary = useMemo(() => summarizeIronInMotion(registerQuery.data ?? []), [registerQuery.data]);

  // Cascading Iron briefing — route to the sharpest motion lever.
  const motionIronHeadline = registerQuery.isLoading
    ? "Scanning active equipment and traffic tickets for motion exposure…"
    : registerQuery.isError
      ? "Iron in Motion offline — one of the feeders failed. Check the console."
      : summary.highRiskUnits > 0
        ? `${summary.highRiskUnits} machine${summary.highRiskUnits === 1 ? "" : "s"} high risk — blocked, overdue, or ghost motion. Carry ${fmtMoney(summary.carryingCostPerDay)}/d · decay ${fmtMoney(summary.decayValuePerDay)}/d.`
        : summary.totalUnits > 0
          ? `${summary.totalUnits} unit${summary.totalUnits === 1 ? "" : "s"} in motion. Carry ${fmtMoney(summary.carryingCostPerDay)}/d · decay ${fmtMoney(summary.decayValuePerDay)}/d — motion is controlled.`
          : "No machines in motion. Yard is settled.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Iron in Motion Register"
        subtitle="Every machine in motion or awaiting delivery, with carrying cost, decay exposure, and risk surfaced from live traffic and machine status."
        crumb={{ surface: "PULSE", lens: "MOTION", count: summary.totalUnits }}
        metrics={[
          { label: "In motion", value: summary.totalUnits, tone: summary.totalUnits > 0 ? "live" : undefined },
          { label: "High risk", value: summary.highRiskUnits, tone: summary.highRiskUnits > 0 ? "hot" : undefined },
          { label: "Carry/d", value: fmtMoney(summary.carryingCostPerDay), tone: summary.carryingCostPerDay > 0 ? "warm" : undefined },
          { label: "Decay/d", value: fmtMoney(summary.decayValuePerDay), tone: summary.decayValuePerDay > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: motionIronHeadline,
          actions: [{ label: "Traffic queue →", href: "/ops/traffic" }],
        }}
      />
      <QrmSubNav />

      {registerQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading iron in motion…</DeckSurface>
      ) : registerQuery.isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {registerQuery.error instanceof Error ? registerQuery.error.message : "Iron in motion is unavailable right now."}
        </DeckSurface>
      ) : (
        <DeckSurface className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Register</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Built from active traffic tickets plus in-transit machine status. Carrying cost assumes an 18% annual hold rate; decay is a motion heuristic, not a posted ledger.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em]">
              <Link to="/ops/traffic">
                Traffic <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
          <div className="mt-3 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Motion</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Carry/d</TableHead>
                  <TableHead className="text-right">Decay/d</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(registerQuery.data ?? []).map((item) => {
                  const tone = riskTone(item.riskLevel);
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <StatusDot tone={tone} pulse={tone === "hot"} />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-foreground">{item.name}</p>
                            <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                              {[item.year, item.make, item.model].filter(Boolean).join(" ")}
                              {item.locationDescription ? ` · ${item.locationDescription}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {item.primaryTicket ? `${item.primaryTicket.fromLocation} → ${item.primaryTicket.toLocation}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {item.primaryTicket
                          ? `${humanizeMotionLabel(item.primaryTicket.ticketType)} · ${humanizeMotionLabel(item.primaryTicket.status)}`
                          : "in transit"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{item.daysInMotion}d</TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{formatCurrency(item.carryingCostPerDay)}</TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {formatCurrency(item.decayValuePerDay)}
                        <span className="ml-1 text-[10px] text-muted-foreground/70">({item.decayRate30dPct}%/30d)</span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <SignalChip label={`${item.riskLevel} risk`} tone={tone} />
                          <p className="text-[10.5px] text-muted-foreground">{item.riskReasons.join(" · ")}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                          <Link to={`/equipment/${item.id}`}>
                            Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
        </DeckSurface>
      )}
    </div>
  );
}

function humanizeMotionLabel(value: string): string {
  return value.replace(/_/g, " ");
}
