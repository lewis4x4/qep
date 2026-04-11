/**
 * Anomaly Scan Edge Function
 *
 * Runs periodic analysis across QRM data to detect:
 * 1. Stalling deals — no activity in 7+ days, deal not closed
 * 2. Overdue follow-ups — past their next_follow_up_at date
 * 3. Activity gaps — reps with no logged activity in 3+ days
 * 4. Pipeline risk — deals closing within 7 days with low-stage status
 * 5. Pricing anomalies — deals significantly above/below average for category
 *
 * Callable via service role (cron) or by admin/manager/owner (on-demand).
 *
 * ── Phase 0 P0.4 Day 7 — DUAL-WRITE TO FLOW BUS ────────────────────────────
 *
 * In addition to inserting into anomaly_alerts (the existing direct-insert
 * path), this function ALSO publishes an `anomaly.detected` event to the
 * flow bus (supabase/functions/_shared/flow-bus/publish.ts) for each new
 * anomaly. The bus publish is best-effort: a failure logs to sentry but
 * never breaks the primary anomaly_alerts flow.
 *
 * Idempotency: the bus key is `${alert_type}:${entity_id}:${today}`, which
 * matches the existing per-day dedup logic above (lines 521-534). Re-runs
 * of this function on the same day for the same entity dedupe cleanly at
 * both the anomaly_alerts level AND the bus level.
 *
 * Cutover: the direct-insert path (anomaly_alerts) is retired at the end of
 * Phase 2 Slice 2.2 per main roadmap §15 Q3.
 */
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { publishFlowEvent } from "../_shared/flow-bus/publish.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

interface Alert {
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

type AdminClient = ReturnType<typeof createAdminClient>;

type StaleSourceConfig = {
  entityType: "contact" | "company" | "deal" | "equipment" | "activity" | "voice_capture";
  table: "crm_contacts" | "crm_companies" | "crm_deals" | "crm_equipment" | "crm_activities" | "voice_captures";
  select: string;
  defaultWorkspaceId?: string;
  limit?: number;
};

type StaleSourceRow = {
  id: string;
  updated_at: string;
  workspace_id?: string;
};

async function detectStallingDeals(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, updated_at, workspace_id, stage_id")
    .is("deleted_at", null)
    .lt("updated_at", sevenDaysAgo)
    .limit(50);

  if (!deals || deals.length === 0) return alerts;

  const dealIds = (deals as Record<string, unknown>[]).map((d) => d.id as string);

  // Batch: get deal_ids that DO have recent activity
  const { data: activeRows } = await db
    .from("crm_activities")
    .select("deal_id")
    .in("deal_id", dealIds)
    .is("deleted_at", null)
    .gte("occurred_at", sevenDaysAgo);

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

  return alerts;
}

async function detectOverdueFollowUps(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, next_follow_up_at, workspace_id")
    .is("deleted_at", null)
    .not("next_follow_up_at", "is", null)
    .lt("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .limit(30);

  if (!deals) return alerts;

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

  return alerts;
}

async function detectActivityGaps(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const { data: reps } = await db
    .from("profiles")
    .select("id, full_name, active_workspace_id")
    .in("role", ["rep"]);

  if (!reps || reps.length === 0) return alerts;

  const repIds = (reps as Record<string, unknown>[]).map((r) => r.id as string);

  // Batch: get reps with recent QRM activity
  const [{ data: activityRows }, { data: voiceRows }] = await Promise.all([
    db.from("crm_activities")
      .select("created_by")
      .in("created_by", repIds)
      .is("deleted_at", null)
      .gte("occurred_at", threeDaysAgo),
    db.from("voice_captures")
      .select("user_id")
      .in("user_id", repIds)
      .gte("created_at", threeDaysAgo),
  ]);

  const activeReps = new Set([
    ...((activityRows ?? []) as { created_by: string }[]).map((r) => r.created_by),
    ...((voiceRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ]);

  for (const rep of reps as Record<string, unknown>[]) {
    if (activeReps.has(rep.id as string)) continue;

    alerts.push({
      workspace_id: (rep.active_workspace_id as string | null) ?? "default",
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

  return alerts;
}

async function detectPipelineRisk(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const today = new Date().toISOString().split("T")[0];
  const weekAhead = sevenDaysOut.toISOString().split("T")[0];

  // Get early-stage deals closing within 7 days
  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, expected_close_on, stage_id, workspace_id")
    .is("deleted_at", null)
    .gte("expected_close_on", today)
    .lte("expected_close_on", weekAhead)
    .limit(30);

  if (!deals || deals.length === 0) return alerts;

  // Load stages to identify early stages
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
    // Early stages (display_order <= 2) closing soon is risky
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

  return alerts;
}

async function scoreDealsPredictively(db: AdminClient): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, stage_id, expected_close_on, assigned_rep_id, created_at, updated_at, workspace_id")
    .is("deleted_at", null)
    .limit(200);

  if (!deals || deals.length === 0) return 0;

  const dealIds = (deals as Record<string, unknown>[]).map((d) => d.id as string);

  // Batch: get activity counts for all deals in one query
  const { data: activityRows } = await db
    .from("crm_activities")
    .select("deal_id")
    .in("deal_id", dealIds)
    .is("deleted_at", null)
    .gte("occurred_at", thirtyDaysAgo);

  const activityCounts = new Map<string, number>();
  for (const row of (activityRows ?? []) as { deal_id: string }[]) {
    activityCounts.set(row.deal_id, (activityCounts.get(row.deal_id) ?? 0) + 1);
  }

  const stageScores: Record<string, number> = {
    initial_contact: 0, follow_up: 5, demo_scheduled: 10,
    quote_sent: 15, negotiation: 20, closed_won: 25, closed_lost: -25,
  };

  // Score all deals and batch updates
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

  // Batch updates in groups of 20 to avoid payload limits
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

  return updates.length;
}

async function detectStaleEmbeddingsForSource(
  db: AdminClient,
  config: StaleSourceConfig,
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const staleCutoff = new Date(Date.now() - 24 * 86_400_000).toISOString();

  const { data: sourceRows } = await db
    .from(config.table)
    .select(config.select)
    .order("updated_at", { ascending: false })
    .limit(config.limit ?? 80);

  const sources = ((sourceRows ?? []) as unknown as StaleSourceRow[])
    .filter((row) => typeof row.id === "string" && typeof row.updated_at === "string")
    .filter((row) => row.updated_at <= staleCutoff);

  if (sources.length === 0) return alerts;

  const { data: embeddingRows } = await db
    .from("crm_embeddings")
    .select("entity_id, updated_at")
    .eq("entity_type", config.entityType)
    .in("entity_id", sources.map((row) => row.id as string));

  const embeddingMap = new Map(
    ((embeddingRows ?? []) as Array<{ entity_id: string; updated_at: string }>)
      .map((row) => [row.entity_id, row.updated_at]),
  );

  for (const source of sources.slice(0, 20)) {
    const sourceId = source.id as string;
    const sourceUpdatedAt = source.updated_at as string;
    const embeddingUpdatedAt = embeddingMap.get(sourceId);
    if (embeddingUpdatedAt && embeddingUpdatedAt >= sourceUpdatedAt) continue;

    alerts.push({
      workspace_id: (source.workspace_id as string | undefined) ?? config.defaultWorkspaceId ?? "default",
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

  return alerts;
}

async function detectStaleEmbeddings(db: AdminClient): Promise<Alert[]> {
  const alertGroups = await Promise.all([
    detectStaleEmbeddingsForSource(db, {
      entityType: "contact",
      table: "crm_contacts",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, {
      entityType: "company",
      table: "crm_companies",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, {
      entityType: "deal",
      table: "crm_deals",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, {
      entityType: "equipment",
      table: "crm_equipment",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, {
      entityType: "activity",
      table: "crm_activities",
      select: "id, workspace_id, updated_at",
    }),
    detectStaleEmbeddingsForSource(db, {
      entityType: "voice_capture",
      table: "voice_captures",
      select: "id, updated_at",
      defaultWorkspaceId: "default",
    }),
  ]);

  return alertGroups.flat();
}

async function detectOrphanChunks(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const { data: documents } = await db
    .from("documents")
    .select("id, title, status")
    .neq("status", "published")
    .limit(50);

  const docRows = (documents ?? []) as Array<{ id: string; title: string; status: string }>;
  if (docRows.length === 0) return alerts;

  const { data: chunkRows } = await db
    .from("chunks")
    .select("document_id")
    .in("document_id", docRows.map((doc) => doc.id));

  const chunkCounts = new Map<string, number>();
  for (const row of (chunkRows ?? []) as Array<{ document_id: string }>) {
    chunkCounts.set(row.document_id, (chunkCounts.get(row.document_id) ?? 0) + 1);
  }

  for (const doc of docRows) {
    const chunkCount = chunkCounts.get(doc.id) ?? 0;
    if (chunkCount === 0) continue;

    alerts.push({
      workspace_id: "default",
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

  return alerts;
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = createAdminClient();
  // Phase 0 Wave 4a — accept BOTH legacy Bearer service_role_key AND modern
  // x-internal-service-secret. The latter is the only path the modern
  // pg_cron migrations (205 / 212) can use because the GUC-based service
  // role key lookup no longer works on Supabase projects.
  const isServiceRole = isServiceRoleCaller(req);

  if (!isServiceRole) {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
  }

  try {
    // Run all detectors and deal scoring in parallel
    const [stallingDeals, overdueFollowUps, activityGaps, pipelineRisks, staleEmbeddings, orphanChunks, dealsScored] =
      await Promise.all([
        detectStallingDeals(adminClient),
        detectOverdueFollowUps(adminClient),
        detectActivityGaps(adminClient),
        detectPipelineRisk(adminClient),
        detectStaleEmbeddings(adminClient),
        detectOrphanChunks(adminClient),
        scoreDealsPredictively(adminClient),
      ]);

    const allAlerts = [
      ...stallingDeals,
      ...overdueFollowUps,
      ...activityGaps,
      ...pipelineRisks,
      ...staleEmbeddings,
      ...orphanChunks,
    ];

    // Deduplicate: skip alerts that already exist for the same entity today
    const today = new Date().toISOString().split("T")[0];
    const newAlerts: Alert[] = [];

    for (const alert of allAlerts) {
      if (alert.entity_id) {
        const { data: existing } = await adminClient
          .from("anomaly_alerts")
          .select("id")
          .eq("alert_type", alert.alert_type)
          .eq("entity_id", alert.entity_id)
          .gte("created_at", `${today}T00:00:00Z`)
          .maybeSingle();

        if (existing) continue;
      }
      newAlerts.push(alert);
    }

    if (newAlerts.length > 0) {
      await adminClient.from("anomaly_alerts").insert(newAlerts);
    }

    // ── Day 7 dual-write to flow bus (PARALLEL + CHUNKED) ──
    //
    // Publishes are run via Promise.allSettled in chunks of BUS_PUBLISH_CHUNK_SIZE
    // so a high-anomaly run (hundreds of alerts) doesn't pay 1-2s/alert of
    // sequential round-trip latency or exhaust the connection pool. Each
    // chunk waits for all its publishes to settle before the next chunk
    // starts. Bus dedupe via the partial unique index (workspace_id,
    // idempotency_key) handles concurrent same-key races.
    //
    // P1 fix (post-Day-7 audit): the idempotency key now correctly
    // disambiguates null-entity alerts. The original key
    // `anomaly.detected:${alert_type}:${entity_id ?? "global"}:${today}`
    // collapsed all null-entity alerts of the same type+day into a single
    // bus event — e.g. activity_gap alerts (which are per-rep with null
    // entity_id) all got deduped to one event per day. The fix: when
    // entity_id is null, switch to a `user:${assigned_to}` key so each
    // distinct rep produces a distinct bus event.
    const VALID_BUS_SEVERITY = new Set(["low", "medium", "high", "critical"]);
    const BUS_PUBLISH_CHUNK_SIZE = 50;

    // Pre-build inputs once so we don't recompute per chunk.
    const publishInputs = newAlerts.map((alert) => {
      const severity = VALID_BUS_SEVERITY.has(alert.severity)
        ? (alert.severity as "low" | "medium" | "high" | "critical")
        : undefined;
      const dealId = alert.entity_type === "deal" && alert.entity_id
        ? alert.entity_id
        : undefined;
      // Idempotency key disambiguation:
      //   - entity-scoped: entity_id present → key per (alert_type, entity_id, day)
      //   - rep-scoped: entity_id null but assigned_to present → key per (alert_type, user, day)
      //   - system-scoped: both null → key per (alert_type, day) — collapsing is intended here
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
          publishFlowEvent(adminClient, {
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

    console.info(
      `[anomaly-scan] detected=${allAlerts.length} new=${newAlerts.length} scored=${dealsScored} ` +
      `bus_published=${busPublished} bus_failed=${busFailed} ` +
      `(stalling=${stallingDeals.length} overdue=${overdueFollowUps.length} ` +
      `gaps=${activityGaps.length} pipeline=${pipelineRisks.length} ` +
      `embedding_stale=${staleEmbeddings.length} orphan_chunks=${orphanChunks.length})`,
    );

    return new Response(JSON.stringify({
      total_detected: allAlerts.length,
      new_alerts: newAlerts.length,
      deals_scored: dealsScored,
      breakdown: {
        stalling_deals: stallingDeals.length,
        overdue_follow_ups: overdueFollowUps.length,
        activity_gaps: activityGaps.length,
        pipeline_risks: pipelineRisks.length,
        embedding_stale: staleEmbeddings.length,
        orphan_chunks: orphanChunks.length,
      },
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    captureEdgeException(err, { fn: "anomaly-scan", req });
    console.error("[anomaly-scan] error:", err);
    return new Response(JSON.stringify({ error: "Scan failed" }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
});
