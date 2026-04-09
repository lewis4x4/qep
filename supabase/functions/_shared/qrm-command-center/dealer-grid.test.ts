/**
 * Dealer Reality Grid — unit tests.
 *
 * Pure-function tests against fixture data. No DB, no IO.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDealerRealityGrid,
  type QuoteRow,
  type QuotePackageRow,
  type TradeRow,
  type DemoRow,
  type TrafficRow,
  type RentalRow,
  type EscalationRow,
  type ServiceJobRow,
} from "./dealer-grid.ts";

const NOW = new Date("2026-04-09T12:00:00Z").getTime();
const DAY_MS = 86_400_000;

// ─── Fixture factories ─────────────────────────────────────────────────────

function makeQuote(overrides: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status: overrides.status ?? "sent",
    created_at: overrides.created_at ?? new Date(NOW - 2 * DAY_MS).toISOString(),
    updated_at: overrides.updated_at ?? new Date(NOW - 2 * DAY_MS).toISOString(),
  };
}

function makePackage(overrides: Partial<QuotePackageRow> = {}): QuotePackageRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    deal_id: overrides.deal_id ?? null,
    status: overrides.status ?? "sent",
    net_total: overrides.net_total ?? 50_000,
    margin_pct: overrides.margin_pct ?? 15,
  };
}

function makeTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    deal_id: overrides.deal_id ?? null,
    status: overrides.status ?? "manager_review",
    preliminary_value: overrides.preliminary_value ?? 30_000,
    created_at: overrides.created_at ?? new Date(NOW - DAY_MS).toISOString(),
  };
}

function makeDemo(overrides: Partial<DemoRow> = {}): DemoRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    deal_id: overrides.deal_id ?? null,
    status: overrides.status ?? "requested",
    scheduled_date: overrides.scheduled_date ?? null,
    followup_due_at: overrides.followup_due_at ?? null,
    followup_completed: overrides.followup_completed ?? null,
    created_at: overrides.created_at ?? new Date(NOW - DAY_MS).toISOString(),
  };
}

function makeTraffic(overrides: Partial<TrafficRow> = {}): TrafficRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    deal_id: overrides.deal_id ?? null,
    status: overrides.status ?? "in_transit",
    ticket_type: overrides.ticket_type ?? "delivery",
    promised_delivery_at: overrides.promised_delivery_at ?? null,
    blocker_reason: overrides.blocker_reason ?? null,
    created_at: overrides.created_at ?? new Date(NOW - DAY_MS).toISOString(),
  };
}

function makeRental(overrides: Partial<RentalRow> = {}): RentalRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status: overrides.status ?? "inspection_pending",
    charge_amount: overrides.charge_amount ?? null,
    has_charges: overrides.has_charges ?? false,
    created_at: overrides.created_at ?? new Date(NOW - DAY_MS).toISOString(),
    inspection_date: overrides.inspection_date ?? null,
  };
}

function makeEscalation(overrides: Partial<EscalationRow> = {}): EscalationRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status: overrides.status ?? "open",
    severity: overrides.severity ?? "medium",
    created_at: overrides.created_at ?? new Date(NOW - DAY_MS).toISOString(),
  };
}

function makeServiceJob(overrides: Partial<ServiceJobRow> = {}): ServiceJobRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status_flags: overrides.status_flags ?? [],
    closed_at: overrides.closed_at ?? null,
  };
}

// ─── Empty data ────────────────────────────────────────────────────────────

Deno.test("empty data returns 6 tiles with zero counts and live status", () => {
  const result = buildDealerRealityGrid([], [], [], [], [], [], [], [], NOW);
  assertEquals(result.tiles.length, 6);
  for (const tile of result.tiles) {
    assertEquals(tile.activeCount, 0);
    assertEquals(tile.urgentCount, 0);
    assertEquals(tile.status, "live");
  }
  const keys = result.tiles.map((t) => t.key);
  assertEquals(keys, ["quotes", "trades", "demos", "traffic", "rentals", "escalations"]);
});

// ─── Quotes tile ───────────────────────────────────────────────────────────

Deno.test("quotes tile counts active and aging quotes", () => {
  const quotes = [
    makeQuote({ status: "sent", updated_at: new Date(NOW - 20 * DAY_MS).toISOString() }), // aging
    makeQuote({ status: "sent", updated_at: new Date(NOW - 2 * DAY_MS).toISOString() }),   // active
    makeQuote({ status: "draft" }),                                                         // active
    makeQuote({ status: "archived" }),                                                      // inactive
  ];
  const packages = [
    makePackage({ status: "sent", net_total: 100_000 }),
    makePackage({ status: "sent", net_total: 50_000 }),
    makePackage({ status: "draft", net_total: 25_000 }),
    makePackage({ status: "archived", net_total: 10_000 }),
  ];
  const result = buildDealerRealityGrid(quotes, packages, [], [], [], [], [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "quotes")!;
  assertEquals(tile.activeCount, 3);
  assertEquals(tile.urgentCount, 1); // 1 aging
  assertEquals(tile.totalValue, 175_000); // 100k + 50k + 25k (excludes archived)
  assertEquals(tile.status, "live");
});

// ─── Trades tile ───────────────────────────────────────────────────────────

Deno.test("trades tile counts pending manager reviews", () => {
  const trades = [
    makeTrade({ status: "manager_review", preliminary_value: 40_000 }),
    makeTrade({ status: "manager_review", preliminary_value: 60_000 }),
    makeTrade({ status: "approved", preliminary_value: 25_000 }),
    makeTrade({ status: "resolved", preliminary_value: 10_000 }),
  ];
  const result = buildDealerRealityGrid([], [], trades, [], [], [], [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "trades")!;
  assertEquals(tile.activeCount, 3); // manager_review + approved (not resolved)
  assertEquals(tile.urgentCount, 2); // 2 manager_review
  assertEquals(tile.totalValue, 125_000); // 40k + 60k + 25k (not resolved)
});

// ─── Demos tile ────────────────────────────────────────────────────────────

Deno.test("demos tile counts approval needs and imminent demos", () => {
  const demos = [
    makeDemo({ status: "requested" }),
    makeDemo({ status: "requested" }),
    makeDemo({
      status: "scheduled",
      scheduled_date: new Date(NOW + 12 * 60 * 60 * 1000).toISOString(), // 12h from now
    }),
    makeDemo({
      status: "scheduled",
      scheduled_date: new Date(NOW + 5 * DAY_MS).toISOString(), // 5 days from now
    }),
    makeDemo({ status: "completed" }),
  ];
  const result = buildDealerRealityGrid([], [], [], demos, [], [], [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "demos")!;
  assertEquals(tile.activeCount, 4); // requested(2) + scheduled(2), not completed
  assertEquals(tile.urgentCount, 3); // 2 requested + 1 within 48h
});

// ─── Traffic tile ──────────────────────────────────────────────────────────

Deno.test("traffic tile detects overdue and blocked tickets", () => {
  const traffic = [
    makeTraffic({
      status: "in_transit",
      promised_delivery_at: new Date(NOW - 2 * DAY_MS).toISOString(), // overdue
    }),
    makeTraffic({
      status: "pending",
      blocker_reason: "Equipment not prepped",
    }),
    makeTraffic({ status: "in_transit" }), // active but not urgent
    makeTraffic({ status: "delivered" }),   // inactive
  ];
  const result = buildDealerRealityGrid([], [], [], [], traffic, [], [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "traffic")!;
  assertEquals(tile.activeCount, 3); // not delivered
  assertEquals(tile.urgentCount, 2); // 1 overdue + 1 blocked
});

// ─── Rentals tile ──────────────────────────────────────────────────────────

Deno.test("rentals tile counts pending inspections and charge exposure", () => {
  const rentals = [
    makeRental({
      status: "inspection_pending",
      created_at: new Date(NOW - 5 * DAY_MS).toISOString(), // aging >3d
    }),
    makeRental({
      status: "inspection_pending",
      created_at: new Date(NOW - 1 * DAY_MS).toISOString(), // recent
    }),
    makeRental({
      status: "charged",
      has_charges: true,
      charge_amount: 2500,
    }),
    makeRental({ status: "refunded" }), // inactive
  ];
  const result = buildDealerRealityGrid([], [], [], [], [], rentals, [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "rentals")!;
  assertEquals(tile.activeCount, 3); // not refunded
  assertEquals(tile.urgentCount, 1); // 1 aging inspection (>3d)
  assertEquals(tile.totalValue, 2500);
});

// ─── Escalations tile ─────────────────────────────────────────────────────

Deno.test("escalations tile counts open, critical, and machine-down", () => {
  const escalations = [
    makeEscalation({ status: "open", severity: "critical" }),
    makeEscalation({ status: "open", severity: "high" }),
    makeEscalation({ status: "open", severity: "medium" }),
    makeEscalation({ status: "resolved", severity: "critical" }),
  ];
  const serviceJobs = [
    makeServiceJob({ status_flags: ["machine_down"], closed_at: null }),
    makeServiceJob({ status_flags: ["machine_down"], closed_at: null }),
    makeServiceJob({ status_flags: ["shop_job"], closed_at: null }),
    makeServiceJob({ status_flags: ["machine_down"], closed_at: "2026-04-08T00:00:00Z" }), // closed
  ];
  const result = buildDealerRealityGrid([], [], [], [], [], [], escalations, serviceJobs, NOW);
  const tile = result.tiles.find((t) => t.key === "escalations")!;
  assertEquals(tile.activeCount, 3); // 3 open (not resolved)
  assertEquals(tile.urgentCount, 4); // 2 critical/high escalations + 2 machine-down jobs
});

// ─── Degraded tiles ────────────────────────────────────────────────────────

Deno.test("null query data produces degraded tile", () => {
  const result = buildDealerRealityGrid(null, null, null, null, null, null, null, null, NOW);
  assertEquals(result.tiles.length, 6);
  for (const tile of result.tiles) {
    assertEquals(tile.status, "degraded");
    assertEquals(tile.activeCount, 0);
  }
});

Deno.test("mixed null/valid produces mix of live and degraded", () => {
  const result = buildDealerRealityGrid(
    [makeQuote()], // live
    [makePackage()],
    null,          // degraded
    [makeDemo()],  // live
    null,          // degraded
    null,          // degraded
    null,          // degraded
    null,
    NOW,
  );
  const statuses = result.tiles.map((t) => ({ key: t.key, status: t.status }));
  assertEquals(statuses[0], { key: "quotes", status: "live" });
  assertEquals(statuses[1], { key: "trades", status: "degraded" });
  assertEquals(statuses[2], { key: "demos", status: "live" });
  assertEquals(statuses[3], { key: "traffic", status: "degraded" });
  assertEquals(statuses[4], { key: "rentals", status: "degraded" });
  assertEquals(statuses[5], { key: "escalations", status: "degraded" });
});

// ─── Movement detection ────────────────────────────────────────────────────

Deno.test("movement shows increase when more created today vs yesterday", () => {
  const todayIso = new Date(NOW - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
  const yesterdayIso = new Date(NOW - 30 * 60 * 60 * 1000).toISOString(); // 30h ago

  const quotes = [
    makeQuote({ status: "sent", created_at: todayIso }),
    makeQuote({ status: "sent", created_at: todayIso }),
    makeQuote({ status: "sent", created_at: yesterdayIso }),
  ];
  const result = buildDealerRealityGrid(quotes, [], [], [], [], [], [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "quotes")!;
  assertEquals(tile.movement, "\u2191 1 new today"); // 2 today vs 1 yesterday
});

Deno.test("movement is null when same count today and yesterday", () => {
  const todayIso = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  const yesterdayIso = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();

  const quotes = [
    makeQuote({ status: "sent", created_at: todayIso }),
    makeQuote({ status: "sent", created_at: yesterdayIso }),
  ];
  const result = buildDealerRealityGrid(quotes, [], [], [], [], [], [], [], NOW);
  const tile = result.tiles.find((t) => t.key === "quotes")!;
  assertEquals(tile.movement, null);
});

// ─── Payload structure ─────────────────────────────────────────────────────

Deno.test("generatedAt is set to nowTime ISO", () => {
  const result = buildDealerRealityGrid([], [], [], [], [], [], [], [], NOW);
  assertEquals(result.generatedAt, new Date(NOW).toISOString());
});

Deno.test("all tiles have required CTA fields", () => {
  const result = buildDealerRealityGrid([], [], [], [], [], [], [], [], NOW);
  for (const tile of result.tiles) {
    assertEquals(typeof tile.ctaLabel, "string");
    assertEquals(typeof tile.ctaHref, "string");
    assertEquals(tile.ctaHref.startsWith("/"), true);
  }
});
