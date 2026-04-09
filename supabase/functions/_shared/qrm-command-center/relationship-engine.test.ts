/**
 * Relationship & Opportunity Engine — unit tests.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRelationshipEngine,
  type HealthProfileRow,
  type VoiceCaptureRow,
  type FleetIntelRow,
} from "./relationship-engine.ts";

const NOW = new Date("2026-04-09T12:00:00Z").getTime();
const DAY_MS = 86_400_000;

function makeProfile(overrides: Partial<HealthProfileRow> = {}): HealthProfileRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    company_name: overrides.company_name ?? "Test Company",
    health_score: overrides.health_score ?? 50,
    health_score_updated_at: overrides.health_score_updated_at ?? new Date(NOW - DAY_MS).toISOString(),
    last_interaction_at: overrides.last_interaction_at ?? new Date(NOW - 3 * DAY_MS).toISOString(),
    fleet_size: overrides.fleet_size ?? 5,
    last_deal_at: overrides.last_deal_at ?? null,
  };
}

function makeVoice(overrides: Partial<VoiceCaptureRow> = {}): VoiceCaptureRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    linked_company_id: overrides.linked_company_id ?? null,
    sentiment: overrides.sentiment ?? "neutral",
    competitor_mentions: overrides.competitor_mentions ?? null,
    created_at: overrides.created_at ?? new Date(NOW - 2 * DAY_MS).toISOString(),
  };
}

function makeFleet(overrides: Partial<FleetIntelRow> = {}): FleetIntelRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    customer_profile_id: overrides.customer_profile_id ?? crypto.randomUUID(),
    customer_name: overrides.customer_name ?? "Fleet Customer",
    make: overrides.make ?? "Yanmar",
    model: overrides.model ?? "ViO55",
    year: overrides.year ?? 2019,
    predicted_replacement_date: overrides.predicted_replacement_date ?? new Date(NOW + 45 * DAY_MS).toISOString(),
    replacement_confidence: overrides.replacement_confidence ?? 0.75,
    outreach_status: overrides.outreach_status ?? "pending",
    outreach_deal_value: overrides.outreach_deal_value ?? 120_000,
  };
}

// ─── Empty data ────────────────────────────────────────────────────────────

Deno.test("empty data returns empty streams", () => {
  const result = buildRelationshipEngine([], [], [], NOW);
  assertEquals(result.heatingUp.length, 0);
  assertEquals(result.coolingOff.length, 0);
  assertEquals(result.competitorRising.length, 0);
  assertEquals(result.fleetReplacement.length, 0);
  assertEquals(result.silentKeyAccounts.length, 0);
});

Deno.test("null data returns empty streams", () => {
  const result = buildRelationshipEngine(null, null, null, NOW);
  assertEquals(result.heatingUp.length, 0);
  assertEquals(result.silentKeyAccounts.length, 0);
});

// ─── Heating up ────────────────────────────────────────────────────────────

Deno.test("heating up: positive sentiment + recent activity", () => {
  const companyId = crypto.randomUUID();
  const profiles = [makeProfile({
    id: companyId,
    company_name: "Acme Construction",
    last_interaction_at: new Date(NOW - 2 * DAY_MS).toISOString(),
    health_score: 70,
  })];
  const voices = [
    makeVoice({ linked_company_id: companyId, sentiment: "positive", created_at: new Date(NOW - DAY_MS).toISOString() }),
    makeVoice({ linked_company_id: companyId, sentiment: "positive", created_at: new Date(NOW - 3 * DAY_MS).toISOString() }),
  ];
  const result = buildRelationshipEngine(profiles, voices, [], NOW);
  assertEquals(result.heatingUp.length, 1);
  assertEquals(result.heatingUp[0].companyName, "Acme Construction");
  assertEquals(result.heatingUp[0].kind, "heating_up");
});

Deno.test("heating up: excluded when inactive >7 days", () => {
  const companyId = crypto.randomUUID();
  const profiles = [makeProfile({
    id: companyId,
    last_interaction_at: new Date(NOW - 10 * DAY_MS).toISOString(), // >7d = not recent
  })];
  const voices = [makeVoice({ linked_company_id: companyId, sentiment: "positive" })];
  const result = buildRelationshipEngine(profiles, voices, [], NOW);
  assertEquals(result.heatingUp.length, 0);
});

// ─── Cooling off ───────────────────────────────────────────────────────────

Deno.test("cooling off: negative sentiment detected", () => {
  const companyId = crypto.randomUUID();
  const profiles = [makeProfile({ id: companyId, company_name: "Valley Paving" })];
  const voices = [makeVoice({ linked_company_id: companyId, sentiment: "negative", created_at: new Date(NOW - 5 * DAY_MS).toISOString() })];
  const result = buildRelationshipEngine(profiles, voices, [], NOW);
  assertEquals(result.coolingOff.length, 1);
  assertEquals(result.coolingOff[0].companyName, "Valley Paving");
});

Deno.test("cooling off: stalled activity >14 days", () => {
  const companyId = crypto.randomUUID();
  const profiles = [makeProfile({
    id: companyId,
    company_name: "Blue Ridge",
    last_interaction_at: new Date(NOW - 20 * DAY_MS).toISOString(),
  })];
  const result = buildRelationshipEngine(profiles, [], [], NOW);
  assertEquals(result.coolingOff.length, 1);
  assertEquals(result.coolingOff[0].detail.includes("20d"), true);
});

// ─── Competitor rising ─────────────────────────────────────────────────────

Deno.test("competitor rising: more mentions in recent window than prior", () => {
  const companyId = crypto.randomUUID();
  const profiles = [makeProfile({ id: companyId, company_name: "Mountain Excavation" })];
  const voices = [
    // Recent window (last 14d)
    makeVoice({ linked_company_id: companyId, competitor_mentions: ["CAT"], created_at: new Date(NOW - 3 * DAY_MS).toISOString() }),
    makeVoice({ linked_company_id: companyId, competitor_mentions: ["CAT", "Deere"], created_at: new Date(NOW - 5 * DAY_MS).toISOString() }),
    // Prior window (14-28d ago) — no mentions
  ];
  const result = buildRelationshipEngine(profiles, voices, [], NOW);
  assertEquals(result.competitorRising.length, 1);
  assertEquals(result.competitorRising[0].detail.includes("CAT"), true);
});

// ─── Fleet replacement ─────────────────────────────────────────────────────

Deno.test("fleet replacement: within 90-day window", () => {
  const fleet = [makeFleet({
    customer_name: "Acme Construction",
    predicted_replacement_date: new Date(NOW + 30 * DAY_MS).toISOString(),
  })];
  const result = buildRelationshipEngine([], [], fleet, NOW);
  assertEquals(result.fleetReplacement.length, 1);
  assertEquals(result.fleetReplacement[0].companyName, "Acme Construction");
});

Deno.test("fleet replacement: excluded when outreach completed", () => {
  const fleet = [makeFleet({ outreach_status: "completed" })];
  const result = buildRelationshipEngine([], [], fleet, NOW);
  assertEquals(result.fleetReplacement.length, 0);
});

// ─── Silent key accounts ──────────────────────────────────────────────────

Deno.test("silent key accounts: high score + long silence", () => {
  const profiles = [makeProfile({
    company_name: "Premier Grading",
    health_score: 78,
    last_interaction_at: new Date(NOW - 35 * DAY_MS).toISOString(),
  })];
  const result = buildRelationshipEngine(profiles, [], [], NOW);
  assertEquals(result.silentKeyAccounts.length, 1);
  assertEquals(result.silentKeyAccounts[0].detail.includes("35d silent"), true);
});

Deno.test("silent key accounts: excluded when health score < 60", () => {
  const profiles = [makeProfile({
    health_score: 40,
    last_interaction_at: new Date(NOW - 40 * DAY_MS).toISOString(),
  })];
  const result = buildRelationshipEngine(profiles, [], [], NOW);
  assertEquals(result.silentKeyAccounts.length, 0);
});

// ─── Stream limits ─────────────────────────────────────────────────────────

Deno.test("streams limited to 5 per kind", () => {
  const profiles: HealthProfileRow[] = [];
  for (let i = 0; i < 10; i++) {
    profiles.push(makeProfile({
      id: `company-${i}`,
      company_name: `Company ${i}`,
      health_score: 70 + i,
      last_interaction_at: new Date(NOW - (35 + i) * DAY_MS).toISOString(),
    }));
  }
  const result = buildRelationshipEngine(profiles, [], [], NOW);
  assertEquals(result.silentKeyAccounts.length, 5); // max 5
});
