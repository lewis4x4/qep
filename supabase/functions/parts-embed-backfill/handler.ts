import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";
import {
  embedTexts,
  formatVectorLiteral,
  OPENAI_EMBEDDING_MODEL,
} from "../_shared/openai-embeddings.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

export interface RequestBody {
  max_batches?: number;
  batch_size?: number;
  workspace?: string | null;
}

export interface BacklogRow {
  id: string;
  workspace_id: string;
  part_number: string;
  description: string | null;
  manufacturer: string | null;
  vendor_code: string | null;
  machine_code: string | null;
  model_code: string | null;
  category: string | null;
  category_code: string | null;
}

export const BATCH_SIZE_DEFAULT = 50;
export const MAX_BATCHES_DEFAULT = 100;
const SLEEP_MS = 200;

export type WorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolvePartsEmbedBackfillWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): WorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.headerWorkspaceId);
    if (explicit) {
      return { mode: "scoped", workspaceId: explicit };
    }
    return { mode: "unscoped" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  if (!workspaceId) {
    return { mode: "scoped", workspaceId: "" };
  }
  return { mode: "scoped", workspaceId };
}

export function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: WorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

export type PartsEmbedBackfillAuthResult =
  | { ok: false; status: 401 | 403; message: string }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export async function authenticatePartsEmbedBackfill(
  req: Request,
  origin: string | null,
): Promise<PartsEmbedBackfillAuthResult> {
  const authHeader = req.headers.get("Authorization")?.trim() ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: normalizeWorkspaceId(req.headers.get("x-workspace-id")),
    };
  }

  const auth = await requireServiceUser(authHeader, origin);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.response.status === 403 ? 403 : 401,
      message: "Unauthorized",
    };
  }

  if (!["admin", "manager", "owner"].includes(auth.role)) {
    return {
      ok: false,
      status: 403,
      message: "parts-embed-backfill requires admin/manager/owner role",
    };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: auth.userId,
    role: auth.role,
    workspaceId: auth.workspaceId,
  };
}

/**
 * Compose the text that we hand to the embedding model for a single part.
 */
export function composeEmbeddingText(
  row: BacklogRow,
  associatedModels: string[],
): string {
  const parts: string[] = [];
  const desc = (row.description ?? "").trim();
  if (desc) parts.push(desc);

  const mfg = (row.manufacturer ?? row.vendor_code ?? "").trim();
  if (mfg) parts.push(mfg);

  const machineBits = [row.machine_code, row.model_code]
    .filter((x) => x && x.trim())
    .join(" ")
    .trim();
  if (machineBits) parts.push(`machine ${machineBits}`);

  const cat = (row.category ?? row.category_code ?? "").trim();
  if (cat) parts.push(`category ${cat}`);

  if (associatedModels.length > 0) {
    parts.push(`used on ${associatedModels.slice(0, 3).join(", ")}`);
  }

  return parts.join(" | ").replace(/\s+/g, " ").trim();
}

export interface PartsEmbedBackfillDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    origin: string | null,
  ) => Promise<PartsEmbedBackfillAuthResult>;
  embedTexts: typeof embedTexts;
  sleep: (ms: number) => Promise<void>;
}

function defaultCreateAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceKey);
}

const defaultDependencies: PartsEmbedBackfillDependencies = {
  createAdminClient: defaultCreateAdminClient,
  authenticate: authenticatePartsEmbedBackfill,
  embedTexts,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function handlePartsEmbedBackfill(
  req: Request,
  overrides: Partial<PartsEmbedBackfillDependencies> = {},
): Promise<Response> {
  const {
    createAdminClient,
    authenticate,
    embedTexts: embedTextsImpl,
    sleep,
  } = { ...defaultDependencies, ...overrides };

  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const auth = await authenticate(req, origin);
    if (!auth.ok) {
      return safeJsonError(auth.message, auth.status, origin);
    }

    const supabase = createAdminClient();
    const body = (req.method === "POST" ? await req.json() : {}) as RequestBody;
    const batchSize = body.batch_size ?? BATCH_SIZE_DEFAULT;
    const maxBatches = body.max_batches ?? MAX_BATCHES_DEFAULT;

    const workspaceScope = resolvePartsEmbedBackfillWorkspace({
      isServiceRole: auth.isServiceRole,
      authWorkspaceId: auth.isServiceRole ? null : auth.workspaceId,
      requestedWorkspaceId: body.workspace ?? null,
      headerWorkspaceId: auth.isServiceRole ? auth.headerWorkspaceId : null,
    });

    const calledBy = auth.isServiceRole
      ? "cron"
      : `user:${auth.userId}`;

    const stats = {
      batches: 0,
      rows_embedded: 0,
      rows_skipped: 0,
      rows_errored: 0,
      api_calls: 0,
    };

    for (let b = 0; b < maxBatches; b++) {
      let query = supabase
        .from("v_parts_embedding_backlog")
        .select(
          "id, workspace_id, part_number, description, manufacturer, vendor_code, machine_code, model_code, category, category_code",
        )
        .limit(batchSize);

      query = applyWorkspaceFilter(query, workspaceScope);

      const { data: backlog, error: backlogErr } = await query;
      if (backlogErr) {
        throw new Error(`backlog read failed: ${backlogErr.message}`);
      }
      if (!backlog || backlog.length === 0) break;

      const partIds = backlog.map((r) => r.id);
      const { data: links } = await supabase
        .from("v_machine_parts_connections")
        .select("part_id, machine_model, association_strength")
        .in("part_id", partIds)
        .order("association_strength", { ascending: false });

      const linksByPart = new Map<string, string[]>();
      for (const l of links ?? []) {
        const pid = (l as { part_id: string }).part_id;
        const model = (l as { machine_model: string | null }).machine_model;
        if (!model) continue;
        const arr = linksByPart.get(pid) ?? [];
        if (arr.length < 3 && !arr.includes(model)) arr.push(model);
        linksByPart.set(pid, arr);
      }

      const rows = backlog as BacklogRow[];
      const texts = rows.map((r) =>
        composeEmbeddingText(r, linksByPart.get(r.id) ?? [])
      );

      let vectors: number[][];
      try {
        vectors = await embedTextsImpl(texts);
        stats.api_calls++;
      } catch (err) {
        captureEdgeException(err, {
          fn: "parts-embed-backfill",
          extra: { stage: "embed" },
        });
        stats.rows_errored += rows.length;
        continue;
      }

      if (vectors.length !== rows.length) {
        throw new Error(
          `embedding count mismatch: ${vectors.length} vs ${rows.length}`,
        );
      }

      const updatesPayload = rows.map((row, i) => ({
        part_id: row.id,
        embedding_literal: formatVectorLiteral(vectors[i]),
        embedding_text: texts[i],
        embedding_model: OPENAI_EMBEDDING_MODEL,
      }));

      const { data: bulkResult, error: bulkErr } = await supabase.rpc(
        "bulk_update_parts_embeddings",
        { p_updates: updatesPayload },
      );

      if (bulkErr) {
        console.warn(`bulk update failed for batch: ${bulkErr.message}`);
        stats.rows_errored += rows.length;
      } else {
        stats.rows_embedded +=
          (bulkResult as { rows_updated?: number })?.rows_updated ?? rows.length;
      }

      stats.batches++;
      if (backlog.length < batchSize) break;
      await sleep(SLEEP_MS);
    }

    let remainingQuery = supabase
      .from("v_parts_embedding_backlog")
      .select("*", { count: "exact", head: true });
    remainingQuery = applyWorkspaceFilter(remainingQuery, workspaceScope);

    const { count: remaining } = await remainingQuery;
    const elapsedMs = Date.now() - startMs;

    if (auth.isServiceRole) {
      await logServiceCronRun(supabase, {
        jobName: "parts-embed-backfill",
        ok: stats.rows_errored === 0,
        metadata: {
          elapsed_ms: elapsedMs,
          stats,
          remaining: remaining ?? null,
          workspace_scope: workspaceScope.mode,
          workspace_id: workspaceScope.mode === "scoped"
            ? workspaceScope.workspaceId
            : null,
        },
      });
    }

    return safeJsonOk({
      ok: true,
      called_by: calledBy,
      elapsed_ms: elapsedMs,
      workspace_scope: workspaceScope.mode,
      workspace_id: workspaceScope.mode === "scoped"
        ? workspaceScope.workspaceId
        : null,
      ...stats,
      rows_remaining: remaining ?? null,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-embed-backfill" });
    return safeJsonError((err as Error).message, 500, origin);
  }
}
