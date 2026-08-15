/**
 * News-Mention Scan (Slice 3)
 *
 * Cron-driven sweep that pulls each workspace's top customer companies,
 * searches Tavily for recent news about them, and ingests any new mentions
 * as `news_mention` signals on the operator feed.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 *   Body `workspace` / `workspace_id` is ignored so a forged target cannot
 *   retarget the scan. Missing active workspace fails closed (403).
 * - Service role (cron / internal): unscoped (all shops) when no workspace hint,
 *   or optional `x-workspace-id` header and/or body `workspace` / `workspace_id`
 *   to narrow to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { ingestSignalDetailed } from "../_shared/qrm-signals.ts";
import type { RouterCtx } from "../_shared/crm-router-service.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const MAX_WORKSPACES_PER_RUN = 25;
export const MAX_COMPANIES_PER_WORKSPACE = 10;
const CACHE_TTL_HOURS = 24;

export interface TavilyResult {
  title: string;
  url: string;
  excerpt: string;
}

export interface RequestBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

export type NewsMentionWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type NewsMentionAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export interface ScanSummary {
  workspacesScanned: number;
  companiesScanned: number;
  resultsSeen: number;
  signalsCreated: number;
  signalsDeduped: number;
}

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret, x-workspace-id",
    "Vary": "Origin",
  };
}

export function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0 || internalSecret.length > 0;
}

export function resolveNewsMentionWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): NewsMentionWorkspaceScope {
  if (!params.isServiceRole) {
    const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
    if (!workspaceId) {
      return { mode: "scoped", workspaceId: "" };
    }
    return { mode: "scoped", workspaceId };
  }

  const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
    normalizeWorkspaceId(params.headerWorkspaceId);
  if (explicit) {
    return { mode: "scoped", workspaceId: explicit };
  }
  return { mode: "unscoped" };
}

export async function authenticateNewsMentionScan(
  req: Request,
  adminClient: SupabaseClient,
): Promise<NewsMentionAuthResult> {
  if (isServiceRoleCaller(req)) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: normalizeWorkspaceId(req.headers.get("x-workspace-id")),
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  const caller = await resolveCallerContext(req, adminClient);

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (!["admin", "manager", "owner"].includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
  };
}

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
  const trimmed = companyName.trim();
  return `"${trimmed}" (construction OR equipment OR rental OR contractor OR project) news`;
}

export async function runScan(
  admin: SupabaseClient,
  tavilyApiKey: string,
  workspaceScope: NewsMentionWorkspaceScope,
  deps: {
    cachedSearch: typeof cachedSearch;
    ingestSignalDetailed: typeof ingestSignalDetailed;
  } = { cachedSearch, ingestSignalDetailed },
): Promise<ScanSummary> {
  const summary: ScanSummary = {
    workspacesScanned: 0,
    companiesScanned: 0,
    resultsSeen: 0,
    signalsCreated: 0,
    signalsDeduped: 0,
  };

  let workspaceIds: string[];

  if (workspaceScope.mode === "scoped") {
    workspaceIds = [workspaceScope.workspaceId];
  } else {
    const { data: wsRows, error: wsErr } = await admin
      .from("crm_companies")
      .select("workspace_id")
      .is("deleted_at", null)
      .order("workspace_id", { ascending: true })
      .limit(5000);

    if (wsErr) throw wsErr;

    const seenWs = new Set<string>();
    workspaceIds = [];
    for (const r of (wsRows ?? []) as Array<{ workspace_id: string }>) {
      if (!seenWs.has(r.workspace_id)) {
        seenWs.add(r.workspace_id);
        workspaceIds.push(r.workspace_id);
        if (workspaceIds.length >= MAX_WORKSPACES_PER_RUN) break;
      }
    }
  }

  for (const workspaceId of workspaceIds) {
    summary.workspacesScanned++;

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
      const results = await deps.cachedSearch(admin, workspaceId, query, tavilyApiKey);
      summary.resultsSeen += results.length;

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
          const { deduped } = await deps.ingestSignalDetailed(ctx, {
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

async function readBody(req: Request): Promise<RequestBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as RequestBody;
}

export interface NewsMentionScanDependencies {
  createAdminClient: typeof createAdminClient;
  authenticateNewsMentionScan: typeof authenticateNewsMentionScan;
  runScan: typeof runScan;
  getTavilyApiKey: () => string;
}

const defaultDependencies: NewsMentionScanDependencies = {
  createAdminClient,
  authenticateNewsMentionScan,
  runScan,
  getTavilyApiKey: () => Deno.env.get("TAVILY_API_KEY") ?? "",
};

export async function handleNewsMentionScan(
  req: Request,
  overrides: Partial<NewsMentionScanDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
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

  const admin = dependencies.createAdminClient();

  const auth = await dependencies.authenticateNewsMentionScan(req, admin);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
      status: auth.status,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await readBody(req);
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace) ??
      normalizeWorkspaceId(body.workspace_id);

    const workspaceScope = resolveNewsMentionWorkspace({
      isServiceRole: auth.isServiceRole,
      authWorkspaceId: auth.isServiceRole ? null : auth.workspaceId,
      requestedWorkspaceId,
      headerWorkspaceId: auth.isServiceRole ? auth.headerWorkspaceId : null,
    });

    if (!auth.isServiceRole && workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const tavilyApiKey = dependencies.getTavilyApiKey();
    if (!tavilyApiKey) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "TAVILY_API_KEY not configured — skipping news scan.",
        }),
        { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
      );
    }

    const summary = await dependencies.runScan(admin, tavilyApiKey, workspaceScope);
    return new Response(
      JSON.stringify({
        ok: true,
        workspace_scope: workspaceScope.mode,
        workspace_id: workspaceScope.mode === "scoped" ? workspaceScope.workspaceId : null,
        ...summary,
      }),
      { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
    console.error("[news-mention-scan] fatal:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Unexpected error.",
      }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" },
      },
    );
  }
}
