/**
 * QRM Command Center — composition endpoint.
 *
 * GET /functions/v1/qrm-command-center?scope=mine|team
 *
 * Returns a single `CommandCenterResponse` for the calling user, scoped to
 * their workspace and Iron role. Composes raw signals from existing tables
 * (no schema changes in Slice 1) and runs them through the rules-based
 * ranker in `_shared/qrm-command-center/ranking.ts`.
 *
 * Slice 1 ships:
 *   - commandStrip
 *   - aiChiefOfStaff (rules-based)
 *   - actionLanes
 *   - pipelinePressure
 *
 * Scopes:
 *   - mine  → caller's own deals (RLS via crm_deals_rep_safe)
 *   - team  → workspace-wide; gated on isIronElevated()
 *   - branch / company → reserved for Slice 2 (returns 403)
 *
 * Auth:
 *   - Requires a valid Authorization header.
 *   - Resolves Iron role from the profiles table (iron_role column).
 *   - The caller client (RLS-enforced) is used for all signal reads so reps
 *     cannot leak cross-rep deals via the rep-safe views.
 */

import { createAdminClient, createCallerClient } from "../_shared/dge-auth.ts";
import { resolveProfileActiveWorkspaceId } from "../_shared/workspace.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  buildPipelinePressure,
  getRoleWeights,
  rankAndAssignLanes,
  rankChiefOfStaff,
  scoreDeals,
} from "../_shared/qrm-command-center/ranking.ts";
import type {
  ContactCompanyLookup,
  DealSignalBundle,
  PipelineStageInput,
  RankableDeal,
} from "../_shared/qrm-command-center/ranking.ts";
import type {
  CommandCenterResponse,
  CommandCenterScope,
  CommandStripPayload,
  IronRole,
  SectionFreshness,
  SectionKey,
} from "../_shared/qrm-command-center/types.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

const FN_NAME = "qrm-command-center";

const VALID_SCOPES: CommandCenterScope[] = ["mine", "team", "branch", "company"];

function isValidScope(value: string): value is CommandCenterScope {
  return VALID_SCOPES.includes(value as CommandCenterScope);
}

const IRON_VALUES: IronRole[] = ["iron_advisor", "iron_manager", "iron_woman", "iron_man"];

function isIronRole(value: string | null | undefined): value is IronRole {
  return !!value && IRON_VALUES.includes(value as IronRole);
}

const LEGACY_ROLE_MAP: Record<string, IronRole> = {
  manager: "iron_manager",
  owner: "iron_manager",
  admin: "iron_woman",
  rep: "iron_advisor",
};

function deriveIronRole(legacyRole: string | null, ironRole: string | null): IronRole {
  if (isIronRole(ironRole)) return ironRole;
  if (legacyRole && LEGACY_ROLE_MAP[legacyRole]) return LEGACY_ROLE_MAP[legacyRole];
  return "iron_advisor";
}

function isElevated(role: IronRole): boolean {
  return role === "iron_manager";
}

interface DealRow {
  id: string;
  name: string;
  amount: number | null;
  stage_id: string;
  primary_contact_id: string | null;
  company_id: string | null;
  assigned_rep_id: string | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  closed_at: string | null;
  created_at: string;
  deposit_status: string | null;
  margin_check_status: string | null;
}

interface StageRow {
  id: string;
  name: string;
  sort_order: number;
  probability: number | null;
  is_closed_won: boolean;
  is_closed_lost: boolean;
}

function toRankableDeal(row: DealRow, stageMap: Map<string, StageRow>): RankableDeal {
  const stage = stageMap.get(row.stage_id);
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    stageId: row.stage_id,
    stageName: stage?.name ?? null,
    stageProbability: stage?.probability ?? null,
    expectedCloseOn: row.expected_close_on,
    nextFollowUpAt: row.next_follow_up_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    depositStatus: row.deposit_status,
    marginCheckStatus: row.margin_check_status,
    primaryContactId: row.primary_contact_id,
    companyId: row.company_id,
    assignedRepId: row.assigned_rep_id,
  };
}

function buildCommandStrip(
  deals: RankableDeal[],
  signals: Map<string, DealSignalBundle>,
  nowTime: number,
): CommandStripPayload {
  const sevenDays = 7 * 86_400_000;
  const thirtyDays = 30 * 86_400_000;
  let closable7d = 0;
  let closable30d = 0;
  let atRisk = 0;
  let blockedDeals = 0;
  let overdueFollowUps = 0;
  let urgentApprovals = 0;

  for (const deal of deals) {
    const close = deal.expectedCloseOn ? Date.parse(deal.expectedCloseOn) : null;
    const stageProb = deal.stageProbability ?? 0;
    const weighted = (deal.amount ?? 0) * stageProb;
    if (close !== null && close >= nowTime && close - nowTime <= sevenDays && stageProb >= 0.5) {
      closable7d += weighted;
    }
    if (close !== null && close >= nowTime && close - nowTime <= thirtyDays && stageProb >= 0.5) {
      closable30d += weighted;
    }
    const sig = signals.get(deal.id);
    const isStalled = deal.lastActivityAt
      ? nowTime - Date.parse(deal.lastActivityAt) > 7 * 86_400_000
      : false;
    const isOverdue = deal.nextFollowUpAt ? Date.parse(deal.nextFollowUpAt) < nowTime : false;
    const isBlocked = (deal.depositStatus === "pending" && (sig?.hasPendingDeposit ?? false)) ||
      deal.marginCheckStatus === "flagged" ||
      sig?.anomalySeverity === "critical";
    if (isStalled || isOverdue) atRisk += weighted;
    if (isBlocked) blockedDeals += 1;
    if (isOverdue) overdueFollowUps += 1;
    if (deal.marginCheckStatus === "flagged") urgentApprovals += 1;
  }

  const narrative = formatNarrative({
    closable7d,
    atRisk,
    blockedDeals,
    overdueFollowUps,
    urgentApprovals,
    openDealCount: deals.length,
  });

  return {
    closableRevenue7d: Math.round(closable7d),
    closableRevenue30d: Math.round(closable30d),
    atRiskRevenue: Math.round(atRisk),
    blockedDeals,
    overdueFollowUps,
    urgentApprovals,
    narrative,
  };
}

function formatCurrencyShort(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function formatNarrative(input: {
  closable7d: number;
  atRisk: number;
  blockedDeals: number;
  overdueFollowUps: number;
  urgentApprovals: number;
  openDealCount: number;
}): string {
  if (input.openDealCount === 0) {
    return "No open deals in this scope right now. Quiet board.";
  }
  const fragments: string[] = [];
  if (input.closable7d > 0) {
    fragments.push(`${formatCurrencyShort(input.closable7d)} realistically closable in 7 days`);
  }
  if (input.atRisk > 0) {
    fragments.push(`${formatCurrencyShort(input.atRisk)} at risk`);
  }
  if (input.blockedDeals > 0) {
    fragments.push(`${input.blockedDeals} blocked deal${input.blockedDeals === 1 ? "" : "s"}`);
  }
  if (input.overdueFollowUps > 0) {
    fragments.push(`${input.overdueFollowUps} overdue follow-up${input.overdueFollowUps === 1 ? "" : "s"}`);
  }
  if (input.urgentApprovals > 0) {
    fragments.push(`${input.urgentApprovals} margin approval${input.urgentApprovals === 1 ? "" : "s"} pending`);
  }
  if (fragments.length === 0) {
    return `${input.openDealCount} open deal${input.openDealCount === 1 ? "" : "s"} — board looks healthy.`;
  }
  return `Today: ${fragments.join(", ")}.`;
}

// ─── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const overallStart = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const adminClient = createAdminClient();
    const callerClient = createCallerClient(authHeader);

    // Verify the JWT explicitly per the iron auth pattern (memory:
    // "Always pass JWT explicitly to auth.getUser(token) in edge functions").
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authError } = await callerClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return safeJsonError("Unauthorized", 401, origin);
    }
    const userId = authData.user.id;

    // Resolve role and Iron role from profiles using the admin client
    // (the caller client cannot read the profiles row by id without RLS).
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role, iron_role")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) {
      return safeJsonError("Profile not found", 401, origin);
    }
    const ironRole = deriveIronRole(
      (profile as { role: string | null }).role,
      (profile as { iron_role: string | null }).iron_role,
    );

    // Scope resolution order:
    //   1. POST JSON body `{ scope }` — standard supabase.functions.invoke pattern.
    //   2. URL query string `?scope=` — legacy/debug access via direct fetch.
    //   3. Default `mine`.
    // We accept both because the Supabase JS client's `functions.invoke`
    // canonically sends a POST with a JSON body. Query-string passthrough
    // on the function name parameter is undocumented and fragile.
    let scopeFromBody: string | null = null;
    if (req.method === "POST") {
      try {
        const bodyText = await req.text();
        if (bodyText.length > 0) {
          const parsed = JSON.parse(bodyText) as { scope?: unknown };
          if (typeof parsed.scope === "string") {
            scopeFromBody = parsed.scope;
          }
        }
      } catch {
        // Malformed body → fall through to URL query string.
      }
    }
    const url = new URL(req.url);
    const rawScope = scopeFromBody ?? url.searchParams.get("scope") ?? "mine";
    if (!isValidScope(rawScope)) {
      return safeJsonError(`Invalid scope: ${rawScope}`, 400, origin);
    }
    const scope = rawScope;

    if ((scope === "branch" || scope === "company")) {
      return safeJsonError(
        `Scope '${scope}' is reserved for an upcoming slice`,
        403,
        origin,
      );
    }
    if (scope === "team" && !isElevated(ironRole)) {
      return safeJsonError(
        "Team scope requires Iron Manager privileges",
        403,
        origin,
      );
    }

    const workspaceId = await resolveProfileActiveWorkspaceId(adminClient, userId);

    // ── Fetch deals (caller client → RLS-enforced) ──
    const dealsStart = Date.now();
    let dealsQuery = callerClient
      .from("crm_deals")
      .select(
        "id, name, amount, stage_id, primary_contact_id, company_id, assigned_rep_id, expected_close_on, next_follow_up_at, last_activity_at, closed_at, created_at, deposit_status, margin_check_status",
      )
      .is("deleted_at", null)
      .is("closed_at", null);

    if (scope === "mine") {
      dealsQuery = dealsQuery.eq("assigned_rep_id", userId);
    }

    const { data: rawDeals, error: dealsError } = await dealsQuery
      .order("expected_close_on", { ascending: true, nullsFirst: false })
      .limit(200);

    if (dealsError) {
      throw dealsError;
    }
    const dealRows = (rawDeals ?? []) as DealRow[];
    const dealsLatency = Date.now() - dealsStart;

    // ── Fetch stages (workspace-wide via admin client; safe — no PII) ──
    const stagesStart = Date.now();
    const { data: rawStages, error: stagesError } = await adminClient
      .from("crm_deal_stages")
      .select("id, name, sort_order, probability, is_closed_won, is_closed_lost")
      .eq("workspace_id", workspaceId)
      .order("sort_order", { ascending: true });
    if (stagesError) {
      throw stagesError;
    }
    const stages = (rawStages ?? []) as StageRow[];
    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const stagesLatency = Date.now() - stagesStart;

    const deals = dealRows.map((row) => toRankableDeal(row, stageMap));
    const dealIds = deals.map((d) => d.id);
    const contactIds = Array.from(new Set(deals.map((d) => d.primaryContactId).filter(Boolean))) as string[];
    const companyIds = Array.from(new Set(deals.map((d) => d.companyId).filter(Boolean))) as string[];

    // ── Fetch signal sources in parallel ──
    const signalsStart = Date.now();
    const [anomaliesRes, voiceRes, depositsRes, contactsRes, companiesRes] = await Promise.all([
      dealIds.length > 0
        ? callerClient
          .from("anomaly_alerts")
          .select("entity_id, alert_type, severity, created_at")
          .eq("entity_type", "deal")
          .in("entity_id", dealIds)
          .eq("acknowledged", false)
          .order("created_at", { ascending: false })
          .limit(500)
        : Promise.resolve({ data: [], error: null }),
      dealIds.length > 0
        ? callerClient
          .from("voice_captures")
          // NOTE: the real column is `linked_deal_id` (migration 056), not `deal_id`.
          // Querying `deal_id` returns 400 and is silently absorbed by the
          // `?? []` fallback below. `competitor_mentions` is a top-level
          // `text[]` column on voice_captures, not nested inside extracted_data.
          .select("linked_deal_id, sentiment, manager_attention, created_at, competitor_mentions")
          .in("linked_deal_id", dealIds)
          .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(500)
        : Promise.resolve({ data: [], error: null }),
      dealIds.length > 0
        ? callerClient
          .from("deposits")
          .select("deal_id, status")
          .in("deal_id", dealIds)
          .in("status", ["pending", "requested", "received"])
        : Promise.resolve({ data: [], error: null }),
      contactIds.length > 0
        ? callerClient
          .from("crm_contacts")
          .select("id, first_name, last_name")
          .in("id", contactIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length > 0
        ? callerClient
          .from("crm_companies")
          .select("id, name")
          .in("id", companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const signalsLatency = Date.now() - signalsStart;

    // Explicit error logging for each signal query. We still degrade gracefully
    // (empty array fallback), but failures are now visible in sentry and logs
    // instead of being silently absorbed by `?? []`. The Day 2 verification found
    // that silent absorption masked a P0 bug (voice_captures.deal_id column rename)
    // for the entire lifetime of Slice 1's first deployment.
    const logSignalError = (label: string, res: { error?: { message?: string } | null }): void => {
      if (!res.error) return;
      const message = res.error.message ?? "unknown signal query error";
      console.error(`[${FN_NAME}] signal query '${label}' failed:`, message);
      captureEdgeException(new Error(`${label}: ${message}`), {
        fn: FN_NAME,
        req,
        extra: { signalLabel: label, scope, userId, ironRole },
      });
    };
    logSignalError("anomaly_alerts", anomaliesRes);
    logSignalError("voice_captures", voiceRes);
    logSignalError("deposits", depositsRes);
    logSignalError("crm_contacts", contactsRes);
    logSignalError("crm_companies", companiesRes);

    const signalsByDealId = new Map<string, DealSignalBundle>();
    for (const id of dealIds) {
      signalsByDealId.set(id, {
        anomalyTypes: [],
        anomalySeverity: null,
        recentVoiceSentiment: null,
        competitorMentioned: false,
        hasPendingDeposit: false,
        healthScore: null,
      });
    }

    type AnomalyRow = {
      entity_id: string;
      alert_type: string;
      severity: "low" | "medium" | "high" | "critical";
    };
    const anomalyRows = (anomaliesRes.data ?? []) as AnomalyRow[];
    const severityRank: Record<AnomalyRow["severity"], number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    for (const row of anomalyRows) {
      const bundle = signalsByDealId.get(row.entity_id);
      if (!bundle) continue;
      bundle.anomalyTypes.push(row.alert_type);
      if (
        bundle.anomalySeverity === null ||
        severityRank[row.severity] > severityRank[bundle.anomalySeverity]
      ) {
        bundle.anomalySeverity = row.severity;
      }
    }

    type VoiceRow = {
      linked_deal_id: string;
      sentiment: string | null;
      created_at: string;
      competitor_mentions: string[] | null;
    };
    const voiceRows = (voiceRes.data ?? []) as VoiceRow[];
    for (const row of voiceRows) {
      const bundle = signalsByDealId.get(row.linked_deal_id);
      if (!bundle) continue;
      // Most recent (rows are ordered desc) wins for sentiment.
      if (bundle.recentVoiceSentiment === null && row.sentiment) {
        if (row.sentiment === "positive" || row.sentiment === "neutral" || row.sentiment === "negative") {
          bundle.recentVoiceSentiment = row.sentiment;
        }
      }
      if (Array.isArray(row.competitor_mentions) && row.competitor_mentions.length > 0) {
        bundle.competitorMentioned = true;
      }
    }

    type DepositRow = { deal_id: string };
    const depositRows = (depositsRes.data ?? []) as DepositRow[];
    for (const row of depositRows) {
      const bundle = signalsByDealId.get(row.deal_id);
      if (bundle) bundle.hasPendingDeposit = true;
    }

    const lookups: ContactCompanyLookup = {
      companies: new Map(
        ((companiesRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
      ),
      contacts: new Map(
        ((contactsRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map(
          (c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Unnamed contact"],
        ),
      ),
    };

    // ── Run the ranker ──
    const nowTime = Date.now();
    const observedAt = new Date(nowTime).toISOString();
    const weights = getRoleWeights(ironRole);
    const scored = scoreDeals(deals, signalsByDealId, weights, nowTime);
    const lanes = rankAndAssignLanes(scored, lookups, nowTime, observedAt);
    const chief = rankChiefOfStaff(scored, lanes);

    const stageInputs: PipelineStageInput[] = stages.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sort_order,
      isClosedWon: s.is_closed_won,
      isClosedLost: s.is_closed_lost,
    }));
    const pressure = buildPipelinePressure(stageInputs, deals, nowTime);
    const commandStrip = buildCommandStrip(deals, signalsByDealId, nowTime);

    const generatedAt = observedAt;
    const freshness: Record<SectionKey, SectionFreshness> = {
      commandStrip: { generatedAt, source: "live", latencyMs: dealsLatency },
      aiChiefOfStaff: {
        generatedAt,
        source: voiceRows.length === 0 ? "degraded" : "live",
        latencyMs: signalsLatency,
        reason: voiceRows.length === 0 ? "No recent voice captures in scope" : undefined,
      },
      actionLanes: { generatedAt, source: "live", latencyMs: signalsLatency },
      pipelinePressure: { generatedAt, source: "live", latencyMs: stagesLatency },
    };

    const response: CommandCenterResponse = {
      scope,
      roleVariant: ironRole,
      freshness,
      commandStrip,
      aiChiefOfStaff: chief,
      actionLanes: lanes,
      pipelinePressure: pressure,
    };

    console.log(`[${FN_NAME}] ${ironRole} ${scope} ${deals.length} deals in ${Date.now() - overallStart}ms`);
    return safeJsonOk(response, origin);
  } catch (err) {
    captureEdgeException(err, { fn: FN_NAME, req });
    console.error(`[${FN_NAME}] error`, err);
    return safeJsonError(
      err instanceof Error ? err.message : "Internal error",
      500,
      origin,
    );
  }
});
