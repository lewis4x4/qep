import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { logKbJobRunFinish, logKbJobRunStart } from "../_shared/kb-observability.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  embedText,
  embedTexts,
  formatVectorLiteral,
  OPENAI_EMBEDDING_DIMENSIONS,
} from "../_shared/openai-embeddings.ts";

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

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let tokenCount = 0;

    while (end < words.length && tokenCount < CHUNK_SIZE) {
      tokenCount += estimateTokens(words[end]);
      end += 1;
    }

    const chunk = words.slice(start, end).join(" ").trim();
    if (chunk) chunks.push(chunk);

    let overlapTokens = 0;
    let overlapStart = end;
    while (overlapStart > start && overlapTokens < CHUNK_OVERLAP) {
      overlapStart -= 1;
      overlapTokens += estimateTokens(words[overlapStart]);
    }
    start = overlapStart === start ? end : overlapStart;
  }

  return chunks;
}

function parseVectorDimensions(value: unknown): number | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : null;
    } catch {
      const trimmed = value.trim();
      if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
      const body = trimmed.slice(1, -1).trim();
      if (!body) return 0;
      return body.split(",").length;
    }
  }
  return null;
}

async function reembedDocuments(
  adminClient: ReturnType<typeof createAdminClient>,
  documentIds?: string[],
): Promise<{ processed: number; chunks: number }> {
  let query = adminClient
    .from("documents")
    .select("id, title, raw_text")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (Array.isArray(documentIds) && documentIds.length > 0) {
    query = query.in("id", documentIds);
  }

  const { data: documents, error } = await query;
  if (error) throw error;

  let processed = 0;
  let totalChunks = 0;

  for (const document of documents ?? []) {
    const rawText = String(document.raw_text ?? "").trim();
    if (!rawText) continue;

    const textChunks = chunkText(rawText);
    const rows: Array<{
      document_id: string;
      chunk_index: number;
      content: string;
      token_count: number;
      embedding: string;
    }> = [];

    for (let i = 0; i < textChunks.length; i += 10) {
      const batch = textChunks.slice(i, i + 10);
      const embeddings = await embedTexts(batch);
      batch.forEach((content, index) => {
        rows.push({
          document_id: document.id,
          chunk_index: i + index,
          content,
          token_count: estimateTokens(content),
          embedding: formatVectorLiteral(embeddings[index]),
        });
      });
    }

    await adminClient.from("chunks").delete().eq("document_id", document.id);
    for (let i = 0; i < rows.length; i += 25) {
      const { error: insertError } = await adminClient.from("chunks").insert(rows.slice(i, i + 25));
      if (insertError) throw insertError;
    }

    await adminClient.from("document_audit_events").insert({
      document_id: document.id,
      document_title_snapshot: document.title,
      event_type: "reindexed",
      metadata: {
        source: "kb-maintenance",
        chunk_count: rows.length,
      },
    });

    processed += 1;
    totalChunks += rows.length;
  }

  return { processed, chunks: totalChunks };
}

async function reembedServiceNotes(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<{ processed: number }> {
  const { data: notes, error } = await adminClient
    .from("machine_knowledge_notes")
    .select("id, content")
    .is("embedding", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  if (!notes?.length) return { processed: 0 };

  let processed = 0;
  for (const note of notes) {
    const content = String(note.content ?? "").trim();
    if (!content) continue;
    const embedding = formatVectorLiteral(await embedText(content));
    const { error: updateError } = await adminClient
      .from("machine_knowledge_notes")
      .update({ embedding })
      .eq("id", note.id);
    if (updateError) throw updateError;
    processed += 1;
  }

  return { processed };
}

async function reembedCrm(adminClient: ReturnType<typeof createAdminClient>): Promise<Response> {
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const response = await fetch(`${projectUrl}/functions/v1/embed-crm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force_all: true }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`embed-crm returned ${response.status}`);
  }

  return response;
}

async function validateDimensions(adminClient: ReturnType<typeof createAdminClient>) {
  const [chunks, crmEmbeddings, serviceNotes] = await Promise.all([
    adminClient.from("chunks").select("id, embedding").limit(100),
    adminClient.from("crm_embeddings").select("id, embedding").limit(100),
    adminClient.from("machine_knowledge_notes").select("id, embedding").not("embedding", "is", null).limit(100),
  ]);

  const summarize = (rows: Array<{ id: string; embedding: unknown }> | null | undefined) =>
    (rows ?? []).reduce<{ checked: number; invalid: string[] }>(
      (acc, row) => {
        acc.checked += 1;
        const dimensions = parseVectorDimensions(row.embedding);
        if (dimensions !== OPENAI_EMBEDDING_DIMENSIONS) {
          acc.invalid.push(row.id);
        }
        return acc;
      },
      { checked: 0, invalid: [] },
    );

  return {
    expected_dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    chunks: summarize((chunks.data ?? []) as Array<{ id: string; embedding: unknown }>),
    crm_embeddings: summarize((crmEmbeddings.data ?? []) as Array<{ id: string; embedding: unknown }>),
    machine_knowledge_notes: summarize((serviceNotes.data ?? []) as Array<{ id: string; embedding: unknown }>),
  };
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = createAdminClient();
  let runId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isServiceRoleBearer = serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;

    if (!isServiceRoleBearer) {
      const caller = await resolveCallerContext(req, adminClient);
      if (!caller.isServiceRole && (!caller.role || !["admin", "manager", "owner"].includes(caller.role))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({})) as {
      action?: string;
      document_ids?: string[];
    };
    const action = body.action ?? "validate-dimensions";

    runId = await logKbJobRunStart(adminClient, {
      jobName: "kb_maintenance",
      metadata: { action },
    });

    if (action === "re-embed-documents") {
      const docResult = await reembedDocuments(adminClient, body.document_ids);
      const noteResult = await reembedServiceNotes(adminClient);
      await logKbJobRunFinish(adminClient, {
        runId,
        status: "success",
        processedCount: docResult.processed + noteResult.processed,
        metadata: {
          documents_processed: docResult.processed,
          chunks_processed: docResult.chunks,
          service_notes_processed: noteResult.processed,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        action,
        documents_processed: docResult.processed,
        chunks_processed: docResult.chunks,
        service_notes_processed: noteResult.processed,
      }), {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "re-embed-crm") {
      const response = await reembedCrm(adminClient);
      const payload = await response.json();
      await logKbJobRunFinish(adminClient, {
        runId,
        status: "success",
        processedCount: Number(payload.total_processed ?? 0),
        errorCount: Number(payload.total_errors ?? 0),
        metadata: payload,
      });
      return new Response(JSON.stringify({ success: true, action, ...payload }), {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "validate-dimensions") {
      const result = await validateDimensions(adminClient);
      const invalidCount =
        result.chunks.invalid.length +
        result.crm_embeddings.invalid.length +
        result.machine_knowledge_notes.invalid.length;

      await logKbJobRunFinish(adminClient, {
        runId,
        status: invalidCount > 0 ? "error" : "success",
        processedCount: result.chunks.checked + result.crm_embeddings.checked + result.machine_knowledge_notes.checked,
        errorCount: invalidCount,
        metadata: result,
      });

      return new Response(JSON.stringify({ success: invalidCount === 0, action, ...result }), {
        status: invalidCount > 0 ? 409 : 200,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    captureEdgeException(error, { fn: "kb-maintenance", req });
    await logKbJobRunFinish(adminClient, {
      runId,
      status: "error",
      errorCount: 1,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });

    console.error("[kb-maintenance] error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "KB maintenance failed",
    }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
});
