/**
 * QRM Command Center — Relationship & Opportunity Engine builder.
 *
 * Pure function, no DB clients, no IO. Accepts pre-fetched rows from
 * customer_profiles_extended, voice_captures, and fleet_intelligence.
 * Produces 5 signal streams showing relationship momentum across the
 * dealership's account base.
 */

import type {
  RelationshipEnginePayload,
  RelationshipSignal,
  RelationshipSignalKind,
} from "./types.ts";

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const HEATING_WINDOW_DAYS = 14;
const COOLING_INACTIVITY_DAYS = 14;
const COMPETITOR_WINDOW_DAYS = 14;
const SILENT_THRESHOLD_DAYS = 30;
const SILENT_MIN_HEALTH = 60;
const FLEET_WINDOW_DAYS = 90;
const MAX_PER_STREAM = 5;

// ─── Row types (minimal DB projections) ────────────────────────────────────

export interface HealthProfileRow {
  id: string;
  company_name: string | null;
  health_score: number | null;
  health_score_updated_at: string | null;
  last_interaction_at: string | null;
  fleet_size: number | null;
  last_deal_at: string | null;
}

export interface VoiceCaptureRow {
  id: string;
  linked_company_id: string | null;
  sentiment: string | null;
  competitor_mentions: string[] | null;
  created_at: string;
}

export interface FleetIntelRow {
  id: string;
  customer_profile_id: string | null;
  customer_name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  predicted_replacement_date: string | null;
  replacement_confidence: number | null;
  outreach_status: string | null;
  outreach_deal_value: number | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseTime(v: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function daysSince(isoDate: string | null, nowTime: number): number | null {
  const t = parseTime(isoDate);
  if (t === null) return null;
  return Math.max(0, Math.floor((nowTime - t) / DAY_MS));
}

function makeSignal(
  kind: RelationshipSignalKind,
  companyId: string,
  companyName: string,
  detail: string,
  score: number,
  observedAt: string,
): RelationshipSignal {
  return {
    kind,
    companyId,
    companyName,
    detail,
    score: Math.max(0, Math.min(1, score)),
    ctaLabel: kind === "fleet_replacement" ? "View Equipment" : "Open Account",
    ctaHref: `/qrm/companies/${companyId}`,
    observedAt,
  };
}

function topN(signals: RelationshipSignal[], n: number): RelationshipSignal[] {
  return signals.sort((a, b) => b.score - a.score).slice(0, n);
}

// ─── Stream builders ───────────────────────────────────────────────────────

function buildHeatingUp(
  profiles: HealthProfileRow[],
  voiceByCompany: Map<string, VoiceCaptureRow[]>,
  nowTime: number,
): RelationshipSignal[] {
  const signals: RelationshipSignal[] = [];
  const windowStart = nowTime - HEATING_WINDOW_DAYS * DAY_MS;

  for (const profile of profiles) {
    if (!profile.id || !profile.company_name) continue;
    const voices = voiceByCompany.get(profile.id) ?? [];
    const recentPositive = voices.filter(
      (v) => v.sentiment === "positive" && parseTime(v.created_at)! >= windowStart,
    );
    const interactionDays = daysSince(profile.last_interaction_at, nowTime);
    const isRecentlyActive = interactionDays !== null && interactionDays <= 7;

    if (recentPositive.length > 0 && isRecentlyActive) {
      const score = Math.min(1, recentPositive.length * 0.3 + (profile.health_score ?? 0) / 100);
      signals.push(makeSignal(
        "heating_up",
        profile.id,
        profile.company_name,
        `${recentPositive.length} positive capture${recentPositive.length !== 1 ? "s" : ""} this period`,
        score,
        recentPositive[0].created_at,
      ));
    }
  }

  return topN(signals, MAX_PER_STREAM);
}

function buildCoolingOff(
  profiles: HealthProfileRow[],
  voiceByCompany: Map<string, VoiceCaptureRow[]>,
  nowTime: number,
): RelationshipSignal[] {
  const signals: RelationshipSignal[] = [];
  const windowStart = nowTime - HEATING_WINDOW_DAYS * DAY_MS;

  for (const profile of profiles) {
    if (!profile.id || !profile.company_name) continue;
    const voices = voiceByCompany.get(profile.id) ?? [];
    const recentNegative = voices.filter(
      (v) => v.sentiment === "negative" && parseTime(v.created_at)! >= windowStart,
    );
    const inactivityDays = daysSince(profile.last_interaction_at, nowTime);
    const isStalled = inactivityDays !== null && inactivityDays >= COOLING_INACTIVITY_DAYS;

    if (recentNegative.length > 0 || isStalled) {
      const detail = recentNegative.length > 0
        ? `Negative sentiment on ${new Date(recentNegative[0].created_at).toLocaleDateString()}`
        : `No activity in ${inactivityDays}d`;
      const score = recentNegative.length > 0
        ? Math.min(1, 0.5 + recentNegative.length * 0.2)
        : Math.min(1, (inactivityDays ?? 14) / 60);
      signals.push(makeSignal(
        "cooling_off",
        profile.id,
        profile.company_name,
        detail,
        score,
        recentNegative.length > 0 ? recentNegative[0].created_at : profile.last_interaction_at ?? new Date(nowTime).toISOString(),
      ));
    }
  }

  return topN(signals, MAX_PER_STREAM);
}

function buildCompetitorRising(
  profiles: HealthProfileRow[],
  voiceByCompany: Map<string, VoiceCaptureRow[]>,
  nowTime: number,
): RelationshipSignal[] {
  const signals: RelationshipSignal[] = [];
  const recentStart = nowTime - COMPETITOR_WINDOW_DAYS * DAY_MS;
  const priorStart = recentStart - COMPETITOR_WINDOW_DAYS * DAY_MS;

  for (const profile of profiles) {
    if (!profile.id || !profile.company_name) continue;
    const voices = voiceByCompany.get(profile.id) ?? [];

    let recentMentions = 0;
    let priorMentions = 0;
    const competitors = new Set<string>();

    for (const v of voices) {
      const t = parseTime(v.created_at);
      if (!t) continue;
      const mentions = v.competitor_mentions ?? [];
      if (mentions.length === 0) continue;
      if (t >= recentStart) {
        recentMentions += mentions.length;
        for (const c of mentions) competitors.add(c);
      } else if (t >= priorStart) {
        priorMentions += mentions.length;
      }
    }

    if (recentMentions > priorMentions && recentMentions > 0) {
      const names = [...competitors].slice(0, 2).join(", ");
      const detail = `${names} mentioned ${recentMentions}x (was ${priorMentions})`;
      const score = Math.min(1, (recentMentions - priorMentions) * 0.25 + 0.3);
      signals.push(makeSignal(
        "competitor_rising",
        profile.id,
        profile.company_name,
        detail,
        score,
        voices[0]?.created_at ?? new Date(nowTime).toISOString(),
      ));
    }
  }

  return topN(signals, MAX_PER_STREAM);
}

function buildFleetReplacement(
  fleet: FleetIntelRow[],
  nowTime: number,
): RelationshipSignal[] {
  const signals: RelationshipSignal[] = [];
  const windowEnd = nowTime + FLEET_WINDOW_DAYS * DAY_MS;

  for (const f of fleet) {
    if (!f.customer_profile_id || !f.customer_name) continue;
    if (f.outreach_status === "completed") continue;

    const replDate = parseTime(f.predicted_replacement_date);
    if (replDate === null || replDate > windowEnd || replDate < nowTime - 30 * DAY_MS) continue;

    const daysUntil = Math.floor((replDate - nowTime) / DAY_MS);
    const equipment = [f.year, f.make, f.model].filter(Boolean).join(" ");
    const monthLabel = new Date(replDate).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const detail = `${equipment || "Equipment"} replacement ${daysUntil > 0 ? `in ${monthLabel}` : "overdue"}`;
    const score = f.replacement_confidence ?? 0.5;

    signals.push(makeSignal(
      "fleet_replacement",
      f.customer_profile_id,
      f.customer_name,
      detail,
      score,
      f.predicted_replacement_date ?? new Date(nowTime).toISOString(),
    ));
  }

  return topN(signals, MAX_PER_STREAM);
}

function buildSilentKeyAccounts(
  profiles: HealthProfileRow[],
  nowTime: number,
): RelationshipSignal[] {
  const signals: RelationshipSignal[] = [];

  for (const profile of profiles) {
    if (!profile.id || !profile.company_name) continue;
    const healthScore = profile.health_score ?? 0;
    if (healthScore < SILENT_MIN_HEALTH) continue;

    const inactivityDays = daysSince(profile.last_interaction_at, nowTime);
    if (inactivityDays === null || inactivityDays < SILENT_THRESHOLD_DAYS) continue;

    const detail = `Score ${healthScore.toFixed(0)} \u00b7 ${inactivityDays}d silent`;
    const score = Math.min(1, (healthScore / 100) * 0.6 + (inactivityDays / 90) * 0.4);

    signals.push(makeSignal(
      "silent_key_account",
      profile.id,
      profile.company_name,
      detail,
      score,
      profile.last_interaction_at ?? new Date(nowTime).toISOString(),
    ));
  }

  return topN(signals, MAX_PER_STREAM);
}

// ─── Main builder ──────────────────────────────────────────────────────────

export function buildRelationshipEngine(
  profiles: HealthProfileRow[] | null,
  voices: VoiceCaptureRow[] | null,
  fleet: FleetIntelRow[] | null,
  nowTime: number,
): RelationshipEnginePayload {
  const safeProfiles = profiles ?? [];
  const safeVoices = voices ?? [];
  const safeFleet = fleet ?? [];

  // Index voices by company for O(1) lookup
  const voiceByCompany = new Map<string, VoiceCaptureRow[]>();
  for (const v of safeVoices) {
    if (!v.linked_company_id) continue;
    const existing = voiceByCompany.get(v.linked_company_id) ?? [];
    existing.push(v);
    voiceByCompany.set(v.linked_company_id, existing);
  }

  return {
    heatingUp: buildHeatingUp(safeProfiles, voiceByCompany, nowTime),
    coolingOff: buildCoolingOff(safeProfiles, voiceByCompany, nowTime),
    competitorRising: buildCompetitorRising(safeProfiles, voiceByCompany, nowTime),
    fleetReplacement: buildFleetReplacement(safeFleet, nowTime),
    silentKeyAccounts: buildSilentKeyAccounts(safeProfiles, nowTime),
  };
}
