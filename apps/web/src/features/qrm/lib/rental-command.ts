export interface RentalFleetUnit {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned" | "on_order";
  locationDescription: string | null;
  dailyRentalRate: number | null;
  currentMarketValue: number | null;
}

export interface RentalReturnCase {
  id: string;
  equipmentId: string | null;
  status: string;
  chargeAmount: number | null;
  hasCharges: boolean | null;
  agingBucket: string | null;
  workOrderNumber: string | null;
  createdAt: string;
}

export interface RentalTrafficTicket {
  id: string;
  equipmentId: string | null;
  status: "haul_pending" | "scheduled" | "being_shipped" | "completed";
  ticketType: string;
  toLocation: string;
  promisedDeliveryAt: string | null;
  createdAt: string;
}

export interface RentalReturnQueueItem extends RentalReturnCase {
  unit: RentalFleetUnit | null;
}

export interface RentalMotionItem extends RentalTrafficTicket {
  unit: RentalFleetUnit | null;
  riskLevel: "high" | "medium" | "low";
}

export interface RentalCommandSummary {
  totalFleet: number;
  onRentCount: number;
  readyCount: number;
  recoveryCount: number;
  returnsInFlight: number;
  motionCount: number;
  motionRiskCount: number;
  utilizationPct: number;
  dailyRevenueInPlay: number;
  chargeExposure: number;
}

export interface RentalCommandCenter {
  summary: RentalCommandSummary;
  onRentUnits: RentalFleetUnit[];
  readyUnits: RentalFleetUnit[];
  recoveryUnits: RentalFleetUnit[];
  returnQueue: RentalReturnQueueItem[];
  motionQueue: RentalMotionItem[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function agingWeight(bucket: string | null): number {
  switch (bucket) {
    case "15+d":
      return 4;
    case "8-14d":
      return 3;
    case "4-7d":
      return 2;
    case "0-3d":
      return 1;
    default:
      return 0;
  }
}

function motionRisk(ticket: RentalTrafficTicket, nowTime: number): "high" | "medium" | "low" {
  const promisedAt = parseTime(ticket.promisedDeliveryAt);
  if (promisedAt != null && promisedAt < nowTime) return "high";
  if (ticket.status === "haul_pending") return "medium";
  if (promisedAt != null && promisedAt - nowTime <= 86_400_000) return "medium";
  return "low";
}

export function buildRentalCommandCenter(
  units: RentalFleetUnit[],
  returns: RentalReturnCase[],
  tickets: RentalTrafficTicket[],
  nowTime = Date.now(),
): RentalCommandCenter {
  const activeFleet = units.filter((unit) => unit.availability !== "decommissioned");
  const byId = new Map(activeFleet.map((unit) => [unit.id, unit]));

  const onRentUnits = activeFleet
    .filter((unit) => unit.availability === "rented")
    .sort((a, b) => (b.dailyRentalRate ?? 0) - (a.dailyRentalRate ?? 0));

  const readyUnits = activeFleet
    .filter((unit) => unit.availability === "available")
    .sort((a, b) => (b.dailyRentalRate ?? 0) - (a.dailyRentalRate ?? 0));

  const openReturns = returns
    .filter((item) => item.status !== "completed")
    .map((item) => ({ ...item, unit: item.equipmentId ? byId.get(item.equipmentId) ?? null : null }))
    .sort((a, b) => {
      const byAging = agingWeight(b.agingBucket) - agingWeight(a.agingBucket);
      if (byAging !== 0) return byAging;
      return (parseTime(b.createdAt) ?? 0) - (parseTime(a.createdAt) ?? 0);
    });

  const recoveryUnitIds = new Set<string>();
  for (const unit of activeFleet) {
    if (unit.availability === "in_service") recoveryUnitIds.add(unit.id);
  }
  for (const item of openReturns) {
    if (item.unit && ["decision_pending", "damage_assessment", "work_order_open"].includes(item.status)) {
      recoveryUnitIds.add(item.unit.id);
    }
  }
  const recoveryUnits = activeFleet
    .filter((unit) => recoveryUnitIds.has(unit.id))
    .sort((a, b) => (b.currentMarketValue ?? 0) - (a.currentMarketValue ?? 0));

  const motionQueue = tickets
    .filter((ticket) => ticket.status !== "completed")
    .map((ticket) => ({
      ...ticket,
      unit: ticket.equipmentId ? byId.get(ticket.equipmentId) ?? null : null,
      riskLevel: motionRisk(ticket, nowTime),
    }))
    .sort((a, b) => {
      const riskWeight = { high: 3, medium: 2, low: 1 };
      if (riskWeight[b.riskLevel] !== riskWeight[a.riskLevel]) {
        return riskWeight[b.riskLevel] - riskWeight[a.riskLevel];
      }
      const aPromise = parseTime(a.promisedDeliveryAt) ?? parseTime(a.createdAt) ?? 0;
      const bPromise = parseTime(b.promisedDeliveryAt) ?? parseTime(b.createdAt) ?? 0;
      return aPromise - bPromise;
    });

  const summary: RentalCommandSummary = {
    totalFleet: activeFleet.length,
    onRentCount: onRentUnits.length,
    readyCount: readyUnits.length,
    recoveryCount: recoveryUnits.length,
    returnsInFlight: openReturns.length,
    motionCount: motionQueue.length,
    motionRiskCount: motionQueue.filter((item) => item.riskLevel !== "low").length,
    utilizationPct: activeFleet.length === 0 ? 0 : onRentUnits.length / activeFleet.length,
    dailyRevenueInPlay: onRentUnits.reduce((sum, unit) => sum + (unit.dailyRentalRate ?? 0), 0),
    chargeExposure: openReturns.reduce((sum, item) => sum + (item.hasCharges ? (item.chargeAmount ?? 0) : 0), 0),
  };

  return {
    summary,
    onRentUnits,
    readyUnits,
    recoveryUnits,
    returnQueue: openReturns,
    motionQueue,
  };
}
