/**
 * iron-knowledge-ingest — KL-2 role-aware hub knowledge ingestion.
 *
 * Authenticated admin/manager/owner callers can ingest a markdown knowledge
 * source into hub_knowledge_source / hub_knowledge_chunk and attach explicit
 * audience+role ACL rows in kb_audience_role_access. Retrieval filters those
 * ACL rows in SQL before ranking, so unauthorized callers receive no matches
 * without source existence leakage.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  embedTexts,
  formatVectorLiteral,
  OPENAI_EMBEDDING_MODEL,
} from "../_shared/openai-embeddings.ts";

const MAX_TITLE_CHARS = 180;
const MAX_BODY_CHARS = 120_000;
const MAX_CHUNK_CHARS = 3000;
const ALLOWED_ADMIN_ROLES = new Set(["admin", "manager", "owner"]);
const ALLOWED_SOURCE_TYPES = new Set(["transcript", "document", "changelog", "decision", "email", "spec", "roadmap", "feedback"]);
const ALLOWED_AUDIENCES = new Set(["internal", "stakeholder"]);
const ALLOWED_ROLES = new Set(["rep", "admin", "manager", "owner", "client_stakeholder"]);

interface RequestBody {
  title?: unknown;
  body_markdown?: unknown;
  source_type?: unknown;
  audience?: unknown;
  allowed_roles?: unknown;
  source_key?: unknown;
}

interface CallerProfile {
  role: string;
  audience: string | null;
  active_workspace_id: string | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const env = readEnv(origin);
    if (env instanceof Response) return env;

    const auth = await requireWriteCaller(req.headers.get("Authorization"), env, origin);
    if (!auth.ok) return auth.response;

    const body = ((await req.json().catch(() => null)) ?? {}) as RequestBody;
    const parsed = parseBody(body);
    if (!parsed.ok) return safeJsonError(parsed.error, 400, origin);

    const contentHash = await sha256Hex(parsed.bodyMarkdown);
    const sourceKey = parsed.sourceKey ?? `iron-ingest:${contentHash}`;
    const embeddingEnabled = Boolean(Deno.env.get("OPENAI_API_KEY"));

    const sourceId = await upsertSource(env.admin, {
      workspaceId: auth.workspaceId,
      sourceKey,
      title: parsed.title,
      sourceType: parsed.sourceType,
      bodyMarkdown: parsed.bodyMarkdown,
      contentHash,
    });

    const accessRows = parsed.allowedRoles.map((role) => ({
      workspace_id: auth.workspaceId,
      source_id: sourceId,
      audience: parsed.audience,
      role,
    }));

    await env.admin.from("kb_audience_role_access").delete().eq("source_id", sourceId);
    const { error: accessError } = await env.admin.from("kb_audience_role_access").insert(accessRows);
    if (accessError) throw new Error(`ACL insert failed: ${accessError.message}`);

    const chunkCount = await replaceChunks(env.admin, {
      sourceId,
      workspaceId: auth.workspaceId,
      bodyMarkdown: parsed.bodyMarkdown,
      embeddingEnabled,
    });

    return safeJsonOk(
      {
        source_id: sourceId,
        source_key: sourceKey,
        content_hash: contentHash,
        audience: parsed.audience,
        allowed_roles: parsed.allowedRoles,
        chunks: chunkCount,
        embedding_model: OPENAI_EMBEDDING_MODEL,
        embedding_status: embeddingEnabled ? "embedded" : "skipped_missing_openai_key",
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "iron-knowledge-ingest", req });
    return safeJsonError(err instanceof Error ? err.message : "Knowledge ingest failed", 500, origin);
  }
});

function readEnv(origin: string | null): { admin: SupabaseClient; anonKey: string; supabaseUrl: string } | Response {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return safeJsonError("SUPABASE_URL/SUPABASE_ANON_KEY/SERVICE_ROLE_KEY missing", 500, origin);
  }
  return {
    supabaseUrl,
    anonKey,
    admin: createClient(supabaseUrl, serviceKey),
  };
}

async function requireWriteCaller(
  authHeader: string | null,
  env: { admin: SupabaseClient; anonKey: string; supabaseUrl: string },
  origin: string | null,
): Promise<
  | { ok: true; userId: string; role: string; workspaceId: string }
  | { ok: false; response: Response }
> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: safeJsonError("Missing authorization", 401, origin) };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, response: safeJsonError("Missing bearer token", 401, origin) };

  const userResp = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.anonKey },
  });
  if (!userResp.ok) return { ok: false, response: safeJsonError("Unauthorized", 401, origin) };

  const user = await userResp.json().catch(() => null) as { id?: string } | null;
  if (!user?.id) return { ok: false, response: safeJsonError("Unauthorized", 401, origin) };

  const { data: profile, error } = await env.admin
    .from("profiles")
    .select("role, audience, active_workspace_id")
    .eq("id", user.id)
    .single<CallerProfile>();

  if (error || !profile) return { ok: false, response: safeJsonError("Profile not found", 403, origin) };
  if (!ALLOWED_ADMIN_ROLES.has(profile.role)) {
    return { ok: false, response: safeJsonError("Forbidden", 403, origin) };
  }

  return {
    ok: true,
    userId: user.id,
    role: profile.role,
    workspaceId: profile.active_workspace_id ?? "default",
  };
}

function parseBody(body: RequestBody):
  | {
      ok: true;
      title: string;
      bodyMarkdown: string;
      sourceType: string;
      audience: string;
      allowedRoles: string[];
      sourceKey: string | null;
    }
  | { ok: false; error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { ok: false, error: "title required" };
  if (title.length > MAX_TITLE_CHARS) return { ok: false, error: `title too long (max ${MAX_TITLE_CHARS})` };

  const bodyMarkdown = typeof body.body_markdown === "string" ? body.body_markdown.trim() : "";
  if (!bodyMarkdown) return { ok: false, error: "body_markdown required" };
  if (bodyMarkdown.length > MAX_BODY_CHARS) return { ok: false, error: `body_markdown too long (max ${MAX_BODY_CHARS})` };

  const sourceType = typeof body.source_type === "string" ? body.source_type.trim() : "document";
  if (!ALLOWED_SOURCE_TYPES.has(sourceType)) return { ok: false, error: "invalid source_type" };

  const audience = typeof body.audience === "string" ? body.audience.trim() : "internal";
  if (!ALLOWED_AUDIENCES.has(audience)) return { ok: false, error: "invalid audience" };

  const rawRoles = Array.isArray(body.allowed_roles) ? body.allowed_roles : [];
  const allowedRoles = [...new Set(rawRoles.filter((role): role is string => typeof role === "string").map((role) => role.trim()))];
  if (allowedRoles.length === 0) return { ok: false, error: "allowed_roles required" };
  for (const role of allowedRoles) {
    if (!ALLOWED_ROLES.has(role)) return { ok: false, error: `invalid allowed role: ${role}` };
    if (audience === "stakeholder" && role !== "client_stakeholder") {
      return { ok: false, error: "stakeholder audience can only target client_stakeholder" };
    }
    if (audience === "internal" && role === "client_stakeholder") {
      return { ok: false, error: "client_stakeholder requires stakeholder audience" };
    }
  }

  const sourceKey = typeof body.source_key === "string" && body.source_key.trim()
    ? `iron-ingest:${body.source_key.trim().slice(0, 160)}`
    : null;

  return { ok: true, title, bodyMarkdown, sourceType, audience, allowedRoles, sourceKey };
}

async function upsertSource(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    sourceKey: string;
    title: string;
    sourceType: string;
    bodyMarkdown: string;
    contentHash: string;
  },
): Promise<string> {
  const { data: existing } = await admin
    .from("hub_knowledge_source")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("drive_file_id", input.sourceKey)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from("hub_knowledge_source")
      .update({
        title: input.title,
        source_type: input.sourceType,
        body_markdown: input.bodyMarkdown,
        content_hash: input.contentHash,
        synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`source update failed: ${error.message}`);
    return existing.id as string;
  }

  const { data, error } = await admin
    .from("hub_knowledge_source")
    .insert({
      workspace_id: input.workspaceId,
      drive_file_id: input.sourceKey,
      title: input.title,
      source_type: input.sourceType,
      body_markdown: input.bodyMarkdown,
      content_hash: input.contentHash,
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(`source insert failed: ${error?.message ?? "unknown"}`);
  return data.id as string;
}

async function replaceChunks(
  admin: SupabaseClient,
  input: {
    sourceId: string;
    workspaceId: string;
    bodyMarkdown: string;
    embeddingEnabled: boolean;
  },
): Promise<number> {
  const chunks = chunkMarkdown(input.bodyMarkdown);
  let rows: Array<Record<string, unknown>> = chunks.map((body, chunkIndex) => ({
    source_id: input.sourceId,
    workspace_id: input.workspaceId,
    chunk_index: chunkIndex,
    body,
    embedding_model: OPENAI_EMBEDDING_MODEL,
    token_count: approximateTokenCount(body),
  }));

  if (input.embeddingEnabled && chunks.length > 0) {
    const vectors = await embedTexts(chunks);
    rows = rows.map((row, index) => ({
      ...row,
      embedding: formatVectorLiteral(vectors[index]),
    }));
  }

  await admin.from("hub_knowledge_chunk").delete().eq("source_id", input.sourceId);
  if (rows.length === 0) return 0;
  const { error } = await admin.from("hub_knowledge_chunk").insert(rows);
  if (error) throw new Error(`chunk insert failed: ${error.message}`);
  return rows.length;
}

function chunkMarkdown(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  const paragraphs = trimmed.split(/\n\s*\n/);
  let buffer = "";
  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHUNK_CHARS && buffer) {
      chunks.push(buffer);
      buffer = paragraph;
    } else {
      buffer = next;
    }

    while (buffer.length > MAX_CHUNK_CHARS) {
      chunks.push(buffer.slice(0, MAX_CHUNK_CHARS));
      buffer = buffer.slice(MAX_CHUNK_CHARS - 200);
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
