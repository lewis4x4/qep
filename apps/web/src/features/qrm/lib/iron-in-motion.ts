export interface IronInMotionTicket {
  id: string;
  status: "haul_pending" | "scheduled" | "being_shipped" | "completed";
  ticketType: string;
  fromLocation: string;
  toLocation: string;
  shippingDate: string | null;
  promisedDeliveryAt: string | null;
  blockerReason: string | null;
  createdAt: string;
}

export interface IronInMotionAsset {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned" | "on_order";
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  locationDescription: string | null;
  createdAt: string;
  purchasePrice: number | null;
  currentMarketValue: number | null;
  replacementCost: number | null;
  tickets: IronInMotionTicket[];
}

export interface IronInMotionItem extends IronInMotionAsset {
  primaryTicket: IronInMotionTicket | null;
  daysInMotion: number;
  carryingCostPerDay: number;
  carryingCostToDate: number;
  decayRate30dPct: number;
  decayValuePerDay: number;
  riskLevel: "high" | "medium" | "low";
  riskReasons: string[];
}

export interface IronInMotionSummary {
  totalUnits: number;
  highRiskUnits: number;
  carryingCostPerDay: number;
  decayValuePerDay: number;
}

const ANNUAL_CARRY_RATE = 0.18;

function ticketPriority(ticket: IronInMotionTicket): number {
  switch (ticket.status) {
    case "being_shipped":
      return 0;
    case "scheduled":
      return 1;
    case "haul_pending":
      return 2;
    default:
      return 3;
  }
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function startOfMotion(asset: IronInMotionAsset, ticket: IronInMotionTicket | null): number {
  return parseTime(ticket?.shippingDate) ?? parseTime(ticket?.createdAt) ?? parseTime(asset.createdAt) ?? Date.now();
}

function baseValue(asset: IronInMotionAsset): number {
  return asset.purchasePrice ?? asset.currentMarketValue ?? asset.replacementCost ?? 0;
}

function selectPrimaryTicket(tickets: IronInMotionTicket[]): IronInMotionTicket | null {
  const active = tickets.filter((ticket) => ticket.status !== "completed");
  if (active.length === 0) return null;
  return [...active].sort((a, b) => {
    const byPriority = ticketPriority(a) - ticketPriority(b);
    if (byPriority !== 0) return byPriority;
    const aPromised = parseTime(a.promisedDeliveryAt) ?? parseTime(a.shippingDate) ?? parseTime(a.createdAt) ?? 0;
    const bPromised = parseTime(b.promisedDeliveryAt) ?? parseTime(b.shippingDate) ?? parseTime(b.createdAt) ?? 0;
    return aPromised - bPromised;
  })[0] ?? null;
}

function isInMotion(asset: IronInMotionAsset, primaryTicket: IronInMotionTicket | null): boolean {
  if (asset.ownership === "customer_owned" || asset.availability === "decommissioned") return false;
  return primaryTicket != null || asset.availability === "in_transit";
}

function computeDecayRate30dPct(asset: IronInMotionAsset, ticket: IronInMotionTicket | null): number {
  if (asset.availability === "in_transit" || ticket?.status === "being_shipped") return 1.5;
  if (ticket?.ticketType === "sale" || asset.availability === "reserved") return 1.0;
  return 0.8;
}

function computeRisk(
  asset: IronInMotionAsset,
  primaryTicket: IronInMotionTicket | null,
  daysInMotion: number,
  nowTime: number,
): { riskLevel: "high" | "medium" | "low"; riskReasons: string[] } {
  const reasons: string[] = [];
  let riskLevel: "high" | "medium" | "low" = "low";

  const promisedAt = parseTime(primaryTicket?.promisedDeliveryAt);
  const overdueHours = promisedAt == null ? null : Math.floor((nowTime - promisedAt) / 3_600_000);

  if (primaryTicket == null) {
    return {
      riskLevel: "high",
      riskReasons: ["in transit without an active traffic ticket"],
    };
  }

  if (primaryTicket.blockerReason) {
    reasons.push(primaryTicket.blockerReason);
    riskLevel = "high";
  }

  if (overdueHours != null && overdueHours > 0) {
    reasons.push(`delivery overdue by ${overdueHours}h`);
    riskLevel = "high";
  }

  if (riskLevel !== "high" && primaryTicket.status === "haul_pending" && daysInMotion >= 3) {
    reasons.push("still waiting on haul coordination");
    riskLevel = "medium";
  }

  if (riskLevel !== "high" && primaryTicket.status === "being_shipped" && daysInMotion >= 7) {
    reasons.push("movement window is stretching");
    riskLevel = "medium";
  }

  if (riskLevel === "low" && promisedAt != null) {
    const hoursUntilPromise = Math.floor((promisedAt - nowTime) / 3_600_000);
    if (hoursUntilPromise <= 24) {
      reasons.push("delivery window closes within 24h");
      riskLevel = "medium";
    }
  }

  if (reasons.length === 0) {
    reasons.push(primaryTicket.status === "being_shipped" ? "moving with an active delivery ticket" : "scheduled for movement");
  }

  return { riskLevel, riskReasons: reasons };
}

export function buildIronInMotionRegister(
  assets: IronInMotionAsset[],
  nowTime = Date.now(),
): IronInMotionItem[] {
  return assets
    .map((asset) => {
      const primaryTicket = selectPrimaryTicket(asset.tickets);
      if (!isInMotion(asset, primaryTicket)) return null;

      const motionStart = startOfMotion(asset, primaryTicket);
      const daysInMotion = Math.max(1, Math.floor((nowTime - motionStart) / 86_400_000));
      const value = baseValue(asset);
      const carryingCostPerDay = value * ANNUAL_CARRY_RATE / 365;
      const decayRate30dPct = computeDecayRate30dPct(asset, primaryTicket);
      const decayValuePerDay = value * (decayRate30dPct / 100) / 30;
      const { riskLevel, riskReasons } = computeRisk(asset, primaryTicket, daysInMotion, nowTime);

      return {
        ...asset,
        primaryTicket,
        daysInMotion,
        carryingCostPerDay,
        carryingCostToDate: carryingCostPerDay * daysInMotion,
        decayRate30dPct,
        decayValuePerDay,
        riskLevel,
        riskReasons,
      };
    })
    .filter((item): item is IronInMotionItem => item != null)
    .sort((a, b) => {
      const riskWeight = { high: 3, medium: 2, low: 1 };
      if (riskWeight[b.riskLevel] !== riskWeight[a.riskLevel]) {
        return riskWeight[b.riskLevel] - riskWeight[a.riskLevel];
      }
      if (b.carryingCostToDate !== a.carryingCostToDate) {
        return b.carryingCostToDate - a.carryingCostToDate;
      }
      return b.daysInMotion - a.daysInMotion;
    });
}

export function summarizeIronInMotion(items: IronInMotionItem[]): IronInMotionSummary {
  return items.reduce<IronInMotionSummary>((summary, item) => ({
    totalUnits: summary.totalUnits + 1,
    highRiskUnits: summary.highRiskUnits + (item.riskLevel === "high" ? 1 : 0),
    carryingCostPerDay: summary.carryingCostPerDay + item.carryingCostPerDay,
    decayValuePerDay: summary.decayValuePerDay + item.decayValuePerDay,
  }), {
    totalUnits: 0,
    highRiskUnits: 0,
    carryingCostPerDay: 0,
    decayValuePerDay: 0,
  });
}
