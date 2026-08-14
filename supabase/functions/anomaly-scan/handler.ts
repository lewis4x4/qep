/**
 * Anomaly scan handler — workspace-scoped detectors with truncation metadata.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always scans the caller's active workspace only.
 *   Body/query `workspace_id` is ignored so a forged target cannot widen scope.
 * - Service role (cron / internal): scans all workspaces when no workspace is
 *   provided. Optional `workspace_id` in JSON body or `?workspace_id=` query
 *   scopes the pass to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { publishFlowEvent } from "../_shared/flow-bus/publish.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const STALLING_DEALS_LIMIT = 50;
export const OVERDUE_FOLLOW_UPS_LIMIT = 30;
export const PIPELINE_RISK_LIMIT = 30;
export const ORPHAN_CHUNKS_LIMIT = 50;
export const DEAL_SCORE_LIMIT = 200;
export const STALE_EMBEDDING_SOURCE_LIMIT = 80;
export const STALE_EMBEDDING_ALERT_SLICE = 20;

export interface Alert {
  workspace_id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  assigned_to: string | null;
  data: Record<string, unknown>;
}

export type AdminClient = SupabaseClient;

export type ScanScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

export interface DetectorMeta {
  limit: number | null;
  scanned: number;
  truncated: boolean;
}

export interface DetectorResult {
  alerts: Alert[];
  meta: DetectorMeta;
}

export interface ScoreResult {
  dealsScored: number;
  meta: DetectorMeta;
}

type StaleSourceConfig = {
  entityType: "contact" | "company" | "deal" | "equipment" | "activity" | "voice_capture";
  table: "crm_contacts" | "crm_companies" | "crm_deals" | "crm_equipment" | "crm_activities" | "voice_captures";
  select: string;
  limit?: number;
};

type StaleSourceRow = {
  id: string;
  updated_at: string;
  workspace_id?: string;
};

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function buildDetectorMeta(limit: number | null, scanned: number): DetectorMeta {
  return {
    limit,
    scanned,
    truncated: limit !== null && scanned >= limit,
  };
}

export function resolveAnomalyScanScope(params: {
  caller: CallerContext;
  isServiceRole: boolean;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; scope: ScanScope }
  | { ok: false; status: 403; message: string } {
  if (!params.isServiceRole) {
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    return {
      ok: true,
      scope: { mode: "workspace", workspaceId: params.caller.workspaceId },
    };
  }

  if (params.requestedWorkspaceId) {
    return {
      ok: true,
      scope: { mode: "workspace", workspaceId: params.requestedWorkspaceId },
    };
  }

  return { ok: true, scope: { mode: "all" } };
}

function applyWorkspaceEq<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  scope: ScanScope,
  column = "workspace_id",
): T {
  if (scope.mode === "workspace") {
    return query.eq(column, scope.workspaceId);
  }
  return query;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export async function detectStallingDeals(
  db: AdminClient,
  scope: ScanScope,
): Promise<DetectorResult> {
  const alerts: Alert[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  let dealsQuery = db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, updated_at, workspace_id, stage_id")
    .is("deleted_at", null)
    .lt("updated_at", sevenDaysAgo)
    .limit(STALLING_DEALS_LIMIT);
  dealsQuery = applyWorkspaceEq(dealsQuery, scope);

  const { data: deals } = await dealsQuery;
  const scanned = deals?.length ?? 0;

  if (!deals || deals.length === 0) {
    return { alerts, meta: buildDetectorMeta(STALLING_DEALS_LIMIT, scanned) };
  }

  const dealIds = (deals as Record<string, unknown>[]).map((d) => d.id as string);

  let activityQuery = db
    .from("crm_activities")
    .select("deal_id")
    .in("deal_id", dealIds)
    .is("deleted_at", null)
    .gte("occurred_at", sevenDaysAgo);
  activityQuery = applyWorkspaceEq(activityQuery, scope);

  const { data: activeRows } = await activityQuery;
  const activeDeals = new Set((activeRows ?? []).map((r: { deal_id: string }) => r.deal_id));

  for (const deal of deals as Record<string, unknown>[]) {
    if (activeDeals.has(deal.id as string)) continue;

    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(deal.updated_at as string).getTime()) / 86_400_000,
    );
    const severity = daysSinceUpdate > 14 ? "high" : "medium";

    alerts.push({
      workspace_id: deal.workspace_id as string,
      alert_type: "stalling_deal",
      severity,
      title: `Deal "${deal.name}" has stalled`,
      description: `No activity for ${daysSinceUpdate} days. Last updated ${new Date(deal.updated_at as string).toLocaleDateString()}.${deal.amount ? ` Value: $${Number(deal.amount).toLocaleString()}.` : ""}`,
      entity_type: "deal",
      entity_id: deal.id as string,
      assigned_to: deal.assigned_rep_id as string | null,
      data: { days_stalled: daysSinceUpdate, amount: deal.amount },
    });
  }

  return { alerts, meta: buildDetectorMeta(STALLING_DEALS_LIMIT, scanned) };
}

export async function detectOverdueFollowUps(
  db: AdminClient,
  scope: ScanScope,
): Promise<DetectorResult> {
  const alerts: Alert[] = [];

  let dealsQuery = db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, next_follow_up_at, workspace_id")
    .is("deleted_at", null)
    .not("next_follow_up_at", "is", null)
    .lt("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .limit(OVERDUE_FOLLOW_UPS_LIMIT);
  dealsQuery = applyWorkspaceEq(dealsQuery, scope);

  const { data: deals } = await dealsQuery;
  const scanned = deals?.length ?? 0;
  if (!deals) {
    return { alerts, meta: buildDetectorMeta(OVERDUE_FOLLOW_UPS_LIMIT, scanned) };
  }

  for (const deal of deals as Record<string, unknown>[]) {
    const hoursOverdue = Math.floor(
      (Date.now() - new Date(deal.next_follow_up_at as string).getTime()) / 3_600_000,
    );
    const severity = hoursOverdue > 72 ? "high" : hoursOverdue > 24 ? "medium" : "low";

    alerts.push({
      workspace_id: deal.workspace_id as string,
      alert_type: "overdue_follow_up",
      severity,
      title: `Overdue follow-up on "${deal.name}"`,
      description: `Follow-up was due ${Math.floor(hoursOverdue / 24)} days ago (${new Date(deal.next_follow_up_at as string).toLocaleDateString()}).${deal.amount ? ` Deal value: $${Number(deal.amount).toLocaleString()}.` : ""}`,
      entity_type: "deal",
      entity_id: deal.id as string,
      assigned_to: deal.assigned_rep_id as string | null,
      data: { hours_overdue: hoursOverdue, amount: deal.amount },
    });
  }

  return { alerts, meta: buildDetectorMeta(OVERDUE_FOLLOW_UPS_LIMIT, scanned) };
}

export async function detectActivityGaps(
  db: AdminClient,
  scope: ScanScope,
): Promise<DetectorResult> {
  const alerts: Alert[] = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

  let repsQuery = db
    .from("profiles")
    .select("id, full_name, active_workspace_id")
    .in("role", ["rep"]);
  if (scope.mode === "workspace") {
    repsQuery = repsQuery.eq("active_workspace_id", scope.workspaceId);
  }

  const { data: reps } = await repsQuery;
  const scanned = reps?.length ?? 0;

  if (!reps || reps.length === 0) {
    return { alerts, meta: buildDetectorMeta(null, scanned) };
  }

  const repIds = (reps as Record<string, unknown>[]).map((r) => r.id as string);

  let activityQuery = db.from("crm_activities")
    .select("created_by")
    .in("created_by", repIds)
    .is("deleted_at", null)
    .gte("occurred_at", threeDaysAgo);
  activityQuery = applyWorkspaceEq(activityQuery, scope);

  let voiceQuery = db.from("voice_captures")
    .select("user_id")
    .in("user_id", repIds)
    .gte("created_at", threeDaysAgo);
  voiceQuery = applyWorkspaceEq(voiceQuery, scope);

  const [{ data: activityRows }, { data: voiceRows }] = await Promise.all([
    activityQuery,
    voiceQuery,
  ]);

  const activeReps = new Set([
    ...((activityRows ?? []) as { created_by: string }[]).map((r) => r.created_by),
    ...((voiceRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ]);

  for (const rep of reps as Record<string, unknown>[]) {
    if (activeReps.has(rep.id as string)) continue;

    const workspaceId = (rep.active_workspace_id as string | null) ??
      (scope.mode === "workspace" ? scope.workspaceId : null);
    if (!workspaceId) continue;

    alerts.push({
      workspace_id: workspaceId,
      alert_type: "activity_gap",
      severity: "medium",
      title: `No activity from ${rep.full_name ?? "rep"} in 3+ days`,
      description: `${rep.full_name ?? "A rep"} has not logged any QRM activities or voice notes in the last 3 days.`,
      entity_type: null,
      entity_id: null,
      assigned_to: rep.id as string,
      data: { rep_id: rep.id, rep_name: rep.full_name },
    });
  }

  return { alerts, meta: buildDetectorMeta(null, scanned) };
}

export async function detectPipelineRisk(
  db: AdminClient,
  scope: ScanScope,
): Promise<DetectorResult> {
  const alerts: Alert[] = [];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const today = new Date().toISOString().split("T")[0];
  const weekAhead = sevenDaysOut.toISOString().split("T")[0];

  let dealsQuery = db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, expected_close_on, stage_id, workspace_id")
    .is("deleted_at", null)
    .gte("expected_close_on", today)
    .lte("expected_close_on", weekAhead)
    .limit(PIPELINE_RISK_LIMIT);
  dealsQuery = applyWorkspaceEq(dealsQuery, scope);

  const { data: deals } = await dealsQuery;
  const scanned = deals?.length ?? 0;

  if (!deals || deals.length === 0) {
    return { alerts, meta: buildDetectorMeta(PIPELINE_RISK_LIMIT, scanned) };
  }

  const stageIds = [...new Set((deals as Record<string, unknown>[]).map((d) => d.stage_id).filter(Boolean))];
  let stageMap: Record<string, { name: string; display_order: number }> = {};
  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name, display_order").in("id", stageIds);
    if (stages) {
      stageMap = Object.fromEntries(
        (stages as { id: string; name: string; display_order: number }[]).map((s) => [
          s.id,
          { name: s.name, display_order: s.display_order },
        ]),
      );
    }
  }

  for (const deal of deals as Record<string, unknown>[]) {
    const stage = stageMap[deal.stage_id as string];
    if (stage && stage.display_order <= 2) {
      alerts.push({
        workspace_id: deal.workspace_id as string,
        alert_type: "pipeline_risk",
        severity: "high",
        title: `"${deal.name}" closing soon but still in early stage`,
        description: `Deal is expected to close ${deal.expected_close_on} but is still in "${stage.name}" stage.${deal.amount ? ` Value: $${Number(deal.amount).toLocaleString()}.` : ""} Consider updating the close date or accelerating the deal.`,
        entity_type: "deal",
        entity_id: deal.id as string,
        assigned_to: deal.assigned_rep_id as string | null,
        data: {
          amount: deal.amount,
          expected_close: deal.expected_close_on,
          stage_name: stage.name,
          stage_order: stage.display_order,
        },
      });
    }
  }

  return { alerts, meta: buildDetectorMeta(PIPELINE_RISK_LIMIT, scanned) };
}

export async function scoreDealsPredictively(
  db: AdminClient,
  scope: ScanScope,
): Promise<ScoreResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  let dealsQuery = db
    .from("crm_deals")
    .select("id, name, amount, stage_id, expected_close_on, assigned_rep_id, created_at, updated_at, workspace_id")
    .is("deleted_at", null)
    .limit(DEAL_SCORE_LIMIT);
  dealsQuery = applyWorkspaceEq(dealsQuery, scope);

  const { data: deals } = await dealsQuery;
  const scanned = deals?.length ?? 0;

  if (!deals || deals.length === 0) {
    return { dealsScored: 0, meta: buildDetectorMeta(DEAL_SCORE_LIMIT, scanned) };
  }

  const dealIds = (deals as Record<string, unknown>[]).map((d) => d.id as string);

  let activityQuery = db
    .from("crm_activities")
    .select("deal_id")
    .in("deal_id", dealIds)
    .is("deleted_at", null)
    .gte("occurred_at", thirtyDaysAgo);
  activityQuery = applyWorkspaceEq(activityQuery, scope);

  const { data: activityRows } = await activityQuery;

  const activityCounts = new Map<string, number>();
  for (const row of (activityRows ?? []) as { deal_id: string }[]) {
    activityCounts.set(row.deal_id, (activityCounts.get(row.deal_id) ?? 0) + 1);
  }

  const stageScores: Record<string, number> = {
    initial_contact: 0, follow_up: 5, demo_scheduled: 10,
    quote_sent: 15, negotiation: 20, closed_won: 25, closed_lost: -25,
  };

  const updates: Array<{ id: string; deal_score: number; deal_score_factors: Record<string, number> }> = [];
  for (const deal of deals as Record<string, unknown>[]) {
    const factors: Record<string, number> = {};
    let score = 50;
    const activityCount = activityCounts.get(deal.id as string) ?? 0;

    if (activityCount >= 5) { factors.activity_momentum = 15; score += 15; }
    else if (activityCount >= 2) { factors.activity_momentum = 8; score += 8; }
    else if (activityCount === 1) { factors.activity_momentum = 0; }
    else { factors.activity_momentum = -10; score -= 10; }

    const stageBonus = stageScores[deal.stage_id as string] ?? 0;
    factors.stage_position = stageBonus;
    score += stageBonus;

    if (deal.expected_close_on) {
      const daysToClose = Math.ceil(
        (new Date(deal.expected_close_on as string).getTime() - Date.now()) / 86_400_000,
      );
      if (daysToClose < 0) { factors.overdue_close = -10; score -= 10; }
      else if (daysToClose <= 7 && activityCount > 0) { factors.closing_soon = 10; score += 10; }
      else if (daysToClose <= 14) { factors.closing_soon = 5; score += 5; }
    }

    const dealAge = Math.ceil(
      (Date.now() - new Date(deal.created_at as string).getTime()) / 86_400_000,
    );
    if (dealAge > 90 && activityCount < 3) { factors.stale_deal = -10; score -= 10; }

    score = Math.max(0, Math.min(100, score));
    updates.push({ id: deal.id as string, deal_score: score, deal_score_factors: factors });
  }

  const now = new Date().toISOString();
  for (let i = 0; i < updates.length; i += 20) {
    const batch = updates.slice(i, i + 20);
    await Promise.all(
      batch.map((u) =>
        db.from("crm_deals").update({
          deal_score: u.deal_score,
          deal_score_factors: u.deal_score_factors,
          deal_score_updated_at: now,
        }).eq("id", u.id),
      ),
    );
  }

  return { dealsScored: updates.length, meta: buildDetectorMeta(DEAL_SCORE_LIMIT, scanned) };
}

async function detectStaleEmbeddingsForSource(
  db: AdminClient,
  scope: ScanScope,
  config: StaleSourceConfig,
): Promise<DetectorResult> {
  const alerts: Alert[] = [];
  const staleCutoff = new Date(Date.now() - 24 * 86_400_000).toISOString();
  const sourceLimit = config.limit ?? STALE_EMBEDDING_SOURCE_LIMIT;

  let sourceQuery = db
    .from(config.table)
    .select(config.select)
    .order("updated_at", { ascending: false })
    .limit(sourceLimit);
  sourceQuery = applyWorkspaceEq(sourceQuery, scope);

  const { data: sourceRows } = await sourceQuery;
  const scanned = sourceRows?.length ?? 0;

  const sources = ((sourceRows ?? []) as unknown as StaleSourceRow[])
    .filter((row) => typeof row.id === "string" && typeof row.updated_at === "string")
    .filter((row) => row.updated_at <= staleCutoff);

  if (sources.length === 0) {
    return { alerts, meta: buildDetectorMeta(sourceLimit, scanned) };
  }

  let embeddingQuery = db
    .from("crm_embeddings")
    .select("entity_id, updated_at")
    .eq("entity_type", config.entityType)
    .in("entity_id", sources.map((row) => row.id as string));
  // crm_embeddings has no workspace_id — scope is enforced on the parent CRM rows above.

  const { data: embeddingRows } = await embeddingQuery;

  const embeddingMap = new Map(
    ((embeddingRows ?? []) as Array<{ entity_id: string; updated_at: string }>)
      .map((row) => [row.entity_id, row.updated_at]),
  );

  for (const source of sources.slice(0, STALE_EMBEDDING_ALERT_SLICE)) {
    const sourceId = source.id as string;
    const sourceUpdatedAt = source.updated_at as string;
    const embeddingUpdatedAt = embeddingMap.get(sourceId);
    if (embeddingUpdatedAt && embeddingUpdatedAt >= sourceUpdatedAt) continue;

    const workspaceId = source.workspace_id ??
      (scope.mode === "workspace" ? scope.workspaceId : null);
    if (!workspaceId) continue;

    alerts.push({
      workspace_id: workspaceId,
      alert_type: "embedding_stale",
      severity: embeddingUpdatedAt ? "medium" : "high",
      title: `Stale embedding for ${config.entityType} ${sourceId.slice(0, 8)}`,
      description: embeddingUpdatedAt
        ? `${config.entityType} changed at ${sourceUpdatedAt}, but its embedding is still from ${embeddingUpdatedAt}.`
        : `${config.entityType} changed at ${sourceUpdatedAt}, but no CRM embedding row exists yet.`,
      entity_type: config.entityType,
      entity_id: sourceId,
      assigned_to: null,
      data: {
        source_updated_at: sourceUpdatedAt,
        embedding_updated_at: embeddingUpdatedAt ?? null,
      },
    });
  }

  return { alerts, meta: buildDetectorMeta(sourceLimit, scanned) };
}

export async function detectStaleEmbeddings(
  db: AdminClient,
  scope: ScanScope,
): Promise<DetectorResult> {
  const alertGroups = await Promise.all([
    detectStaleEmbeddingsForSource(db, scope, {
      entityType: "contact",
      table: "crm_contacts",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, scope, {
      entityType: "company",
      table: "crm_companies",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, scope, {
      entityType: "deal",
      table: "crm_deals",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, scope, {
      entityType: "equipment",
      table: "crm_equipment",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, scope, {
      entityType: "activity",
      table: "crm_activities",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, scope, {
      entityType: "voice_capture",
      table: "voice_captures",
      select: "id, workspace_id, updated_at",
    }),
  ]);

  const alerts = alertGroups.flatMap((group) => group.alerts);
  const scanned = alertGroups.reduce((sum, group) => sum + group.meta.scanned, 0);
  const truncated = alertGroups.some((group) => group.meta.truncated);

  return {
    alerts,
    meta: {
      limit: STALE_EMBEDDING_SOURCE_LIMIT,
      scanned,
      truncated,
    },
  };
}

export async function detectOrphanChunks(
  db: AdminClient,
  scope: ScanScope,
): Promise<DetectorResult> {
  const alerts: Alert[] = [];

  let documentsQuery = db
    .from("documents")
    .select("id, title, status, workspace_id")
    .neq("status", "published")
    .limit(ORPHAN_CHUNKS_LIMIT);
  documentsQuery = applyWorkspaceEq(documentsQuery, scope);

  const { data: documents } = await documentsQuery;
  const scanned = documents?.length ?? 0;

  const docRows = (documents ?? []) as Array<{ id: string; title: string; status: string; workspace_id: string }>;
  if (docRows.length === 0) {
    return { alerts, meta: buildDetectorMeta(ORPHAN_CHUNKS_LIMIT, scanned) };
  }

  const { data: chunkRows } = await db
    .from("chunks")
    .select("document_id")
    .in("document_id", docRows.map((doc) => doc.id));
  // chunks has no workspace_id — documents query above is the workspace gate.

  const chunkCounts = new Map<string, number>();
  for (const row of (chunkRows ?? []) as Array<{ document_id: string }>) {
    chunkCounts.set(row.document_id, (chunkCounts.get(row.document_id) ?? 0) + 1);
  }

  for (const doc of docRows) {
    const chunkCount = chunkCounts.get(doc.id) ?? 0;
    if (chunkCount === 0) continue;

    alerts.push({
      workspace_id: doc.workspace_id,
      alert_type: "orphan_chunks",
      severity: "medium",
      title: `Orphan chunks for "${doc.title}"`,
      description: `Document is ${doc.status}, but ${chunkCount} indexed chunks still exist and can drift out of sync.`,
      entity_type: "document",
      entity_id: doc.id,
      assigned_to: null,
      data: {
        document_status: doc.status,
        chunk_count: chunkCount,
      },
    });
  }

  return { alerts, meta: buildDetectorMeta(ORPHAN_CHUNKS_LIMIT, scanned) };
}

/** Drop alerts outside the active scan scope before insert (JWT cannot cross shops). */
export function filterAlertsToScope(alerts: Alert[], scope: ScanScope): Alert[] {
  if (scope.mode === "all") return alerts;
  return alerts.filter((alert) => alert.workspace_id === scope.workspaceId);
}

export interface AnomalyScanDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
  publishFlowEvent: typeof publishFlowEvent;
}

const defaultDependencies: AnomalyScanDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
  publishFlowEvent,
};

export async function handleAnomalyScan(
  req: Request,
  overrides: Partial<AnomalyScanDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = dependencies.createAdminClient();
  const isServiceRole = dependencies.isServiceRoleCaller(req);

  let caller: CallerContext = {
    authHeader: null,
    userId: null,
    role: null,
    isServiceRole: true,
    workspaceId: null,
  };

  if (!isServiceRole) {
    caller = await dependencies.resolveCallerContext(req, adminClient);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const body = await readBody(req);
    const urlWorkspaceId = cleanString(new URL(req.url).searchParams.get("workspace_id"));
    const bodyWorkspaceId = cleanString(body.workspace_id);
    const requestedWorkspaceId = isServiceRole
      ? (urlWorkspaceId ?? bodyWorkspaceId)
      : null;

    const scopeSelection = resolveAnomalyScanScope({
      caller,
      isServiceRole,
      requestedWorkspaceId,
    });
    if (!scopeSelection.ok) {
      return new Response(JSON.stringify({ error: scopeSelection.message }), {
        status: scopeSelection.status,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const scope = scopeSelection.scope;

    const [
      stallingResult,
      overdueResult,
      activityGapResult,
      pipelineResult,
      staleEmbeddingResult,
      orphanChunkResult,
      scoreResult,
    ] = await Promise.all([
      detectStallingDeals(adminClient, scope),
      detectOverdueFollowUps(adminClient, scope),
      detectActivityGaps(adminClient, scope),
      detectPipelineRisk(adminClient, scope),
      detectStaleEmbeddings(adminClient, scope),
      detectOrphanChunks(adminClient, scope),
      scoreDealsPredictively(adminClient, scope),
    ]);

    const allAlerts = [
      ...stallingResult.alerts,
      ...overdueResult.alerts,
      ...activityGapResult.alerts,
      ...pipelineResult.alerts,
      ...staleEmbeddingResult.alerts,
      ...orphanChunkResult.alerts,
    ];

    const scopedAlerts = filterAlertsToScope(allAlerts, scope);

    const today = new Date().toISOString().split("T")[0];
    const newAlerts: Alert[] = [];

    for (const alert of scopedAlerts) {
      if (alert.entity_id) {
        let existingQuery = adminClient
          .from("anomaly_alerts")
          .select("id")
          .eq("alert_type", alert.alert_type)
          .eq("entity_id", alert.entity_id)
          .gte("created_at", `${today}T00:00:00Z`);
        existingQuery = applyWorkspaceEq(existingQuery, scope);

        const { data: existing } = await existingQuery.maybeSingle();
        if (existing) continue;
      }
      newAlerts.push(alert);
    }

    if (newAlerts.length > 0) {
      await adminClient.from("anomaly_alerts").insert(newAlerts);
    }

    const VALID_BUS_SEVERITY = new Set(["low", "medium", "high", "critical"]);
    const BUS_PUBLISH_CHUNK_SIZE = 50;

    const publishInputs = newAlerts.map((alert) => {
      const severity = VALID_BUS_SEVERITY.has(alert.severity)
        ? (alert.severity as "low" | "medium" | "high" | "critical")
        : undefined;
      const dealId = alert.entity_type === "deal" && alert.entity_id
        ? alert.entity_id
        : undefined;
      const idempotencyKey = alert.entity_id
        ? `anomaly.detected:${alert.alert_type}:${alert.entity_id}:${today}`
        : alert.assigned_to
          ? `anomaly.detected:${alert.alert_type}:user:${alert.assigned_to}:${today}`
          : `anomaly.detected:${alert.alert_type}:system:${today}`;
      return { alert, severity, dealId, idempotencyKey };
    });

    let busPublished = 0;
    let busFailed = 0;

    for (let chunkStart = 0; chunkStart < publishInputs.length; chunkStart += BUS_PUBLISH_CHUNK_SIZE) {
      const chunk = publishInputs.slice(chunkStart, chunkStart + BUS_PUBLISH_CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((input) =>
          dependencies.publishFlowEvent(adminClient, {
            workspaceId: input.alert.workspace_id,
            eventType: "anomaly.detected",
            sourceModule: "anomaly-scan",
            dealId: input.dealId,
            suggestedOwner: input.alert.assigned_to ?? undefined,
            severity: input.severity,
            commercialRelevance: input.severity === "critical" || input.severity === "high" ? "high" : "medium",
            requiredAction: input.alert.title,
            draftMessage: input.alert.description,
            payload: {
              alert_type: input.alert.alert_type,
              entity_type: input.alert.entity_type,
              entity_id: input.alert.entity_id,
              data: input.alert.data,
            },
            idempotencyKey: input.idempotencyKey,
          })
        ),
      );

      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result.status === "fulfilled") {
          busPublished++;
        } else {
          busFailed++;
          const input = chunk[i];
          console.error(
            "[anomaly-scan] flow bus publish failed:",
            result.reason instanceof Error ? result.reason.message : result.reason,
          );
          captureEdgeException(result.reason, {
            fn: "anomaly-scan",
            req,
            extra: {
              phase: "bus_publish",
              alert_type: input.alert.alert_type,
              entity_id: input.alert.entity_id,
              idempotency_key: input.idempotencyKey,
            },
          });
        }
      }
    }

    const truncation = {
      stalling_deals: stallingResult.meta,
      overdue_follow_ups: overdueResult.meta,
      activity_gaps: activityGapResult.meta,
      pipeline_risks: pipelineResult.meta,
      embedding_stale: staleEmbeddingResult.meta,
      orphan_chunks: orphanChunkResult.meta,
      deal_scoring: scoreResult.meta,
    };

    console.info(
      `[anomaly-scan] scope=${scope.mode}${scope.mode === "workspace" ? `:${scope.workspaceId}` : ""} ` +
      `detected=${scopedAlerts.length} new=${newAlerts.length} scored=${scoreResult.dealsScored} ` +
      `bus_published=${busPublished} bus_failed=${busFailed} ` +
      `(stalling=${stallingResult.alerts.length} overdue=${overdueResult.alerts.length} ` +
      `gaps=${activityGapResult.alerts.length} pipeline=${pipelineResult.alerts.length} ` +
      `embedding_stale=${staleEmbeddingResult.alerts.length} orphan_chunks=${orphanChunkResult.alerts.length})`,
    );

    return new Response(JSON.stringify({
      scope: scope.mode === "workspace"
        ? { mode: "workspace", workspace_id: scope.workspaceId }
        : { mode: "all" },
      total_detected: scopedAlerts.length,
      new_alerts: newAlerts.length,
      deals_scored: scoreResult.dealsScored,
      breakdown: {
        stalling_deals: stallingResult.alerts.length,
        overdue_follow_ups: overdueResult.alerts.length,
        activity_gaps: activityGapResult.alerts.length,
        pipeline_risks: pipelineResult.alerts.length,
        embedding_stale: staleEmbeddingResult.alerts.length,
        orphan_chunks: orphanChunkResult.alerts.length,
      },
      truncation,
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
    captureEdgeException(err, { fn: "anomaly-scan", req });
    console.error("[anomaly-scan] error:", err);
    return new Response(JSON.stringify({ error: "Scan failed" }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
}
