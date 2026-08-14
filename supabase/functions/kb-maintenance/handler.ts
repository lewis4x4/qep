import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { logKbJobRunFinish, logKbJobRunStart } from "../_shared/kb-observability.ts";
import {
  embedText,
  embedTexts,
  formatVectorLiteral,
  OPENAI_EMBEDDING_DIMENSIONS,
} from "../_shared/openai-embeddings.ts";
import { buildDocumentChunks, type UploadKind } from "../ingest/chunking.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

const CRM_ENTITY_TABLES: Record<string, string> = {
  contact: "crm_contacts",
  company: "crm_companies",
  deal: "crm_deals",
  equipment: "crm_equipment",
  voice_capture: "voice_captures",
  activity: "crm_activities",
};

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret, x-workspace-id",
    "Vary": "Origin",
  };
}

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export type WorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export function resolveKbMaintenanceWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): WorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.authWorkspaceId);
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

export type KbMaintenanceAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export async function authenticateKbMaintenance(
  req: Request,
  adminClient: SupabaseClient,
): Promise<KbMaintenanceAuthResult> {
  const authHeader = req.headers.get("Authorization")?.trim();
  if (!authHeader) {
    return { ok: false, status: 401 };
  }

  const caller = await resolveCallerContext(req, adminClient);

  if (caller.isServiceRole) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: caller.workspaceId,
    };
  }

  if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId || !caller.userId) {
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

function inferUploadKind(mimeType: string | null | undefined, title: string): UploadKind {
  const normalizedMime = (mimeType ?? "").toLowerCase();
  if (normalizedMime === "application/pdf") return "pdf";
  if (normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (
    normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalizedMime === "application/vnd.ms-excel" ||
    normalizedMime === "text/csv" ||
    normalizedMime === "application/csv"
  ) return "spreadsheet";

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.endsWith(".pdf")) return "pdf";
  if (lowerTitle.endsWith(".docx")) return "docx";
  if (lowerTitle.endsWith(".xlsx") || lowerTitle.endsWith(".xls") || lowerTitle.endsWith(".csv")) {
    return "spreadsheet";
  }
  return "text";
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

function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: WorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

async function reembedDocuments(
  adminClient: SupabaseClient,
  workspaceScope: WorkspaceScope,
  documentIds?: string[],
): Promise<{ processed: number; chunks: number }> {
  let query = adminClient
    .from("documents")
    .select("id, title, raw_text, mime_type")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(100);

  query = applyWorkspaceFilter(query, workspaceScope);

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

    const uploadKind = inferUploadKind(document.mime_type ?? null, document.title);
    const built = buildDocumentChunks({
      rawText,
      uploadKind,
      title: document.title,
    });
    const rows: Array<{
      id: string;
      document_id: string;
      chunk_index: number;
      content: string;
      token_count: number;
      chunk_kind: "paragraph" | "section";
      parent_chunk_id: string | null;
      metadata: Record<string, unknown>;
      embedding: string;
    }> = [];

    for (let i = 0; i < built.chunks.length; i += 10) {
      const batch = built.chunks.slice(i, i + 10);
      const embeddings = await embedTexts(batch.map((chunk) => chunk.content));
      batch.forEach((chunk, index) => {
        rows.push({
          id: chunk.id,
          document_id: document.id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          token_count: chunk.token_count,
          chunk_kind: chunk.chunk_kind,
          parent_chunk_id: chunk.parent_chunk_id,
          metadata: chunk.metadata,
          embedding: formatVectorLiteral(embeddings[index]),
        });
      });
    }

    await adminClient.from("chunks").delete().eq("document_id", document.id);
    const sectionRows = rows.filter((row) => row.chunk_kind === "section");
    const paragraphRows = rows.filter((row) => row.chunk_kind === "paragraph");
    for (const insertRows of [sectionRows, paragraphRows]) {
      for (let i = 0; i < insertRows.length; i += 25) {
        const { error: insertError } = await adminClient.from("chunks").insert(insertRows.slice(i, i + 25));
        if (insertError) throw insertError;
      }
    }

    await adminClient.from("document_audit_events").insert({
      document_id: document.id,
      document_title_snapshot: document.title,
      event_type: "reindexed",
      metadata: {
        source: "kb-maintenance",
        chunk_count: rows.length,
        chunking_strategy: built.strategy,
      },
    });

    processed += 1;
    totalChunks += rows.length;
  }

  return { processed, chunks: totalChunks };
}

async function reembedServiceNotes(
  adminClient: SupabaseClient,
  workspaceScope: WorkspaceScope,
): Promise<{ processed: number }> {
  let query = adminClient
    .from("machine_knowledge_notes")
    .select("id, content")
    .is("embedding", null)
    .order("created_at", { ascending: false })
    .limit(200);

  query = applyWorkspaceFilter(query, workspaceScope);

  const { data: notes, error } = await query;
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

async function reembedCrm(
  workspaceScope: WorkspaceScope,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const body: Record<string, unknown> = { force_all: true };
  if (workspaceScope.mode === "scoped") {
    body.workspace_id = workspaceScope.workspaceId;
  }

  const response = await fetchImpl(`${projectUrl}/functions/v1/embed-crm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`embed-crm returned ${response.status}`);
  }

  return response;
}

async function fetchScopedChunks(
  adminClient: SupabaseClient,
  workspaceScope: WorkspaceScope,
): Promise<Array<{ id: string; embedding: unknown }>> {
  if (workspaceScope.mode === "unscoped") {
    const { data } = await adminClient.from("chunks").select("id, embedding").limit(100);
    return (data ?? []) as Array<{ id: string; embedding: unknown }>;
  }

  const { data: documents } = await adminClient
    .from("documents")
    .select("id")
    .eq("workspace_id", workspaceScope.workspaceId)
    .limit(100);

  const documentIds = (documents ?? []).map((row) => row.id).filter(Boolean);
  if (documentIds.length === 0) return [];

  const { data: chunks } = await adminClient
    .from("chunks")
    .select("id, embedding")
    .in("document_id", documentIds)
    .limit(100);

  return (chunks ?? []) as Array<{ id: string; embedding: unknown }>;
}

async function fetchScopedCrmEmbeddings(
  adminClient: SupabaseClient,
  workspaceScope: WorkspaceScope,
): Promise<Array<{ id: string; embedding: unknown }>> {
  if (workspaceScope.mode === "unscoped") {
    const { data } = await adminClient.from("crm_embeddings").select("id, embedding").limit(100);
    return (data ?? []) as Array<{ id: string; embedding: unknown }>;
  }

  const rows: Array<{ id: string; embedding: unknown }> = [];
  for (const [entityType, table] of Object.entries(CRM_ENTITY_TABLES)) {
    const { data: entities } = await adminClient
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceScope.workspaceId)
      .limit(20);

    const entityIds = (entities ?? [])
      .map((entity) => entity.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (entityIds.length === 0) continue;

    const { data: embeddings } = await adminClient
      .from("crm_embeddings")
      .select("id, embedding")
      .eq("entity_type", entityType)
      .in("entity_id", entityIds);

    rows.push(...((embeddings ?? []) as Array<{ id: string; embedding: unknown }>));
  }

  return rows.slice(0, 100);
}

async function fetchScopedServiceNotes(
  adminClient: SupabaseClient,
  workspaceScope: WorkspaceScope,
): Promise<Array<{ id: string; embedding: unknown }>> {
  let query = adminClient
    .from("machine_knowledge_notes")
    .select("id, embedding")
    .not("embedding", "is", null)
    .limit(100);

  query = applyWorkspaceFilter(query, workspaceScope);

  const { data } = await query;
  return (data ?? []) as Array<{ id: string; embedding: unknown }>;
}

async function validateDimensions(
  adminClient: SupabaseClient,
  workspaceScope: WorkspaceScope,
) {
  const [chunks, crmEmbeddings, serviceNotes] = await Promise.all([
    fetchScopedChunks(adminClient, workspaceScope),
    fetchScopedCrmEmbeddings(adminClient, workspaceScope),
    fetchScopedServiceNotes(adminClient, workspaceScope),
  ]);

  const summarize = (rows: Array<{ id: string; embedding: unknown }>) =>
    rows.reduce<{ checked: number; invalid: string[] }>(
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
    chunks: summarize(chunks),
    crm_embeddings: summarize(crmEmbeddings),
    machine_knowledge_notes: summarize(serviceNotes),
  };
}

export interface KbMaintenanceHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<KbMaintenanceAuthResult>;
  fetchImpl: typeof fetch;
}

function defaultCreateAdminClient(): SupabaseClient {
  return createAdminClient();
}

const defaultDependencies: KbMaintenanceHandlerDependencies = {
  createAdminClient: defaultCreateAdminClient,
  authenticate: authenticateKbMaintenance,
  fetchImpl: fetch,
};

export async function handleKbMaintenance(
  req: Request,
  overrides: Partial<KbMaintenanceHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate, fetchImpl } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = createClientFn();
  let runId: string | null = null;

  try {
    const auth = await authenticate(req, adminClient);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.status === 401 ? "Unauthorized" : "Forbidden" }), {
        status: auth.status,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({})) as {
      action?: string;
      document_ids?: string[];
      workspace_id?: string;
    };
    const action = body.action ?? "validate-dimensions";

    const workspaceScope = auth.isServiceRole
      ? resolveKbMaintenanceWorkspace({
        isServiceRole: true,
        authWorkspaceId: auth.headerWorkspaceId,
        requestedWorkspaceId: body.workspace_id,
      })
      : resolveKbMaintenanceWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId: body.workspace_id,
      });

    if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const jobWorkspaceId = workspaceScope.mode === "scoped" ? workspaceScope.workspaceId : null;

    runId = await logKbJobRunStart(adminClient, {
      workspaceId: jobWorkspaceId,
      jobName: "kb_maintenance",
      metadata: {
        action,
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
      },
    });

    if (action === "re-embed-documents") {
      const docResult = await reembedDocuments(adminClient, workspaceScope, body.document_ids);
      const noteResult = await reembedServiceNotes(adminClient, workspaceScope);
      await logKbJobRunFinish(adminClient, {
        runId,
        status: "success",
        processedCount: docResult.processed + noteResult.processed,
        metadata: {
          documents_processed: docResult.processed,
          chunks_processed: docResult.chunks,
          service_notes_processed: noteResult.processed,
          workspace_scope: workspaceScope.mode,
          workspace_id: jobWorkspaceId,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        action,
        documents_processed: docResult.processed,
        chunks_processed: docResult.chunks,
        service_notes_processed: noteResult.processed,
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
      }), {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "re-embed-crm") {
      const response = await reembedCrm(workspaceScope, fetchImpl);
      const payload = await response.json();
      await logKbJobRunFinish(adminClient, {
        runId,
        status: "success",
        processedCount: Number(payload.total_processed ?? 0),
        errorCount: Number(payload.total_errors ?? 0),
        metadata: {
          ...payload,
          workspace_scope: workspaceScope.mode,
          workspace_id: jobWorkspaceId,
        },
      });
      return new Response(JSON.stringify({
        success: true,
        action,
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
        ...payload,
      }), {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (action === "validate-dimensions") {
      const result = await validateDimensions(adminClient, workspaceScope);
      const invalidCount =
        result.chunks.invalid.length +
        result.crm_embeddings.invalid.length +
        result.machine_knowledge_notes.invalid.length;

      await logKbJobRunFinish(adminClient, {
        runId,
        status: invalidCount > 0 ? "error" : "success",
        processedCount:
          result.chunks.checked + result.crm_embeddings.checked + result.machine_knowledge_notes.checked,
        errorCount: invalidCount,
        metadata: {
          ...result,
          workspace_scope: workspaceScope.mode,
          workspace_id: jobWorkspaceId,
        },
      });

      return new Response(JSON.stringify({
        success: invalidCount === 0,
        action,
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
        ...result,
      }), {
        status: invalidCount > 0 ? 409 : 200,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
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
}
