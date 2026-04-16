/**
 * Parts Embedding Backfill — Slice 3.1 (Natural-Language Parts Search).
 *
 * Reads v_parts_embedding_backlog in batches of 50, composes a semantic text
 * per part (description | manufacturer | machine | category | aliases | used-on),
 * calls OpenAI text-embedding-3-small, writes vectors back to parts_catalog.
 *
 * Runs as:
 *   - pg_cron every 5 minutes (incremental, service_role)
 *   - Manual admin/manager/owner trigger (one-shot full backfill after deploy)
 *
 * Rate-limit safe: 200ms sleep between batches. 50 parts per batch → ~87 calls
 * for the initial 4,309-row seed → ~45 seconds end-to-end.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";
import {
  embedTexts,
  formatVectorLiteral,
  OPENAI_EMBEDDING_MODEL,
} from "../_shared/openai-embeddings.ts";

interface RequestBody {
  max_batches?: number;
  batch_size?: number;
  workspace?: string | null;
}

interface BacklogRow {
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

const BATCH_SIZE_DEFAULT = 50;
const MAX_BATCHES_DEFAULT = 100;
const SLEEP_MS = 200;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization")?.trim() ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError(origin, 500, "Missing SUPABASE_URL / SERVICE_ROLE_KEY");
    }

    let supabase: SupabaseClient;
    let calledBy: string;

    if (authHeader === `Bearer ${serviceKey}`) {
      supabase = createClient(supabaseUrl, serviceKey);
      calledBy = "cron";
    } else {
      const auth = await requireServiceUser(authHeader, origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError(
          origin,
          403,
          "parts-embed-backfill requires admin/manager/owner role",
        );
      }
      supabase = createClient(supabaseUrl, serviceKey);
      calledBy = `user:${auth.userId}`;
    }

    const body = (req.method === "POST" ? await req.json() : {}) as RequestBody;
    const batchSize = body.batch_size ?? BATCH_SIZE_DEFAULT;
    const maxBatches = body.max_batches ?? MAX_BATCHES_DEFAULT;

    const stats = {
      batches: 0,
      rows_embedded: 0,
      rows_skipped: 0,
      rows_errored: 0,
      api_calls: 0,
    };

    for (let b = 0; b < maxBatches; b++) {
      // Pull next batch from backlog
      let query = supabase
        .from("v_parts_embedding_backlog")
        .select(
          "id, workspace_id, part_number, description, manufacturer, vendor_code, machine_code, model_code, category, category_code",
        )
        .limit(batchSize);

      if (body.workspace) query = query.eq("workspace_id", body.workspace);

      const { data: backlog, error: backlogErr } = await query;
      if (backlogErr) {
        throw new Error(`backlog read failed: ${backlogErr.message}`);
      }
      if (!backlog || backlog.length === 0) break;

      // Hydrate machine_parts_links top-3 associated models for each part
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

      // Compose embedding texts
      const rows = backlog as BacklogRow[];
      const texts = rows.map((r) =>
        composeEmbeddingText(r, linksByPart.get(r.id) ?? [])
      );

      // Embed
      let vectors: number[][];
      try {
        vectors = await embedTexts(texts);
        stats.api_calls++;
      } catch (err) {
        captureEdgeException(err, { fn: "parts-embed-backfill", stage: "embed" });
        stats.rows_errored += rows.length;
        continue;
      }

      if (vectors.length !== rows.length) {
        throw new Error(
          `embedding count mismatch: ${vectors.length} vs ${rows.length}`,
        );
      }

      // Single-RPC bulk update (50 rows per RPC call vs 50 round-trips per batch)
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
        stats.rows_embedded += (bulkResult as { rows_updated?: number })?.rows_updated ?? rows.length;
      }

      stats.batches++;
      if (backlog.length < batchSize) break; // last batch
      await new Promise((r) => setTimeout(r, SLEEP_MS));
    }

    // Report remaining backlog
    const { count: remaining } = await supabase
      .from("v_parts_embedding_backlog")
      .select("*", { count: "exact", head: true });

    const elapsedMs = Date.now() - startMs;

    if (calledBy === "cron") {
      await logServiceCronRun(supabase, {
        jobName: "parts-embed-backfill",
        ok: stats.rows_errored === 0,
        metadata: {
          elapsed_ms: elapsedMs,
          stats,
          remaining: remaining ?? null,
        },
      });
    }

    return safeJsonOk(origin, {
      ok: true,
      called_by: calledBy,
      elapsed_ms: elapsedMs,
      ...stats,
      rows_remaining: remaining ?? null,
    });
  } catch (err) {
    captureEdgeException(err, { fn: "parts-embed-backfill" });
    return safeJsonError(origin, 500, (err as Error).message);
  }
});

/**
 * Compose the text that we hand to the embedding model for a single part.
 *
 * Template:
 *   <description> | <manufacturer> | machine <machine_code> <model_code> |
 *   category <category> | used on: <top-3 machine models from graph>
 *
 * Rules: omit empty parts, collapse whitespace, single-line.
 */
function composeEmbeddingText(row: BacklogRow, associatedModels: string[]): string {
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
