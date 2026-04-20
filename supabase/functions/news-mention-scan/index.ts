/**
 * News-Mention Scan (Slice 3)
 *
 * Cron-driven sweep that pulls each workspace's top customer companies,
 * searches Tavily for recent news about them, and ingests any new mentions
 * as `news_mention` signals on the operator feed. The recommender then
 * decides whether to surface a move (usually `call_now` with a "heads up,
 * they were in the news" rationale).
 *
 * Why the cron lives here, not in iron-knowledge: iron-knowledge is a
 * latency-sensitive sidecar for the chat agent. News-mention scanning is a
 * background enrichment pass — rate-limited, batched, cacheable — and it's
 * operator-facing rather than assistant-facing.
 *
 * Callable by:
 *   1. pg_cron via `x-internal-service-secret` — the canonical path.
 *   2. Elevated user JWT for manual triggers during pilot setup.
 *
 * Cost control:
 *   The same `iron_web_search_cache` (24h TTL) table that backs the Iron
 *   assistant fronts Tavily here too, so the cron can tick hourly without
 *   burning quota on stable query→result pairs.
 *
 * Idempotency:
 *   Each news hit's dedupe_key is `news:{workspaceId}:{companyId}:{url}`.
 *   A company mentioned in the same article across 10 cron ticks only
 *   writes one signal; the article URL is the stable identity.
 *
 * Budget:
 *   - MAX_WORKSPACES_PER_RUN: hard cap per invocation so a single cron tick
 *     can't run away on a 500-workspace account.
 *   - MAX_COMPANIES_PER_WORKSPACE: only scan the top-N companies by last
 *     activity, sorted by updated_at desc. Expands only if the cron keeps
 *     finishing under budget.
 */

import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { ingestSignalDetailed } from "../_shared/qrm-signals.ts";
import type { RouterCtx } from "../_shared/crm-router-service.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

const MAX_WORKSPACES_PER_RUN = 25;
const MAX_COMPANIES_PER_WORKSPACE = 10;
const CACHE_TTL_HOURS = 24;

interface TavilyResult {
  title: string;
  url: string;
  excerpt: string;
}

/**
 * Hash a search query into a stable cache key. We keep it to a simple SHA-256
 * + hex because the cache is workspace-scoped and doesn't need collision
 * resistance beyond deduping the same exact query.
 */
async function hashQuery(query: string): Promise<string> {
  const bytes = new TextEncoder().encode(query);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function tavilySearch(
  query: string,
  apiKey: string,
): Promise<TavilyResult[]> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
        // Narrow the window so we don't dredge 2019 mentions on every scan.
        days: 30,
        topic: "news",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[news-mention-scan] tavily ${res.status} for query="${query}"`);
      return [];
    }
    const payload = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return (payload.results ?? []).slice(0, 5).map((r) => ({
      title: String(r.title ?? r.url ?? "News result"),
      url: String(r.url ?? ""),
      excerpt: String(r.content ?? r.snippet ?? "").slice(0, 600),
    }));
  } catch (err) {
    console.warn(
      `[news-mention-scan] tavily error for query="${query}":`,
      (err as Error).message,
    );
    return [];
  }
}

/**
 * 24h cache fronting Tavily. Cache miss → hit Tavily + cache the results.
 * Cache hit → return stored results so repeated cron ticks don't burn quota.
 */
async function cachedSearch(
  admin: SupabaseClient,
  workspaceId: string,
  query: string,
  apiKey: string,
): Promise<TavilyResult[]> {
  const queryHash = await hashQuery(query);

  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3_600_000).toISOString();
  const { data: cached } = await admin
    .from("iron_web_search_cache")
    .select("results, created_at")
    .eq("workspace_id", workspaceId)
    .eq("query_hash", queryHash)
    .gte("created_at", cutoff)
    .maybeSingle();

  if (cached) {
    const results = (cached as { results?: TavilyResult[] }).results;
    if (Array.isArray(results)) return results;
  }

  const fresh = await tavilySearch(query, apiKey);

  // Best-effort cache write. If the unique constraint fires we just move on.
  await admin
    .from("iron_web_search_cache")
    .upsert(
      {
        workspace_id: workspaceId,
        query_hash: queryHash,
        query_text: query,
        results: fresh,
        created_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,query_hash" },
    );

  return fresh;
}

function buildQuery(companyName: string): string {
  // Quote the name so Tavily treats it as a phrase, then add equipment-rental
  // qualifiers so we don't drown in unrelated "Acme Industries" hits.
  const trimmed = companyName.trim();
  return `"${trimmed}" (construction OR equipment OR rental OR contractor OR project) news`;
}

interface ScanSummary {
  workspacesScanned: number;
  companiesScanned: number;
  resultsSeen: number;
  signalsCreated: number;
  signalsDeduped: number;
}

async function runScan(admin: SupabaseClient, tavilyApiKey: string): Promise<ScanSummary> {
  const summary: ScanSummary = {
    workspacesScanned: 0,
    companiesScanned: 0,
    resultsSeen: 0,
    signalsCreated: 0,
    signalsDeduped: 0,
  };

  // Pull active workspaces that actually have CRM rows. `crm_companies.workspace_id`
  // is the authoritative workspace scope for QRM in this repo. We distinct-group
  // via a sort+batch pattern since `.distinct()` is not in the supabase-js API.
  const { data: wsRows, error: wsErr } = await admin
    .from("crm_companies")
    .select("workspace_id")
    .is("deleted_at", null)
    .order("workspace_id", { ascending: true })
    .limit(5000); // sample bound — dedup happens in JS below.

  if (wsErr) throw wsErr;

  const seenWs = new Set<string>();
  const workspaceIds: string[] = [];
  for (const r of (wsRows ?? []) as Array<{ workspace_id: string }>) {
    if (!seenWs.has(r.workspace_id)) {
      seenWs.add(r.workspace_id);
      workspaceIds.push(r.workspace_id);
      if (workspaceIds.length >= MAX_WORKSPACES_PER_RUN) break;
    }
  }

  for (const workspaceId of workspaceIds) {
    summary.workspacesScanned++;

    // Top-N companies by recent touch in this workspace.
    const { data: companies, error: cErr } = await admin
      .from("crm_companies")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(MAX_COMPANIES_PER_WORKSPACE);

    if (cErr) {
      console.warn(`[news-mention-scan] company list failed for ${workspaceId}:`, cErr.message);
      continue;
    }

    for (const company of (companies ?? []) as Array<{ id: string; name: string }>) {
      if (!company.name || company.name.length < 3) continue;
      summary.companiesScanned++;

      const query = buildQuery(company.name);
      const results = await cachedSearch(admin, workspaceId, query, tavilyApiKey);
      summary.resultsSeen += results.length;

      // Minimal ctx for ingestSignal — service-role admin write path.
      const ctx = {
        admin,
        callerDb: admin,
        caller: {
          authHeader: null,
          userId: null,
          role: null,
          isServiceRole: true,
          workspaceId,
        },
        workspaceId,
        requestId: crypto.randomUUID(),
        route: "/news-mention-scan",
        method: "POST",
        ipInet: null,
        userAgent: null,
      } as unknown as RouterCtx;

      for (const result of results) {
        if (!result.url) continue;

        const dedupeKey = `news:${workspaceId}:${company.id}:${result.url}`;

        const title = result.title.length > 140
          ? `${result.title.slice(0, 137)}…`
          : result.title;

        try {
          // Single round-trip: ingestSignalDetailed owns dedup via the
          // (workspace_id, dedupe_key) partial unique index and reports
          // back whether the row was brand-new or a pre-existing hit. This
          // used to pre-check the table ourselves, but that raced against
          // the same dedup path inside ingestSignal and produced confusing
          // counter drift. Trust one source of truth.
          const { deduped } = await ingestSignalDetailed(ctx, {
            workspaceId,
            kind: "news_mention",
            severity: "medium",
            source: "tavily",
            title: `${company.name}: ${title}`,
            description: result.excerpt || null,
            entityType: "company",
            entityId: company.id,
            dedupeKey,
            occurredAt: new Date().toISOString(),
            payload: {
              url: result.url,
              raw_title: result.title,
              excerpt: result.excerpt,
              query,
            },
          });

          if (deduped) {
            summary.signalsDeduped++;
          } else {
            summary.signalsCreated++;
          }
        } catch (err) {
          console.warn(
            `[news-mention-scan] signal ingest failed for ${company.id}:`,
            (err as Error).message,
          );
        }
      }
    }
  }

  return summary;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const admin = createAdminClient();

  const isServiceRole = isServiceRoleCaller(req);
  if (!isServiceRole) {
    const caller = await resolveCallerContext(req, admin);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
  }

  const tavilyApiKey = Deno.env.get("TAVILY_API_KEY") ?? "";
  if (!tavilyApiKey) {
    // Zero-blocking integration architecture: degrade without failing the cron.
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "TAVILY_API_KEY not configured — skipping news scan.",
      }),
      { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }

  try {
    const summary = await runScan(admin, tavilyApiKey);
    return new Response(
      JSON.stringify({ ok: true, ...summary }),
      { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[news-mention-scan] fatal:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Unexpected error.",
      }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }
});
