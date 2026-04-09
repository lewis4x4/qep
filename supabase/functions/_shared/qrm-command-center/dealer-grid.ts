/**
 * QRM Command Center — Dealer Reality Grid builder.
 *
 * Pure function, no DB clients, no IO. Accepts pre-fetched row arrays from
 * 6 operational domains and produces a 6-tile payload showing the live state
 * of the dealership beyond just the deal pipeline.
 *
 * Each tile reports: activeCount, urgentCount, totalValue, summary,
 * movement direction, CTA, and live/degraded/unavailable status.
 */

import type {
  DealerGridTile,
  DealerGridTileKey,
  DealerRealityGridPayload,
  SectionStatus,
} from "./types.ts";

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const AGING_QUOTE_DAYS = 14;
const DEMO_SOON_HOURS = 48;
const RENTAL_AGING_DAYS = 3;

// ─── Row types (minimal projections from the DB queries) ───────────────────

export interface QuoteRow {
  id: string;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotePackageRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  net_total: number | null;
  margin_pct: number | null;
}

export interface TradeRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  preliminary_value: number | null;
  created_at: string;
}

export interface DemoRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  scheduled_date: string | null;
  followup_due_at: string | null;
  followup_completed: boolean | null;
  created_at: string;
}

export interface TrafficRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  ticket_type: string | null;
  promised_delivery_at: string | null;
  blocker_reason: string | null;
  created_at: string;
}

export interface RentalRow {
  id: string;
  status: string | null;
  charge_amount: number | null;
  has_charges: boolean | null;
  created_at: string;
  inspection_date: string | null;
}

export interface EscalationRow {
  id: string;
  status: string | null;
  severity: string | null;
  created_at: string;
}

export interface ServiceJobRow {
  id: string;
  status_flags: string[] | null;
  closed_at: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function countCreatedInWindow(rows: Array<{ created_at: string }>, start: number, end: number): number {
  return rows.filter((r) => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && t >= start && t < end;
  }).length;
}

function movementLabel(today: number, yesterday: number): string | null {
  const delta = today - yesterday;
  if (delta > 0) return `\u2191 ${delta} new today`;
  if (delta < 0) return `\u2193 ${Math.abs(delta)} fewer today`;
  return null;
}

function makeDegradedTile(key: DealerGridTileKey, label: string, ctaLabel: string, ctaHref: string, reason: string): DealerGridTile {
  return {
    key, label, activeCount: 0, urgentCount: 0, totalValue: 0,
    summary: "Data unavailable", movement: null,
    ctaLabel, ctaHref, status: "degraded", reason,
  };
}

// ─── Per-domain tile builders ──────────────────────────────────────────────

function buildQuotesTile(
  quotes: QuoteRow[] | null,
  packages: QuotePackageRow[] | null,
  nowTime: number,
): DealerGridTile {
  if (!quotes) return makeDegradedTile("quotes", "Quotes", "View Quotes", "/quote-v2", "Query failed");

  const active = quotes.filter((q) => q.status === "draft" || q.status === "sent");
  const aging = active.filter((q) => {
    const t = Date.parse(q.updated_at);
    return Number.isFinite(t) && (nowTime - t) > AGING_QUOTE_DAYS * DAY_MS;
  });

  const totalValue = (packages ?? [])
    .filter((p) => p.status === "draft" || p.status === "sent")
    .reduce((sum, p) => sum + (p.net_total ?? 0), 0);

  const todayStart = nowTime - (nowTime % DAY_MS);
  const yesterdayStart = todayStart - DAY_MS;
  const todayCount = countCreatedInWindow(quotes, todayStart, nowTime);
  const yesterdayCount = countCreatedInWindow(quotes, yesterdayStart, todayStart);

  const parts: string[] = [];
  if (active.length > 0) parts.push(`${active.length} active`);
  if (aging.length > 0) parts.push(`${aging.length} aging >14d`);
  if (parts.length === 0) parts.push("No active quotes");

  return {
    key: "quotes",
    label: "Quotes",
    activeCount: active.length,
    urgentCount: aging.length,
    totalValue: Math.round(totalValue * 100) / 100,
    summary: parts.join(", "),
    movement: movementLabel(todayCount, yesterdayCount),
    ctaLabel: "View Quotes",
    ctaHref: "/quote-v2",
    status: "live",
  };
}

function buildTradesTile(trades: TradeRow[] | null, nowTime: number): DealerGridTile {
  if (!trades) return makeDegradedTile("trades", "Trades", "View Trades", "/qrm", "Query failed");

  const active = trades.filter((t) => t.status !== "resolved" && t.status !== "cancelled");
  const pendingReview = trades.filter((t) => t.status === "manager_review");
  const totalValue = active.reduce((sum, t) => sum + (t.preliminary_value ?? 0), 0);

  const todayStart = nowTime - (nowTime % DAY_MS);
  const yesterdayStart = todayStart - DAY_MS;

  const parts: string[] = [];
  if (pendingReview.length > 0) parts.push(`${pendingReview.length} awaiting manager review`);
  if (active.length > pendingReview.length) parts.push(`${active.length - pendingReview.length} in progress`);
  if (parts.length === 0) parts.push("No active trades");

  return {
    key: "trades",
    label: "Trades",
    activeCount: active.length,
    urgentCount: pendingReview.length,
    totalValue: Math.round(totalValue * 100) / 100,
    summary: parts.join(", "),
    movement: movementLabel(
      countCreatedInWindow(trades, todayStart, nowTime),
      countCreatedInWindow(trades, yesterdayStart, todayStart),
    ),
    ctaLabel: "View Trades",
    ctaHref: "/qrm",
    status: "live",
  };
}

function buildDemosTile(demos: DemoRow[] | null, nowTime: number): DealerGridTile {
  if (!demos) return makeDegradedTile("demos", "Demos", "View Demos", "/qrm", "Query failed");

  const active = demos.filter((d) =>
    d.status === "requested" || d.status === "approved" || d.status === "scheduled"
  );
  const needsApproval = demos.filter((d) => d.status === "requested");
  const soonMs = DEMO_SOON_HOURS * 60 * 60 * 1000;
  const scheduledSoon = demos.filter((d) => {
    if (d.status !== "scheduled" && d.status !== "approved") return false;
    if (!d.scheduled_date) return false;
    const t = Date.parse(d.scheduled_date);
    return Number.isFinite(t) && t >= nowTime && (t - nowTime) <= soonMs;
  });

  const urgent = needsApproval.length + scheduledSoon.length;

  const parts: string[] = [];
  if (needsApproval.length > 0) parts.push(`${needsApproval.length} need approval`);
  if (scheduledSoon.length > 0) parts.push(`${scheduledSoon.length} in 48h`);
  if (parts.length === 0 && active.length > 0) parts.push(`${active.length} scheduled`);
  if (parts.length === 0) parts.push("No active demos");

  const todayStart = nowTime - (nowTime % DAY_MS);
  const yesterdayStart = todayStart - DAY_MS;

  return {
    key: "demos",
    label: "Demos",
    activeCount: active.length,
    urgentCount: urgent,
    totalValue: 0,
    summary: parts.join(", "),
    movement: movementLabel(
      countCreatedInWindow(demos, todayStart, nowTime),
      countCreatedInWindow(demos, yesterdayStart, todayStart),
    ),
    ctaLabel: "View Demos",
    ctaHref: "/qrm",
    status: "live",
  };
}

function buildTrafficTile(traffic: TrafficRow[] | null, nowTime: number): DealerGridTile {
  if (!traffic) return makeDegradedTile("traffic", "Traffic", "View Traffic", "/ops/traffic", "Query failed");

  const active = traffic.filter((t) =>
    t.status !== "delivered" && t.status !== "cancelled" && t.status !== "completed"
  );
  const overdue = active.filter((t) => {
    if (!t.promised_delivery_at) return false;
    const d = Date.parse(t.promised_delivery_at);
    return Number.isFinite(d) && d < nowTime;
  });
  const blocked = active.filter((t) => t.blocker_reason != null && t.blocker_reason !== "");
  const inTransit = active.filter((t) => t.status === "in_transit");

  const urgent = overdue.length + blocked.length;

  const parts: string[] = [];
  if (inTransit.length > 0) parts.push(`${inTransit.length} in transit`);
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
  if (blocked.length > 0) parts.push(`${blocked.length} blocked`);
  if (parts.length === 0 && active.length > 0) parts.push(`${active.length} active`);
  if (parts.length === 0) parts.push("No active tickets");

  const todayStart = nowTime - (nowTime % DAY_MS);
  const yesterdayStart = todayStart - DAY_MS;

  return {
    key: "traffic",
    label: "Traffic",
    activeCount: active.length,
    urgentCount: urgent,
    totalValue: 0,
    summary: parts.join(", "),
    movement: movementLabel(
      countCreatedInWindow(traffic, todayStart, nowTime),
      countCreatedInWindow(traffic, yesterdayStart, todayStart),
    ),
    ctaLabel: "View Traffic",
    ctaHref: "/ops/traffic",
    status: "live",
  };
}

function buildRentalsTile(rentals: RentalRow[] | null, nowTime: number): DealerGridTile {
  if (!rentals) return makeDegradedTile("rentals", "Rentals", "View Rentals", "/rentals", "Query failed");

  const pending = rentals.filter((r) => r.status === "inspection_pending");
  const withCharges = rentals.filter((r) => r.has_charges === true && r.status !== "refunded" && r.status !== "closed");
  const agingInspections = pending.filter((r) => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && (nowTime - t) > RENTAL_AGING_DAYS * DAY_MS;
  });

  const totalCharges = withCharges.reduce((sum, r) => sum + (r.charge_amount ?? 0), 0);
  const active = rentals.filter((r) => r.status !== "refunded" && r.status !== "closed" && r.status !== "completed");

  const parts: string[] = [];
  if (pending.length > 0) parts.push(`${pending.length} inspections pending`);
  if (withCharges.length > 0) parts.push(`${withCharges.length} with charges`);
  if (parts.length === 0 && active.length > 0) parts.push(`${active.length} active returns`);
  if (parts.length === 0) parts.push("No active returns");

  const todayStart = nowTime - (nowTime % DAY_MS);
  const yesterdayStart = todayStart - DAY_MS;

  return {
    key: "rentals",
    label: "Rentals",
    activeCount: active.length,
    urgentCount: agingInspections.length,
    totalValue: Math.round(totalCharges * 100) / 100,
    summary: parts.join(", "),
    movement: movementLabel(
      countCreatedInWindow(rentals, todayStart, nowTime),
      countCreatedInWindow(rentals, yesterdayStart, todayStart),
    ),
    ctaLabel: "View Rentals",
    ctaHref: "/rentals",
    status: "live",
  };
}

function buildEscalationsTile(
  escalations: EscalationRow[] | null,
  serviceJobs: ServiceJobRow[] | null,
  nowTime: number,
): DealerGridTile {
  if (!escalations) return makeDegradedTile("escalations", "Escalations", "View Service", "/service/dashboard", "Query failed");

  const open = escalations.filter((e) => e.status !== "resolved");
  const critical = open.filter((e) => e.severity === "high" || e.severity === "critical");
  const machineDown = (serviceJobs ?? []).filter((j) =>
    j.closed_at == null && (j.status_flags ?? []).includes("machine_down")
  );

  const parts: string[] = [];
  if (open.length > 0) parts.push(`${open.length} open`);
  if (critical.length > 0) parts.push(`${critical.length} critical`);
  if (machineDown.length > 0) parts.push(`${machineDown.length} machine down`);
  if (parts.length === 0) parts.push("No open escalations");

  const todayStart = nowTime - (nowTime % DAY_MS);
  const yesterdayStart = todayStart - DAY_MS;

  return {
    key: "escalations",
    label: "Escalations",
    activeCount: open.length,
    urgentCount: critical.length + machineDown.length,
    totalValue: 0,
    summary: parts.join(", "),
    movement: movementLabel(
      countCreatedInWindow(escalations, todayStart, nowTime),
      countCreatedInWindow(escalations, yesterdayStart, todayStart),
    ),
    ctaLabel: "View Service",
    ctaHref: "/service/dashboard",
    status: "live",
  };
}

// ─── Main builder ──────────────────────────────────────────────────────────

export function buildDealerRealityGrid(
  quotes: QuoteRow[] | null,
  quotePackages: QuotePackageRow[] | null,
  trades: TradeRow[] | null,
  demos: DemoRow[] | null,
  traffic: TrafficRow[] | null,
  rentals: RentalRow[] | null,
  escalations: EscalationRow[] | null,
  serviceJobs: ServiceJobRow[] | null,
  nowTime: number,
): DealerRealityGridPayload {
  return {
    tiles: [
      buildQuotesTile(quotes, quotePackages, nowTime),
      buildTradesTile(trades, nowTime),
      buildDemosTile(demos, nowTime),
      buildTrafficTile(traffic, nowTime),
      buildRentalsTile(rentals, nowTime),
      buildEscalationsTile(escalations, serviceJobs, nowTime),
    ],
    generatedAt: new Date(nowTime).toISOString(),
  };
}
