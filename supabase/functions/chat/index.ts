import {
  createAdminClient,
  createCallerClient,
  resolveCallerContext,
  type UserRole,
} from "../_shared/dge-auth.ts";
import { enforceRateLimitWithFallback } from "../_shared/rate-limit-fallback.ts";
import { suggestedFollowUpHintLine } from "../_shared/crm-follow-up-suggestions.ts";
import {
  CHAT_TOOLS,
  executeToolCalls,
  type ToolCall,
  type ToolResult,
} from "../_shared/chat-tools.ts";

/** Bumped when chat edge behavior changes; check response headers to confirm deploy. */
const CHAT_EDGE_REVISION = "20260401-function-calling";
const CHAT_MODEL = "gpt-5.4-mini";
const MAX_TOOL_ROUNDS = 3;

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatContextPayload {
  customerProfileId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  // Phase E: AskIronAdvisorButton context types
  equipmentId?: string;
  serviceJobId?: string;
  partsOrderId?: string;
  voiceCaptureId?: string;
  // Wave 6.11 Flare context type
  flareReportId?: string;
}

interface EvidenceItem {
  sourceType: "document" | "crm" | "service_note" | "service_kb";
  sourceId: string;
  sourceTitle: string;
  excerpt: string;
  confidence: number;
  accessClass: string | null;
}

interface SourcePayload {
  id: string;
  title: string;
  confidence: number;
  kind: "document" | "crm";
  excerpt?: string;
}

type DocumentAudience =
  | "company_wide"
  | "finance"
  | "leadership"
  | "admin_owner"
  | "owner_only";

type DocumentFallbackRow = {
  id: string;
  title: string;
  raw_text: string | null;
  audience: DocumentAudience;
  updated_at: string;
};

type ChunkFallbackRow = {
  document_id: string;
  chunk_index: number;
  content: string;
};

type CustomerProfileRow = {
  id: string;
  hubspot_contact_id: string | null;
  customer_name: string;
  company_name: string | null;
  pricing_persona: string | null;
  total_deals: number | null;
  lifetime_value: number | null;
  avg_deal_size: number | null;
  last_interaction_at: string | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  primary_company_id: string | null;
  dge_customer_profile_id: string | null;
  hubspot_contact_id: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
};

type DealRow = {
  id: string;
  name: string;
  amount: number | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  primary_contact_id: string | null;
  company_id: string | null;
};

type ActivityRow = {
  id: string;
  activity_type: string;
  body: string | null;
  occurred_at: string;
};

type QuoteRow = {
  id: string;
  title: string | null;
  status: string;
  updated_at: string;
};

type DealHistoryRow = {
  id: string;
  deal_date: string;
  outcome: string;
  equipment_make: string | null;
  equipment_model: string | null;
  sold_price: number | null;
  competitor: string | null;
};

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonError(
  traceId: string,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string>,
  details?: Record<string, unknown>,
) {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        trace_id: traceId,
        details: details ?? null,
      },
    }),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Trace-Id": traceId,
        "X-QEP-Chat-Revision": CHAT_EDGE_REVISION,
      },
    },
  );
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanUuid(value: unknown): string | null {
  const s = cleanString(value);
  return s && UUID_RE.test(s) ? s : null;
}

function parseWorkspaceIdFromAuthHeader(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) return "default";

  try {
    const token = authHeader.slice("Bearer ".length);
    const parts = token.split(".");
    if (parts.length < 2) return "default";
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson) as {
      workspace_id?: string;
      app_metadata?: { workspace_id?: string };
      user_metadata?: { workspace_id?: string };
    };
    return payload.workspace_id ??
      payload.app_metadata?.workspace_id ??
      payload.user_metadata?.workspace_id ??
      "default";
  } catch {
    return "default";
  }
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "our",
  "please",
  "qep",
  "show",
  "tell",
  "the",
  "to",
  "us",
  "we",
  "what",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simplifyQuestion(message: string): string {
  const simplified = message
    .trim()
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/\?+$/g, "")
    .replace(
      /^(what|where|which|who|why|how)\s+(is|are|was|were|do|does|did|can|could|should|would|were)\s+/i,
      "",
    )
    .replace(/^(tell me about|show me|explain|summarize|describe|find|give me)\s+/i, "")
    .replace(/^(the|our)\s+/i, "")
    .trim();
  return simplified;
}

function extractSearchTokens(message: string): string[] {
  const normalized = normalizeSearchText(message);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(" ")) {
    if (token.length < 3 || QUERY_STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Extract likely proper names (capitalized multi-word sequences) from a message.
 * "John Smith" stays together as one search phrase instead of being split.
 */
function extractProperNames(message: string): string[] {
  const names: string[] = [];
  const matches = message.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed.length >= 4 && trimmed.length <= 60) {
      names.push(trimmed);
    }
  }
  return names;
}

function buildKeywordCandidates(message: string): string[] {
  const candidates: string[] = [];
  const raw = message.trim();
  const simplified = simplifyQuestion(raw);
  const tokenPhrase = extractSearchTokens(raw).slice(0, 6).join(" ");
  for (const candidate of [raw, simplified, tokenPhrase]) {
    if (!candidate) continue;
    const normalized = candidate.trim();
    if (!normalized || candidates.includes(normalized)) continue;
    candidates.push(normalized);
  }
  return candidates;
}

function allowedAudiencesForRole(role: UserRole): DocumentAudience[] {
  if (role === "owner") {
    return ["company_wide", "finance", "leadership", "admin_owner", "owner_only"];
  }
  if (role === "manager") {
    return ["company_wide", "finance", "leadership"];
  }
  if (role === "admin") {
    return ["company_wide", "finance", "admin_owner"];
  }
  return ["company_wide"];
}

function excerptAroundToken(text: string, token: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  const index = lower.indexOf(token.toLowerCase());
  if (index < 0) return truncateText(normalized, 420);
  const start = Math.max(0, index - 120);
  return truncateText(normalized.slice(start, start + 420), 420);
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractIdentifierCandidates(message: string): string[] {
  const seen = new Set<string>();
  const matches = message.match(/\b[a-z0-9]{2,}(?:[-/][a-z0-9]{2,})+\b/gi) ?? [];
  const identifiers: string[] = [];
  for (const match of matches) {
    const trimmed = match.trim();
    const normalized = normalizeIdentifier(trimmed);
    if (normalized.length < 5 || seen.has(normalized)) continue;
    seen.add(normalized);
    identifiers.push(trimmed);
  }
  return identifiers;
}

function excerptAroundIdentifier(text: string, identifier: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";

  const target = normalizeIdentifier(identifier);
  const matchingIndex = lines.findIndex((line) => normalizeIdentifier(line).includes(target));
  if (matchingIndex < 0) {
    return excerptAroundToken(text, identifier);
  }

  const start = Math.max(0, matchingIndex - 1);
  const end = Math.min(lines.length, matchingIndex + 2);
  return truncateText(lines.slice(start, end).join("\n"), 700);
}

function formatCurrency(value: number | null): string {
  if (typeof value !== "number") return "unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function parseChatContext(raw: unknown): ChatContextPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const context = raw as Record<string, unknown>;
  const parsed: ChatContextPayload = {
    customerProfileId: cleanUuid(context.customerProfileId) ?? undefined,
    contactId: cleanUuid(context.contactId) ?? undefined,
    companyId: cleanUuid(context.companyId) ?? undefined,
    dealId: cleanUuid(context.dealId) ?? undefined,
    equipmentId: cleanUuid(context.equipmentId) ?? undefined,
    serviceJobId: cleanUuid(context.serviceJobId) ?? undefined,
    partsOrderId: cleanUuid(context.partsOrderId) ?? undefined,
    voiceCaptureId: cleanUuid(context.voiceCaptureId) ?? undefined,
    flareReportId: cleanUuid(context.flareReportId) ?? undefined,
  };

  if (!parsed.customerProfileId && !parsed.contactId && !parsed.companyId && !parsed.dealId
      && !parsed.equipmentId && !parsed.serviceJobId && !parsed.partsOrderId && !parsed.voiceCaptureId
      && !parsed.flareReportId) {
    return null;
  }
  return parsed;
}

function formatEvidenceBlock(evidence: EvidenceItem[]): string {
  const grouped = {
    document: evidence.filter((item) => item.sourceType === "document"),
    crm: evidence.filter((item) => item.sourceType === "crm"),
    service: evidence.filter((item) => item.sourceType === "service_note" || item.sourceType === "service_kb"),
  };

  const sections: string[] = [];
  if (grouped.document.length > 0) {
    sections.push(
      `Document evidence:\n${grouped.document.map((item) => `[${item.sourceTitle}]\n${item.excerpt}`).join("\n\n---\n\n")}`,
    );
  }
  if (grouped.crm.length > 0) {
    sections.push(
      `QRM evidence:\n${grouped.crm.map((item) => `[${item.sourceTitle}]\n${item.excerpt}`).join("\n\n---\n\n")}`,
    );
  }
  if (grouped.service.length > 0) {
    sections.push(
      `Service knowledge evidence:\n${grouped.service.map((item) => `[${item.sourceTitle}]\n${item.excerpt}`).join("\n\n---\n\n")}`,
    );
  }
  return sections.join("\n\n====\n\n");
}

function buildSourcePayload(evidence: EvidenceItem[]): SourcePayload[] {
  const byKey = new Map<string, SourcePayload>();
  for (const item of evidence) {
    const key = `${item.sourceType}:${item.sourceId}`;
    const existing = byKey.get(key);
    const excerptSnippet = item.excerpt
      ? item.excerpt.slice(0, 200) + (item.excerpt.length > 200 ? "…" : "")
      : undefined;
    const next: SourcePayload = {
      id: item.sourceId,
      title: item.sourceTitle,
      confidence: Math.max(1, Math.round(item.confidence * 100)),
      kind: item.sourceType === "crm" ? "crm" : "document",
      excerpt: excerptSnippet,
    };
    if (!existing || next.confidence > existing.confidence) {
      byKey.set(key, next);
    }
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

type EmbedQueryResult = { ok: true; vector: number[] } | { ok: false; reason: string };

async function embedQuery(message: string, traceId: string): Promise<EmbedQueryResult> {
  try {
    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: message,
      }),
    });
    const embeddingData = await embeddingResponse.json() as {
      data?: Array<{ embedding?: number[] }>;
      error?: { message?: string };
    };
    if (!embeddingResponse.ok) {
      console.error(`[chat:${traceId}] embedding_failed status=${embeddingResponse.status}`, embeddingData);
      return {
        ok: false,
        reason: embeddingData?.error?.message ?? `embedding_http_${embeddingResponse.status}`,
      };
    }
    const vector = embeddingData.data?.[0]?.embedding;
    if (!vector?.length) {
      console.error(`[chat:${traceId}] embedding_failed empty_vector`, embeddingData);
      return { ok: false, reason: "empty_embedding" };
    }
    return { ok: true, vector };
  } catch (error) {
    console.error(`[chat:${traceId}] embedding_failed exception`, error);
    return { ok: false, reason: "embedding_exception" };
  }
}

type OpenAIMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: null; tool_calls: ToolCall[] }
  | ToolResult;

/**
 * Non-streaming completion with tools.
 * Used for tool-calling rounds where we need the full response to decide
 * whether to execute tools or stream the final answer.
 */
async function chatCompletionWithTools(input: {
  traceId: string;
  messages: OpenAIMessage[];
}): Promise<{
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: input.messages,
      max_completion_tokens: 2048,
      tools: CHAT_TOOLS,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.error?.message ?? `openai_http_${response.status}`;
    console.error(`[chat:${input.traceId}] openai_tool_call_failed`, payload);
    throw new Error(detail);
  }

  const choice = payload.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? "stop",
  };
}

/**
 * Open a streaming connection to OpenAI and return the raw Response.
 * Caller is responsible for reading the body as SSE lines.
 * Used for the final answer (after tool-calling rounds complete).
 */
async function openStreamingCompletion(input: {
  traceId: string;
  messages: OpenAIMessage[];
}): Promise<Response> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: input.messages,
      max_completion_tokens: 2048,
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    let detail = `openai_http_${response.status}`;
    try {
      const err = await response.json();
      detail = err?.error?.message ?? detail;
    } catch { /* ignore parse errors */ }
    console.error(`[chat:${input.traceId}] openai_stream_failed status=${response.status} detail=${detail}`);
    throw new Error(detail);
  }

  return response;
}

async function retrieveDocumentEvidence(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    traceId: string;
    role: UserRole;
    workspaceId: string;
    message: string;
    embedding: number[] | null;
  },
): Promise<EvidenceItem[]> {
  const mapEvidence = (rows: Array<{
    source_type: string;
    source_id: string;
    source_title: string;
    excerpt: string;
    confidence: number;
    access_class: string | null;
  }>) =>
    rows.map((item) => ({
      sourceType: (
        item.source_type === "document"
          ? "document"
          : item.source_type === "service_note"
          ? "service_note"
          : "crm"
      ) as EvidenceItem["sourceType"],
      sourceId: item.source_id,
      sourceTitle: item.source_title,
      excerpt: truncateText(item.excerpt ?? "", 500),
      confidence: Math.max(0, Math.min(1, item.confidence ?? 0)),
      accessClass: item.access_class,
    }));

  const identifierCandidates = extractIdentifierCandidates(input.message);
  if (identifierCandidates.length > 0) {
    const { data: docs, error: docsError } = await adminClient
      .from("documents")
      .select("id, title, raw_text, audience, updated_at")
      .eq("status", "published")
      .in("audience", allowedAudiencesForRole(input.role))
      .order("updated_at", { ascending: false })
      .limit(500);

    if (docsError) {
      console.error(`[chat:${input.traceId}] identifier retrieval failed`, docsError);
      throw new Error("DOCUMENT_RETRIEVAL_FAILED");
    }

    const identifierMatches = ((docs ?? []) as DocumentFallbackRow[])
      .map((doc) => {
        const title = doc.title ?? "";
        const rawText = doc.raw_text ?? "";
        const normalizedTitle = normalizeIdentifier(title);
        const normalizedRaw = normalizeIdentifier(rawText);
        let matchedIdentifier: string | null = null;
        let score = 0;

        for (const identifier of identifierCandidates) {
          const normalizedIdentifier = normalizeIdentifier(identifier);
          if (normalizedTitle.includes(normalizedIdentifier)) {
            matchedIdentifier = identifier;
            score = Math.max(score, 7);
          }
          if (normalizedRaw.includes(normalizedIdentifier)) {
            matchedIdentifier = identifier;
            score = Math.max(score, 10);
          }
        }

        if (!matchedIdentifier || score === 0) return null;
        return {
          doc,
          matchedIdentifier,
          score,
          excerpt: excerptAroundIdentifier(rawText || title, matchedIdentifier),
        };
      })
      .filter((item): item is {
        doc: DocumentFallbackRow;
        matchedIdentifier: string;
        score: number;
        excerpt: string;
      } => item !== null)
      .sort((a, b) => b.score - a.score || b.doc.updated_at.localeCompare(a.doc.updated_at))
      .slice(0, 3);

    if (identifierMatches.length > 0) {
      console.info(
        `[chat:${input.traceId}] identifier retrieval matched count=${identifierMatches.length} identifiers=${identifierCandidates.join(",")}`,
      );
      return identifierMatches.map(({ doc, score, excerpt }) => ({
        sourceType: "document" as const,
        sourceId: doc.id,
        sourceTitle: doc.title,
        excerpt,
        confidence: Math.min(0.99, 0.84 + score * 0.012),
        accessClass: doc.audience,
      }));
    }
  }

  const keywordCandidates = buildKeywordCandidates(input.message);
  for (const keywordQuery of keywordCandidates) {
    const { data, error } = await adminClient.rpc("retrieve_document_evidence", {
      query_embedding: input.embedding ? `[${input.embedding.join(",")}]` : null,
      keyword_query: keywordQuery,
      user_role: input.role,
      match_count: 8,
      semantic_match_threshold: 0.45,
      p_workspace_id: input.workspaceId,
    });

    if (error) {
      console.error(
        `[chat:${input.traceId}] document retrieval failed keyword_query=${keywordQuery}`,
        error,
      );
      throw new Error("DOCUMENT_RETRIEVAL_FAILED");
    }

    const mapped = mapEvidence((data ?? []) as Array<{
      source_type: string;
      source_id: string;
      source_title: string;
      excerpt: string;
      confidence: number;
      access_class: string | null;
    }>);
    if (mapped.length > 0) {
      const hitDocIds = mapped.map((item) => item.sourceId);
      const { data: hitDocs, error: hitDocsError } = await adminClient
        .from("documents")
        .select("id, title, raw_text, audience, updated_at")
        .in("id", hitDocIds);
      if (hitDocsError) {
        console.error(`[chat:${input.traceId}] document hit hydration failed`, hitDocsError);
      } else {
        const hydratedById = new Map(
          ((hitDocs ?? []) as DocumentFallbackRow[]).map((doc) => [doc.id, doc]),
        );
        const useFullDocForSingleHit = mapped.length === 1;
        const tokens = extractSearchTokens(input.message);
        for (const item of mapped) {
          const doc = hydratedById.get(item.sourceId);
          if (!doc?.raw_text?.trim()) continue;
          if (useFullDocForSingleHit) {
            item.excerpt = truncateText(doc.raw_text, 50000);
            item.confidence = Math.max(item.confidence, 0.8);
            item.accessClass = doc.audience;
            continue;
          }
          const matchingToken = tokens.find((token) => doc.raw_text?.toLowerCase().includes(token));
          if (matchingToken) {
            item.excerpt = excerptAroundToken(doc.raw_text, matchingToken);
            item.accessClass = doc.audience;
          }
        }
      }
      if (keywordQuery !== input.message) {
        console.info(
          `[chat:${input.traceId}] document retrieval recovered with simplified query="${keywordQuery}" count=${mapped.length}`,
        );
      }
      return mapped;
    }
  }

  const searchTokens = extractSearchTokens(input.message);
  if (searchTokens.length === 0) {
    return [];
  }

  const { data: docs, error: docsError } = await adminClient
    .from("documents")
    .select("id, title, raw_text, audience, updated_at")
    .eq("status", "published")
    .in("audience", allowedAudiencesForRole(input.role))
    .order("updated_at", { ascending: false })
    .limit(150);

  if (docsError) {
    console.error(`[chat:${input.traceId}] document lexical fallback failed`, docsError);
    throw new Error("DOCUMENT_RETRIEVAL_FAILED");
  }

  const scored = ((docs ?? []) as DocumentFallbackRow[])
    .map((doc) => {
      const title = doc.title ?? "";
      const raw = doc.raw_text ?? "";
      const titleLower = title.toLowerCase();
      const rawLower = raw.toLowerCase();
      let score = 0;
      let matched = 0;
      for (const token of searchTokens) {
        if (titleLower.includes(token)) {
          score += 3;
          matched += 1;
        } else if (rawLower.includes(token)) {
          score += 1;
          matched += 1;
        }
      }
      if (matched === 0) return null;
      const excerptSource = raw || title;
      const excerptToken = searchTokens.find((token) => rawLower.includes(token) || titleLower.includes(token)) ?? searchTokens[0];
      return {
        doc,
        matched,
        score,
        excerpt: excerptAroundToken(excerptSource, excerptToken),
      };
    })
    .filter((item): item is { doc: DocumentFallbackRow; matched: number; score: number; excerpt: string } => item !== null)
    .sort((a, b) => b.score - a.score || b.matched - a.matched || b.doc.updated_at.localeCompare(a.doc.updated_at))
    .slice(0, 3);

  if (scored.length > 0) {
    console.info(
      `[chat:${input.traceId}] document lexical fallback matched count=${scored.length} tokens=${searchTokens.join(",")}`,
    );
  }

  const lexicalResults = scored.map(({ doc, matched, score, excerpt }) => ({
    sourceType: "document" as const,
    sourceId: doc.id,
    sourceTitle: doc.title,
    excerpt,
    confidence: Math.min(0.92, 0.62 + matched * 0.08 + Math.min(score, 6) * 0.02),
    accessClass: doc.audience,
  }));
  if (lexicalResults.length > 0) {
    return lexicalResults;
  }

  const visibleDocs = ((docs ?? []) as DocumentFallbackRow[]).filter(
    (doc) => (doc.raw_text?.trim().length ?? 0) > 0,
  );
  if (visibleDocs.length === 0 || visibleDocs.length > 3) {
    return [];
  }

  const visibleDocIds = visibleDocs.map((doc) => doc.id);
  const useFullVisibleDoc = visibleDocs.length === 1;
  let chunksByDoc = new Map<string, string[]>();
  if (!useFullVisibleDoc) {
    const { data: fallbackChunks, error: fallbackChunksError } = await adminClient
      .from("chunks")
      .select("document_id, chunk_index, content")
      .in("document_id", visibleDocIds)
      .order("chunk_index", { ascending: true })
      .limit(24);

    if (fallbackChunksError) {
      console.error(`[chat:${input.traceId}] document tiny-corpus chunk fallback failed`, fallbackChunksError);
    }

    chunksByDoc = new Map<string, string[]>();
    for (const row of ((fallbackChunks ?? []) as ChunkFallbackRow[])) {
      const current = chunksByDoc.get(row.document_id) ?? [];
      if (current.join(" ").length >= 7000) continue;
      current.push(row.content);
      chunksByDoc.set(row.document_id, current);
    }
  }

  console.info(
    `[chat:${input.traceId}] document tiny-corpus fallback used visible_docs=${visibleDocs.length}`,
  );

  return visibleDocs.slice(0, 3).map((doc, index) => {
    const chunkText = (chunksByDoc.get(doc.id) ?? []).join("\n\n");
    const excerptSource = useFullVisibleDoc ? (doc.raw_text || chunkText) : (chunkText || doc.raw_text || "");
    const excerpt = truncateText(excerptSource, useFullVisibleDoc ? 50000 : 2400);
    return {
      sourceType: "document" as const,
      sourceId: doc.id,
      sourceTitle: doc.title,
      excerpt,
      confidence: Math.max(0.35, (useFullVisibleDoc ? 0.74 : 0.5) - index * 0.05),
      accessClass: doc.audience,
    };
  });
}

type ServiceKnowledgeMatchRow = {
  id: string;
  make: string | null;
  model: string | null;
  fault_code: string | null;
  symptom: string;
  solution: string;
  parts_used: unknown[] | null;
  verified: boolean;
  use_count: number;
};

function extractFaultCode(message: string): string | null {
  const match = message.match(/\b[A-Z]{1,4}[- ]?\d{2,5}\b/);
  return match?.[0]?.replace(/\s+/g, "-") ?? null;
}

async function retrieveServiceKnowledgeEvidence(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    traceId: string;
    context: ChatContextPayload | null;
    crmEvidence: EvidenceItem[];
    message: string;
  },
): Promise<EvidenceItem[]> {
  const faultCode = extractFaultCode(input.message);
  let make: string | null = null;
  let model: string | null = null;

  const hydrateEquipment = async (equipmentId: string | null) => {
    if (!equipmentId) return;
    const { data } = await adminClient
      .from("crm_equipment")
      .select("make, model")
      .eq("id", equipmentId)
      .maybeSingle();
    make = cleanString(data?.make) ?? make;
    model = cleanString(data?.model) ?? model;
  };

  if (input.context?.equipmentId) {
    await hydrateEquipment(input.context.equipmentId);
  }

  if ((!make || !model) && input.context?.serviceJobId) {
    const { data: job } = await adminClient
      .from("service_jobs")
      .select("machine_id")
      .eq("id", input.context.serviceJobId)
      .maybeSingle();
    await hydrateEquipment(cleanUuid(job?.machine_id));
  }

  if (!make && !model) {
    const equipmentEvidence = input.crmEvidence.find((item) => item.sourceId.startsWith("crm-equipment:"));
    if (equipmentEvidence) {
      await hydrateEquipment(equipmentEvidence.sourceId.replace("crm-equipment:", ""));
    }
  }

  if (!faultCode && !make && !model) {
    return [];
  }

  const { data, error } = await adminClient.rpc("match_service_knowledge", {
    p_make: make,
    p_model: model,
    p_fault_code: faultCode,
    p_limit: 5,
  });

  if (error) {
    console.warn(`[chat:${input.traceId}] service knowledge lookup failed`, error);
    return [];
  }

  return ((data ?? []) as ServiceKnowledgeMatchRow[]).map((row) => ({
    sourceType: "service_kb",
    sourceId: row.id,
    sourceTitle: `Service KB: ${row.symptom.slice(0, 80)}`,
    excerpt: truncateText(
      [
        row.make || row.model ? `Equipment: ${[row.make, row.model].filter(Boolean).join(" ")}` : null,
        row.fault_code ? `Fault code: ${row.fault_code}` : null,
        `Symptom: ${row.symptom}`,
        `Solution: ${row.solution}`,
        Array.isArray(row.parts_used) && row.parts_used.length > 0 ? `Parts used: ${JSON.stringify(row.parts_used)}` : null,
        row.verified ? "Verified fix" : "Unverified field knowledge",
        row.use_count > 0 ? `Use count: ${row.use_count}` : null,
      ].filter(Boolean).join("\n"),
      700,
    ),
    confidence: row.verified ? 0.92 : 0.82,
    accessClass: "service_kb",
  }));
}

async function buildCustomerContextEvidence(
  adminClient: ReturnType<typeof createAdminClient>,
  callerClient: ReturnType<typeof createCallerClient>,
  input: {
    traceId: string;
    role: UserRole;
    context: ChatContextPayload | null;
  },
): Promise<EvidenceItem[]> {
  if (!input.context) return [];

  const evidence: EvidenceItem[] = [];
  const { context, traceId, role } = input;

  let contact: ContactRow | null = null;
  let company: CompanyRow | null = null;
  let deal: DealRow | null = null;
  let resolvedProfileId = context.customerProfileId ?? null;

  if (context.contactId) {
    const { data } = await callerClient
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, title, primary_company_id, dge_customer_profile_id, hubspot_contact_id")
      .eq("id", context.contactId)
      .is("deleted_at", null)
      .maybeSingle();
    contact = (data as ContactRow | null) ?? null;
    if (contact?.dge_customer_profile_id) resolvedProfileId = contact.dge_customer_profile_id;
  }

  if (!contact && resolvedProfileId) {
    const { data } = await callerClient
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, title, primary_company_id, dge_customer_profile_id, hubspot_contact_id")
      .eq("dge_customer_profile_id", resolvedProfileId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    contact = (data as ContactRow | null) ?? null;
  }

  if (context.companyId) {
    const { data } = await callerClient
      .from("crm_companies")
      .select("id, name, city, state, country")
      .eq("id", context.companyId)
      .is("deleted_at", null)
      .maybeSingle();
    company = (data as CompanyRow | null) ?? null;
  }

  if (!company && contact?.primary_company_id) {
    const { data } = await callerClient
      .from("crm_companies")
      .select("id, name, city, state, country")
      .eq("id", contact.primary_company_id)
      .is("deleted_at", null)
      .maybeSingle();
    company = (data as CompanyRow | null) ?? null;
  }

  if (context.dealId) {
    const { data } = await callerClient
      .from("crm_deals_rep_safe")
      .select("id, name, amount, expected_close_on, next_follow_up_at, primary_contact_id, company_id")
      .eq("id", context.dealId)
      .maybeSingle();
    deal = (data as DealRow | null) ?? null;
    if (!contact && deal?.primary_contact_id) {
      const { data: dealContact } = await callerClient
        .from("crm_contacts")
        .select("id, first_name, last_name, email, phone, title, primary_company_id, dge_customer_profile_id, hubspot_contact_id")
        .eq("id", deal.primary_contact_id)
        .is("deleted_at", null)
        .maybeSingle();
      contact = (dealContact as ContactRow | null) ?? null;
      if (contact?.dge_customer_profile_id) resolvedProfileId = contact.dge_customer_profile_id;
    }
    if (!company && deal?.company_id) {
      const { data: dealCompany } = await callerClient
        .from("crm_companies")
        .select("id, name, city, state, country")
        .eq("id", deal.company_id)
        .is("deleted_at", null)
        .maybeSingle();
      company = (dealCompany as CompanyRow | null) ?? null;
    }
  }

  if (contact) {
    evidence.push({
      sourceType: "crm",
      sourceId: `crm-contact:${contact.id}`,
      sourceTitle: `QRM Contact: ${[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Contact"}`,
      excerpt: truncateText(
        [
          `Contact: ${[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown"}`,
          contact.title ? `Title: ${contact.title}` : null,
          contact.email ? `Email: ${contact.email}` : null,
          contact.phone ? `Phone: ${contact.phone}` : null,
        ].filter(Boolean).join("\n"),
        420,
      ),
      confidence: 0.98,
      accessClass: "crm_context",
    });
  }

  if (company) {
    evidence.push({
      sourceType: "crm",
      sourceId: `crm-company:${company.id}`,
      sourceTitle: `QRM Company: ${company.name}`,
      excerpt: truncateText(
        [
          `Company: ${company.name}`,
          [company.city, company.state, company.country].filter(Boolean).join(", ") || null,
        ].filter(Boolean).join("\n"),
        420,
      ),
      confidence: 0.97,
      accessClass: "crm_context",
    });
  }

  if (deal) {
    evidence.push({
      sourceType: "crm",
      sourceId: `crm-deal:${deal.id}`,
      sourceTitle: `QRM Deal: ${deal.name}`,
      excerpt: truncateText(
        [
          `Deal: ${deal.name}`,
          `Amount: ${formatCurrency(deal.amount)}`,
          deal.expected_close_on ? `Expected close: ${deal.expected_close_on}` : null,
          deal.next_follow_up_at ? `Next follow-up: ${deal.next_follow_up_at}` : null,
          suggestedFollowUpHintLine(deal.next_follow_up_at),
        ].filter(Boolean).join("\n"),
        420,
      ),
      confidence: 0.99,
      accessClass: "crm_context",
    });
  }

  if (resolvedProfileId) {
    const { data: profile } = await adminClient
      .from("customer_profiles_extended")
      .select("id, hubspot_contact_id, customer_name, company_name, pricing_persona, total_deals, lifetime_value, avg_deal_size, last_interaction_at")
      .eq("id", resolvedProfileId)
      .maybeSingle();

    const profileRow = profile as CustomerProfileRow | null;
    let repCanAccessProfile = role !== "rep";
    if (role === "rep" && profileRow?.hubspot_contact_id) {
      const { data: repContactRow } = await callerClient
        .from("crm_contacts")
        .select("id")
        .eq("hubspot_contact_id", profileRow.hubspot_contact_id)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      repCanAccessProfile = Boolean(repContactRow);
    }

    if (profileRow && repCanAccessProfile) {
      evidence.push({
        sourceType: "crm",
        sourceId: `customer-profile:${profileRow.id}`,
        sourceTitle: `Customer Profile: ${profileRow.customer_name}`,
        excerpt: truncateText(
          [
            `Customer: ${profileRow.customer_name}`,
            profileRow.company_name ? `Company: ${profileRow.company_name}` : null,
            profileRow.pricing_persona ? `Pricing persona: ${profileRow.pricing_persona}` : null,
            typeof profileRow.total_deals === "number" ? `Total deals: ${profileRow.total_deals}` : null,
            typeof profileRow.lifetime_value === "number" ? `Lifetime value: ${formatCurrency(profileRow.lifetime_value)}` : null,
            typeof profileRow.avg_deal_size === "number" ? `Average deal size: ${formatCurrency(profileRow.avg_deal_size)}` : null,
            profileRow.last_interaction_at ? `Last interaction: ${profileRow.last_interaction_at}` : null,
          ].filter(Boolean).join("\n"),
          480,
        ),
        confidence: 0.99,
        accessClass: "crm_context",
      });

      const { data: dealHistoryRows } = await callerClient
        .from("customer_deal_history")
        .select("id, deal_date, outcome, equipment_make, equipment_model, sold_price, competitor")
        .eq("customer_profile_id", profileRow.id)
        .order("deal_date", { ascending: false })
        .limit(3);

      const history = (dealHistoryRows ?? []) as DealHistoryRow[];
      if (history.length > 0) {
        evidence.push({
          sourceType: "crm",
          sourceId: `customer-deal-history:${profileRow.id}`,
          sourceTitle: `Sales History: ${profileRow.customer_name}`,
          excerpt: truncateText(
            history.map((row) =>
              `${row.deal_date}: ${row.outcome} ${[row.equipment_make, row.equipment_model].filter(Boolean).join(" ")}${row.sold_price ? ` at ${formatCurrency(row.sold_price)}` : ""}${row.competitor ? ` against ${row.competitor}` : ""}`
            ).join("\n"),
            500,
          ),
          confidence: 0.96,
          accessClass: "crm_context",
        });
      }
    } else if (role === "rep" && !repCanAccessProfile) {
      console.info(`[chat:${traceId}] rep denied contextual profile ${resolvedProfileId}`);
    }
  }

  const quoteFilters: string[] = [];
  if (context.dealId) quoteFilters.push(`crm_deal_id.eq.${context.dealId}`);
  if (context.contactId) quoteFilters.push(`crm_contact_id.eq.${context.contactId}`);
  if (quoteFilters.length > 0) {
    const { data: quoteRows } = await callerClient
      .from("quotes")
      .select("id, title, status, updated_at")
      .or(quoteFilters.join(","))
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(3);

    const quotes = (quoteRows ?? []) as QuoteRow[];
    if (quotes.length > 0) {
      evidence.push({
        sourceType: "crm",
        sourceId: `quotes:${quotes.map((quote) => quote.id).join(",")}`,
        sourceTitle: "QRM Quotes",
        excerpt: truncateText(
          quotes.map((quote) => `${quote.title || quote.id}: ${quote.status} (updated ${quote.updated_at})`).join("\n"),
          420,
        ),
        confidence: 0.94,
        accessClass: "crm_context",
      });
    }
  }

  const activityQueries: Array<Promise<{ data: ActivityRow[] | null }>> = [];
  if (context.contactId) {
    activityQueries.push(
      callerClient
        .from("crm_activities")
        .select("id, activity_type, body, occurred_at")
        .eq("contact_id", context.contactId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(3) as unknown as Promise<{ data: ActivityRow[] | null }>,
    );
  }
  if (context.dealId) {
    activityQueries.push(
      callerClient
        .from("crm_activities")
        .select("id, activity_type, body, occurred_at")
        .eq("deal_id", context.dealId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(3) as unknown as Promise<{ data: ActivityRow[] | null }>,
    );
  }
  if (context.companyId) {
    activityQueries.push(
      callerClient
        .from("crm_activities")
        .select("id, activity_type, body, occurred_at")
        .eq("company_id", context.companyId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(3) as unknown as Promise<{ data: ActivityRow[] | null }>,
    );
  }

  if (activityQueries.length > 0) {
    const activityResults = await Promise.all(activityQueries);
    const deduped = new Map<string, ActivityRow>();
    for (const result of activityResults) {
      for (const row of result.data ?? []) {
        deduped.set(row.id, row);
      }
    }
    const activities = [...deduped.values()]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 5);

    if (activities.length > 0) {
      evidence.push({
        sourceType: "crm",
        sourceId: `crm-activities:${activities.map((activity) => activity.id).join(",")}`,
        sourceTitle: "Recent QRM Activity",
        excerpt: truncateText(
          activities.map((row) => `${row.occurred_at}: ${row.activity_type}${row.body ? ` — ${truncateText(row.body, 120)}` : ""}`).join("\n"),
          500,
        ),
        confidence: 0.93,
        accessClass: "crm_context",
      });
    }
  }

  return evidence;
}

type EquipmentRow = {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
  category: string | null;
  condition: string | null;
  availability: string | null;
  engine_hours: number | null;
  location_description: string | null;
  current_market_value: number | null;
  daily_rental_rate: number | null;
};

type VoiceCaptureRow = {
  id: string;
  transcript: string | null;
  extracted_data: Record<string, unknown> | null;
  created_at: string;
};

type MarketValuationRow = {
  id: string;
  stock_number: string | null;
  make: string;
  model: string;
  year: number;
  hours: number | null;
  condition: string | null;
  location: string | null;
  estimated_fmv: number | null;
  low_estimate: number | null;
  high_estimate: number | null;
  source: string;
  updated_at: string;
};

type AuctionResultRow = {
  id: string;
  source: string;
  auction_date: string;
  make: string;
  model: string;
  year: number | null;
  hours: number | null;
  hammer_price: number;
  location: string | null;
  condition: string | null;
};

type CompetitorListingRow = {
  id: string;
  source: string;
  make: string;
  model: string;
  year: number | null;
  hours: number | null;
  asking_price: number | null;
  location: string | null;
  is_active: boolean;
  last_seen_at: string;
};

type CustomerProfileExtRow = {
  id: string;
  customer_name: string;
  company_name: string | null;
  industry: string | null;
  region: string | null;
  pricing_persona: string | null;
  lifetime_value: number | null;
  total_deals: number | null;
  avg_deal_size: number | null;
  avg_discount_pct: number | null;
  fleet_size: number | null;
  seasonal_pattern: string | null;
  price_sensitivity_score: number | null;
  notes: string | null;
};

type FleetIntelligenceRow = {
  id: string;
  customer_name: string;
  make: string;
  model: string;
  year: number | null;
  current_hours: number | null;
  equipment_serial: string | null;
  utilization_trend: string | null;
  predicted_replacement_date: string | null;
  replacement_confidence: number | null;
  outreach_status: string | null;
  outreach_deal_value: number | null;
};

type ManufacturerIncentiveRow = {
  id: string;
  oem_name: string;
  program_name: string;
  discount_type: string;
  discount_value: number;
  eligibility_criteria: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

type FinancingRateRow = {
  id: string;
  lender_name: string;
  term_months: number;
  credit_tier: string;
  rate_pct: number;
  dealer_holdback_pct: number | null;
  min_amount: number | null;
  max_amount: number | null;
  is_active: boolean;
};

type OutreachQueueRow = {
  id: string;
  customer_name: string;
  equipment_description: string;
  trigger_reason: string;
  estimated_deal_value: number | null;
  priority_score: number | null;
  status: string;
  notes: string | null;
};

/**
 * Broad QRM search: always runs alongside document retrieval so the assistant
 * can answer questions about ANY entity in the system — contacts, companies,
 * deals, equipment, activities, voice notes, and quotes — without needing
 * explicit context IDs from the frontend.
 *
 * All searches run in parallel for speed.  Results are scored, deduped by
 * sourceId, and capped to prevent the context window from exploding.
 */
async function searchCrmBroadly(
  callerClient: ReturnType<typeof createCallerClient>,
  input: {
    traceId: string;
    role: UserRole;
    message: string;
  },
): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  const tokens = extractSearchTokens(input.message);
  if (tokens.length === 0) return evidence;

  const queryText = simplifyQuestion(input.message).slice(0, 120);
  if (!queryText || queryText.length < 2) return evidence;

  const searchTokens = tokens.slice(0, 5);
  const likePattern = `%${queryText.slice(0, 80)}%`;
  const firstToken = searchTokens[0] ?? queryText;

  // Build token-based OR patterns for free-text columns (body, transcript)
  // instead of using the full question, which almost never matches verbatim
  const meaningfulTokens = searchTokens.filter((t) => t.length >= 3);
  const bodyOrPattern = meaningfulTokens.length > 0
    ? meaningfulTokens.map((t) => `body.ilike.%${t}%`).join(",")
    : `body.ilike.${likePattern}`;
  const transcriptOrPattern = meaningfulTokens.length > 0
    ? meaningfulTokens.map((t) => `transcript.ilike.%${t}%`).join(",")
    : `transcript.ilike.${likePattern}`;

  // Extract proper names so "John Smith" is searched as a compound phrase
  const properNames = extractProperNames(input.message);

  // ── 1. Fire all searches in parallel ──────────────────────────────────────
  const contactSearches: Array<Promise<{ data: ContactRow[] | null }>> = [];
  for (const token of searchTokens) {
    if (token.length < 3) continue;
    contactSearches.push(
      callerClient
        .from("crm_contacts")
        .select("id, first_name, last_name, email, phone, title, primary_company_id, dge_customer_profile_id, hubspot_contact_id")
        .or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%,email.ilike.%${token}%`)
        .is("deleted_at", null)
        .limit(5) as unknown as Promise<{ data: ContactRow[] | null }>,
    );
  }
  // Also search by extracted proper names (e.g. "John Smith" → first + last match)
  for (const name of properNames) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      contactSearches.push(
        callerClient
          .from("crm_contacts")
          .select("id, first_name, last_name, email, phone, title, primary_company_id, dge_customer_profile_id, hubspot_contact_id")
          .ilike("first_name", `%${first}%`)
          .ilike("last_name", `%${last}%`)
          .is("deleted_at", null)
          .limit(3) as unknown as Promise<{ data: ContactRow[] | null }>,
      );
    }
  }

  // Build a make/model ilike filter for equipment-centric DGE tables
  const equipLikeTokens = searchTokens.filter((t) => t.length >= 3).slice(0, 3);
  const makeModelOr = equipLikeTokens.length > 0
    ? equipLikeTokens.map((t) => `make.ilike.%${t}%,model.ilike.%${t}%`).join(",")
    : `make.ilike.${likePattern},model.ilike.${likePattern}`;

  const [
    contactResults,
    companyResult,
    dealResult,
    equipmentResult,
    activityResult,
    voiceCaptureResult,
    quoteResult,
    valuationResult,
    auctionResult,
    competitorResult,
    customerProfileResult,
    fleetResult,
    incentiveResult,
    financingResult,
    outreachResult,
  ] = await Promise.all([
    Promise.all(contactSearches),
    callerClient
      .from("crm_companies")
      .select("id, name, city, state, country")
      .ilike("name", likePattern)
      .is("deleted_at", null)
      .limit(5),
    callerClient
      .from("crm_deals_rep_safe")
      .select("id, name, amount, expected_close_on, next_follow_up_at, primary_contact_id, company_id")
      .ilike("name", likePattern)
      .limit(5),
    callerClient
      .from("crm_equipment")
      .select("id, name, make, model, year, serial_number, category, condition, availability, engine_hours, location_description, current_market_value, daily_rental_rate")
      .or(`name.ilike.${likePattern},make.ilike.${likePattern},model.ilike.${likePattern},serial_number.ilike.${likePattern}`)
      .is("deleted_at", null)
      .limit(5),
    callerClient
      .from("crm_activities")
      .select("id, activity_type, body, occurred_at")
      .or(bodyOrPattern)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(10),
    callerClient
      .from("voice_captures")
      .select("id, transcript, extracted_data, created_at")
      .or(transcriptOrPattern)
      .order("created_at", { ascending: false })
      .limit(10),
    callerClient
      .from("quotes")
      .select("id, title, status, updated_at")
      .ilike("title", likePattern)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(3),
    // ── DGE intelligence tables ─────────────────────────────────────────
    callerClient
      .from("market_valuations")
      .select("id, stock_number, make, model, year, hours, condition, location, estimated_fmv, low_estimate, high_estimate, source, updated_at")
      .or(makeModelOr)
      .order("updated_at", { ascending: false })
      .limit(5),
    callerClient
      .from("auction_results")
      .select("id, source, auction_date, make, model, year, hours, hammer_price, location, condition")
      .or(makeModelOr)
      .order("auction_date", { ascending: false })
      .limit(5),
    callerClient
      .from("competitor_listings")
      .select("id, source, make, model, year, hours, asking_price, location, is_active, last_seen_at")
      .or(makeModelOr)
      .eq("is_active", true)
      .order("last_seen_at", { ascending: false })
      .limit(5),
    callerClient
      .from("customer_profiles_extended")
      .select("id, customer_name, company_name, industry, region, pricing_persona, lifetime_value, total_deals, avg_deal_size, avg_discount_pct, fleet_size, seasonal_pattern, price_sensitivity_score, notes")
      .or(`customer_name.ilike.${likePattern},company_name.ilike.${likePattern}`)
      .limit(5),
    callerClient
      .from("fleet_intelligence")
      .select("id, customer_name, make, model, year, current_hours, equipment_serial, utilization_trend, predicted_replacement_date, replacement_confidence, outreach_status, outreach_deal_value")
      .or(`customer_name.ilike.${likePattern},${makeModelOr}`)
      .order("updated_at", { ascending: false })
      .limit(5),
    callerClient
      .from("manufacturer_incentives")
      .select("id, oem_name, program_name, discount_type, discount_value, eligibility_criteria, start_date, end_date, is_active")
      .or(`oem_name.ilike.${likePattern},program_name.ilike.${likePattern}`)
      .eq("is_active", true)
      .limit(5),
    callerClient
      .from("financing_rate_matrix")
      .select("id, lender_name, term_months, credit_tier, rate_pct, dealer_holdback_pct, min_amount, max_amount, is_active")
      .or(`lender_name.ilike.${likePattern},credit_tier.ilike.${likePattern}`)
      .eq("is_active", true)
      .limit(5),
    callerClient
      .from("outreach_queue")
      .select("id, customer_name, equipment_description, trigger_reason, estimated_deal_value, priority_score, status, notes")
      .or(`customer_name.ilike.${likePattern},equipment_description.ilike.${likePattern},trigger_reason.ilike.${likePattern}`)
      .order("priority_score", { ascending: false })
      .limit(5),
  ]);

  const seenIds = new Set<string>();
  function pushEvidence(item: EvidenceItem) {
    if (seenIds.has(item.sourceId)) return;
    seenIds.add(item.sourceId);
    evidence.push(item);
  }

  // ── 2. Process contacts ─────────────────────────────────────────────────
  const contactMap = new Map<string, ContactRow>();
  for (const result of contactResults) {
    for (const row of result.data ?? []) {
      contactMap.set(row.id, row);
    }
  }
  const scoredContacts = [...contactMap.values()].map((c) => {
    const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ").toLowerCase();
    const emailLower = (c.email ?? "").toLowerCase();
    let score = 0;
    for (const token of searchTokens) {
      if (fullName.includes(token)) score += 2;
      if (emailLower.includes(token)) score += 1;
    }
    return { contact: c, score };
  }).filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const { contact } of scoredContacts) {
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Contact";
    pushEvidence({
      sourceType: "crm",
      sourceId: `crm-contact:${contact.id}`,
      sourceTitle: `QRM Contact: ${fullName}`,
      excerpt: truncateText(
        [
          `Contact: ${fullName}`,
          contact.title ? `Title: ${contact.title}` : null,
          contact.email ? `Email: ${contact.email}` : null,
          contact.phone ? `Phone: ${contact.phone}` : null,
        ].filter(Boolean).join("\n"),
        420,
      ),
      confidence: 0.92,
      accessClass: "crm_context",
    });

    // Pull related company
    if (contact.primary_company_id) {
      const { data: companyRow } = await callerClient
        .from("crm_companies")
        .select("id, name, city, state, country")
        .eq("id", contact.primary_company_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (companyRow) {
        const co = companyRow as CompanyRow;
        pushEvidence({
          sourceType: "crm",
          sourceId: `crm-company:${co.id}`,
          sourceTitle: `QRM Company: ${co.name}`,
          excerpt: truncateText(
            [co.name, [co.city, co.state, co.country].filter(Boolean).join(", ") || null]
              .filter(Boolean).join("\n"),
            300,
          ),
          confidence: 0.90,
          accessClass: "crm_context",
        });
      }
    }

    // Pull deals for this contact
    const { data: contactDealRows } = await callerClient
      .from("crm_deals_rep_safe")
      .select("id, name, amount, expected_close_on, next_follow_up_at, primary_contact_id, company_id")
      .eq("primary_contact_id", contact.id)
      .order("expected_close_on", { ascending: false })
      .limit(3);
    const contactDeals = (contactDealRows ?? []) as DealRow[];
    if (contactDeals.length > 0) {
      pushEvidence({
        sourceType: "crm",
        sourceId: `crm-deals-for-contact:${contact.id}`,
        sourceTitle: `Deals for ${fullName}`,
        excerpt: truncateText(
          contactDeals.map((d) =>
            [
              `Deal: ${d.name}`,
              `Amount: ${formatCurrency(d.amount)}`,
              d.expected_close_on ? `Close: ${d.expected_close_on}` : null,
              d.next_follow_up_at ? `Follow-up: ${d.next_follow_up_at}` : null,
            ].filter(Boolean).join(" | "),
          ).join("\n"),
          500,
        ),
        confidence: 0.93,
        accessClass: "crm_context",
      });
    }

    // Pull activities for this contact + their deals
    const contactActivities: ActivityRow[] = [];
    const { data: contactActRows } = await callerClient
      .from("crm_activities")
      .select("id, activity_type, body, occurred_at")
      .eq("contact_id", contact.id)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(5);
    for (const a of (contactActRows ?? []) as ActivityRow[]) contactActivities.push(a);

    for (const deal of contactDeals.slice(0, 2)) {
      const { data: dActRows } = await callerClient
        .from("crm_activities")
        .select("id, activity_type, body, occurred_at")
        .eq("deal_id", deal.id)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(3);
      for (const da of (dActRows ?? []) as ActivityRow[]) {
        if (!contactActivities.some((a) => a.id === da.id)) contactActivities.push(da);
      }
    }

    if (contactActivities.length > 0) {
      contactActivities.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
      pushEvidence({
        sourceType: "crm",
        sourceId: `crm-activities-for-contact:${contact.id}`,
        sourceTitle: `Recent Activity: ${fullName}`,
        excerpt: truncateText(
          contactActivities.slice(0, 5).map((row) =>
            `${row.occurred_at}: ${row.activity_type}${row.body ? ` — ${truncateText(row.body, 150)}` : ""}`
          ).join("\n"),
          600,
        ),
        confidence: 0.91,
        accessClass: "crm_context",
      });
    }

    // Pull voice captures linked to this contact or mentioning their name
    const vcSearches = await Promise.all([
      callerClient
        .from("voice_captures")
        .select("id, transcript, extracted_data, created_at")
        .eq("linked_contact_id", contact.id)
        .order("created_at", { ascending: false })
        .limit(3),
      callerClient
        .from("voice_captures")
        .select("id, transcript, extracted_data, created_at")
        .ilike("transcript", `%${(contact.last_name ?? contact.first_name ?? "").slice(0, 40)}%`)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);
    const contactVoiceNotes = new Map<string, VoiceCaptureRow>();
    for (const res of vcSearches) {
      for (const row of (res.data ?? []) as VoiceCaptureRow[]) {
        contactVoiceNotes.set(row.id, row);
      }
    }
    if (contactVoiceNotes.size > 0) {
      const vcList = [...contactVoiceNotes.values()]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 3);
      pushEvidence({
        sourceType: "crm",
        sourceId: `voice-notes-for-contact:${contact.id}`,
        sourceTitle: `Voice Notes: ${fullName}`,
        excerpt: truncateText(
          vcList.map((vc) =>
            `${vc.created_at.slice(0, 10)}: ${truncateText(vc.transcript ?? "", 200)}`
          ).join("\n"),
          600,
        ),
        confidence: 0.93,
        accessClass: "crm_context",
      });
    }
  }

  // ── 3. Process companies ────────────────────────────────────────────────
  for (const co of ((companyResult.data ?? []) as CompanyRow[]).slice(0, 3)) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `crm-company:${co.id}`,
      sourceTitle: `QRM Company: ${co.name}`,
      excerpt: truncateText(
        [co.name, [co.city, co.state, co.country].filter(Boolean).join(", ") || null]
          .filter(Boolean).join("\n"),
        300,
      ),
      confidence: 0.88,
      accessClass: "crm_context",
    });
  }

  // ── 4. Process deals ────────────────────────────────────────────────────
  for (const deal of ((dealResult.data ?? []) as DealRow[]).slice(0, 3)) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `crm-deal:${deal.id}`,
      sourceTitle: `QRM Deal: ${deal.name}`,
      excerpt: truncateText(
        [
          `Deal: ${deal.name}`,
          `Amount: ${formatCurrency(deal.amount)}`,
          deal.expected_close_on ? `Expected close: ${deal.expected_close_on}` : null,
          deal.next_follow_up_at ? `Next follow-up: ${deal.next_follow_up_at}` : null,
          suggestedFollowUpHintLine(deal.next_follow_up_at),
        ].filter(Boolean).join("\n"),
        420,
      ),
      confidence: 0.91,
      accessClass: "crm_context",
    });
  }

  // ── 5. Process equipment ────────────────────────────────────────────────
  for (const eq of ((equipmentResult.data ?? []) as EquipmentRow[]).slice(0, 3)) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `crm-equipment:${eq.id}`,
      sourceTitle: `Equipment: ${[eq.year, eq.make, eq.model].filter(Boolean).join(" ") || eq.name}`,
      excerpt: truncateText(
        [
          `Name: ${eq.name}`,
          eq.make ? `Make: ${eq.make}` : null,
          eq.model ? `Model: ${eq.model}` : null,
          eq.year ? `Year: ${eq.year}` : null,
          eq.serial_number ? `Serial: ${eq.serial_number}` : null,
          eq.category ? `Category: ${eq.category}` : null,
          eq.condition ? `Condition: ${eq.condition}` : null,
          eq.availability ? `Availability: ${eq.availability}` : null,
          eq.engine_hours ? `Engine hours: ${eq.engine_hours}` : null,
          eq.location_description ? `Location: ${eq.location_description}` : null,
          typeof eq.current_market_value === "number" ? `Market value: ${formatCurrency(eq.current_market_value)}` : null,
          typeof eq.daily_rental_rate === "number" ? `Daily rental: ${formatCurrency(eq.daily_rental_rate)}` : null,
        ].filter(Boolean).join("\n"),
        500,
      ),
      confidence: 0.90,
      accessClass: "crm_context",
    });
  }

  // ── 6. Process activities (token-scored, best matches first) ─────────────
  const scoredActivities = ((activityResult.data ?? []) as ActivityRow[])
    .map((act) => {
      const bodyLower = (act.body ?? "").toLowerCase();
      let matchCount = 0;
      for (const t of meaningfulTokens) {
        if (bodyLower.includes(t)) matchCount++;
      }
      return { act, matchCount };
    })
    .filter((x) => x.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);

  for (const { act, matchCount } of scoredActivities.slice(0, 5)) {
    const bestToken = meaningfulTokens.find((t) => (act.body ?? "").toLowerCase().includes(t)) ?? firstToken;
    const excerptText = act.body
      ? excerptAroundToken(act.body, bestToken)
      : "";
    if (!excerptText) continue;
    pushEvidence({
      sourceType: "crm",
      sourceId: `crm-activity:${act.id}`,
      sourceTitle: `${act.activity_type} (${act.occurred_at.slice(0, 10)})`,
      excerpt: truncateText(excerptText, 500),
      confidence: Math.min(0.95, 0.80 + matchCount * 0.03),
      accessClass: "crm_context",
    });
  }

  // ── 7. Process voice captures (token-scored, best matches first) ────────
  const scoredVoiceCaptures = ((voiceCaptureResult.data ?? []) as VoiceCaptureRow[])
    .map((vc) => {
      const transcriptLower = (vc.transcript ?? "").toLowerCase();
      const extractedText = JSON.stringify(vc.extracted_data ?? {}).toLowerCase();
      let matchCount = 0;
      for (const t of meaningfulTokens) {
        if (transcriptLower.includes(t)) matchCount++;
        else if (extractedText.includes(t)) matchCount++;
      }
      return { vc, matchCount };
    })
    .filter((x) => x.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);

  for (const { vc, matchCount } of scoredVoiceCaptures.slice(0, 5)) {
    const bestToken = meaningfulTokens.find((t) => (vc.transcript ?? "").toLowerCase().includes(t)) ?? firstToken;
    const excerptText = vc.transcript
      ? excerptAroundToken(vc.transcript, bestToken)
      : "";
    if (!excerptText) continue;
    pushEvidence({
      sourceType: "crm",
      sourceId: `voice-capture:${vc.id}`,
      sourceTitle: `Voice Note (${vc.created_at.slice(0, 10)})`,
      excerpt: truncateText(excerptText, 500),
      confidence: Math.min(0.95, 0.80 + matchCount * 0.03),
      accessClass: "crm_context",
    });
  }

  // ── 7b. Fallback: search voice captures by extracted_data JSONB for proper names ──
  if (properNames.length > 0 && scoredVoiceCaptures.length === 0) {
    for (const name of properNames.slice(0, 2)) {
      const { data: jsonVcs } = await callerClient
        .from("voice_captures")
        .select("id, transcript, extracted_data, created_at")
        .ilike("extracted_data->>contactName" as never, `%${name}%`)
        .order("created_at", { ascending: false })
        .limit(3);
      for (const vc of (jsonVcs ?? []) as VoiceCaptureRow[]) {
        const excerptText = vc.transcript
          ? excerptAroundToken(vc.transcript, name.split(/\s+/)[0])
          : JSON.stringify(vc.extracted_data ?? {}).slice(0, 400);
        pushEvidence({
          sourceType: "crm",
          sourceId: `voice-capture:${vc.id}`,
          sourceTitle: `Voice Note: ${name} (${vc.created_at.slice(0, 10)})`,
          excerpt: truncateText(excerptText, 500),
          confidence: 0.90,
          accessClass: "crm_context",
        });
      }
    }
  }

  // ── 8. Process quotes ───────────────────────────────────────────────────
  for (const qt of ((quoteResult.data ?? []) as QuoteRow[]).slice(0, 3)) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `crm-quote:${qt.id}`,
      sourceTitle: `Quote: ${qt.title || qt.id}`,
      excerpt: truncateText(
        `${qt.title || qt.id}: ${qt.status} (updated ${qt.updated_at})`,
        300,
      ),
      confidence: 0.87,
      accessClass: "crm_context",
    });
  }

  // ── 9. Process market valuations ──────────────────────────────────────
  for (const mv of ((valuationResult.data ?? []) as MarketValuationRow[]).slice(0, 3)) {
    const label = [mv.year, mv.make, mv.model].filter(Boolean).join(" ");
    pushEvidence({
      sourceType: "crm",
      sourceId: `market-valuation:${mv.id}`,
      sourceTitle: `Market Valuation: ${label}`,
      excerpt: truncateText(
        [
          `Equipment: ${label}`,
          mv.stock_number ? `Stock #: ${mv.stock_number}` : null,
          mv.hours ? `Hours: ${mv.hours}` : null,
          mv.condition ? `Condition: ${mv.condition}` : null,
          mv.location ? `Location: ${mv.location}` : null,
          typeof mv.estimated_fmv === "number" ? `Fair Market Value: ${formatCurrency(mv.estimated_fmv)}` : null,
          typeof mv.low_estimate === "number" && typeof mv.high_estimate === "number"
            ? `Range: ${formatCurrency(mv.low_estimate)} – ${formatCurrency(mv.high_estimate)}`
            : null,
          `Source: ${mv.source}`,
          `Updated: ${mv.updated_at.slice(0, 10)}`,
        ].filter(Boolean).join("\n"),
        500,
      ),
      confidence: 0.91,
      accessClass: "crm_context",
    });
  }

  // ── 10. Process auction results ───────────────────────────────────────
  const auctionRows = ((auctionResult.data ?? []) as AuctionResultRow[]).slice(0, 5);
  if (auctionRows.length > 0) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `auction-results:${auctionRows.map((a) => a.id).join(",")}`,
      sourceTitle: `Auction Comps: ${[auctionRows[0].make, auctionRows[0].model].filter(Boolean).join(" ")}`,
      excerpt: truncateText(
        auctionRows.map((a) =>
          [
            `${a.auction_date}: ${[a.year, a.make, a.model].filter(Boolean).join(" ")}`,
            `Hammer: ${formatCurrency(a.hammer_price)}`,
            a.hours ? `${a.hours}hrs` : null,
            a.condition ?? null,
            a.location ?? null,
          ].filter(Boolean).join(" | "),
        ).join("\n"),
        600,
      ),
      confidence: 0.89,
      accessClass: "crm_context",
    });
  }

  // ── 11. Process competitor listings ───────────────────────────────────
  const competitorRows = ((competitorResult.data ?? []) as CompetitorListingRow[]).slice(0, 5);
  if (competitorRows.length > 0) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `competitor-listings:${competitorRows.map((c) => c.id).join(",")}`,
      sourceTitle: `Competitor Inventory: ${[competitorRows[0].make, competitorRows[0].model].filter(Boolean).join(" ")}`,
      excerpt: truncateText(
        competitorRows.map((c) =>
          [
            `${[c.year, c.make, c.model].filter(Boolean).join(" ")}`,
            typeof c.asking_price === "number" ? `Asking: ${formatCurrency(c.asking_price)}` : null,
            c.hours ? `${c.hours}hrs` : null,
            c.location ?? null,
            `Source: ${c.source}`,
            `Seen: ${c.last_seen_at.slice(0, 10)}`,
          ].filter(Boolean).join(" | "),
        ).join("\n"),
        600,
      ),
      confidence: 0.88,
      accessClass: "crm_context",
    });
  }

  // ── 12. Process customer profiles / DNA ───────────────────────────────
  for (const cp of ((customerProfileResult.data ?? []) as CustomerProfileExtRow[]).slice(0, 3)) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `customer-profile:${cp.id}`,
      sourceTitle: `Customer DNA: ${cp.customer_name}`,
      excerpt: truncateText(
        [
          `Customer: ${cp.customer_name}`,
          cp.company_name ? `Company: ${cp.company_name}` : null,
          cp.industry ? `Industry: ${cp.industry}` : null,
          cp.region ? `Region: ${cp.region}` : null,
          cp.pricing_persona ? `Pricing persona: ${cp.pricing_persona}` : null,
          typeof cp.lifetime_value === "number" ? `Lifetime value: ${formatCurrency(cp.lifetime_value)}` : null,
          typeof cp.total_deals === "number" ? `Total deals: ${cp.total_deals}` : null,
          typeof cp.avg_deal_size === "number" ? `Avg deal size: ${formatCurrency(cp.avg_deal_size)}` : null,
          typeof cp.avg_discount_pct === "number" ? `Avg discount: ${cp.avg_discount_pct}%` : null,
          typeof cp.fleet_size === "number" ? `Fleet size: ${cp.fleet_size}` : null,
          cp.seasonal_pattern ? `Seasonal pattern: ${cp.seasonal_pattern}` : null,
          typeof cp.price_sensitivity_score === "number" ? `Price sensitivity: ${cp.price_sensitivity_score}` : null,
          cp.notes ? `Notes: ${truncateText(cp.notes, 200)}` : null,
        ].filter(Boolean).join("\n"),
        600,
      ),
      confidence: 0.93,
      accessClass: "crm_context",
    });
  }

  // ── 13. Process fleet intelligence ────────────────────────────────────
  const fleetRows = ((fleetResult.data ?? []) as FleetIntelligenceRow[]).slice(0, 5);
  if (fleetRows.length > 0) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `fleet-intelligence:${fleetRows.map((f) => f.id).join(",")}`,
      sourceTitle: `Fleet Records: ${fleetRows[0].customer_name}`,
      excerpt: truncateText(
        fleetRows.map((f) =>
          [
            `${f.customer_name}: ${[f.year, f.make, f.model].filter(Boolean).join(" ")}`,
            f.equipment_serial ? `Serial: ${f.equipment_serial}` : null,
            f.current_hours ? `Hours: ${f.current_hours}` : null,
            f.utilization_trend ? `Trend: ${f.utilization_trend}` : null,
            f.predicted_replacement_date ? `Predicted replacement: ${f.predicted_replacement_date}` : null,
            typeof f.outreach_deal_value === "number" ? `Opportunity: ${formatCurrency(f.outreach_deal_value)}` : null,
            f.outreach_status ? `Outreach: ${f.outreach_status}` : null,
          ].filter(Boolean).join(" | "),
        ).join("\n"),
        600,
      ),
      confidence: 0.88,
      accessClass: "crm_context",
    });
  }

  // ── 14. Process manufacturer incentives ───────────────────────────────
  const incentiveRows = ((incentiveResult.data ?? []) as ManufacturerIncentiveRow[]).slice(0, 3);
  if (incentiveRows.length > 0) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `incentives:${incentiveRows.map((i) => i.id).join(",")}`,
      sourceTitle: "Manufacturer Incentives",
      excerpt: truncateText(
        incentiveRows.map((inc) =>
          [
            `${inc.oem_name} — ${inc.program_name}`,
            `${inc.discount_type}: ${formatCurrency(inc.discount_value)}`,
            inc.eligibility_criteria ? `Eligibility: ${inc.eligibility_criteria}` : null,
            `Valid: ${inc.start_date}${inc.end_date ? ` to ${inc.end_date}` : " (ongoing)"}`,
          ].filter(Boolean).join(" | "),
        ).join("\n"),
        500,
      ),
      confidence: 0.90,
      accessClass: "crm_context",
    });
  }

  // ── 15. Process financing rates ───────────────────────────────────────
  const financingRows = ((financingResult.data ?? []) as FinancingRateRow[]).slice(0, 5);
  if (financingRows.length > 0) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `financing-rates:${financingRows.map((f) => f.id).join(",")}`,
      sourceTitle: "Financing Options",
      excerpt: truncateText(
        financingRows.map((fr) =>
          [
            `${fr.lender_name} — ${fr.term_months}mo`,
            `Rate: ${fr.rate_pct}%`,
            `Credit: ${fr.credit_tier}`,
            typeof fr.dealer_holdback_pct === "number" ? `Holdback: ${fr.dealer_holdback_pct}%` : null,
            typeof fr.min_amount === "number" && typeof fr.max_amount === "number"
              ? `Range: ${formatCurrency(fr.min_amount)}–${formatCurrency(fr.max_amount)}`
              : null,
          ].filter(Boolean).join(" | "),
        ).join("\n"),
        500,
      ),
      confidence: 0.86,
      accessClass: "crm_context",
    });
  }

  // ── 16. Process outreach queue ────────────────────────────────────────
  const outreachRows = ((outreachResult.data ?? []) as OutreachQueueRow[]).slice(0, 5);
  if (outreachRows.length > 0) {
    pushEvidence({
      sourceType: "crm",
      sourceId: `outreach-queue:${outreachRows.map((o) => o.id).join(",")}`,
      sourceTitle: "Outreach Opportunities",
      excerpt: truncateText(
        outreachRows.map((oq) =>
          [
            `${oq.customer_name}: ${oq.equipment_description}`,
            `Reason: ${oq.trigger_reason}`,
            typeof oq.estimated_deal_value === "number" ? `Est. value: ${formatCurrency(oq.estimated_deal_value)}` : null,
            typeof oq.priority_score === "number" ? `Priority: ${oq.priority_score}` : null,
            `Status: ${oq.status}`,
            oq.notes ? `Notes: ${truncateText(oq.notes, 100)}` : null,
          ].filter(Boolean).join(" | "),
        ).join("\n"),
        600,
      ),
      confidence: 0.87,
      accessClass: "crm_context",
    });
  }

  if (evidence.length > 0) {
    console.info(
      `[chat:${input.traceId}] crm_broad_search matched=${evidence.length} query="${queryText.slice(0, 40)}"`,
    );
  }

  return evidence;
}

Deno.serve(async (req) => {
  const traceId = crypto.randomUUID();
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...ch, "X-Trace-Id": traceId } });
  }

  const adminClient = createAdminClient();

  try {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.userId || !caller.role || !caller.authHeader) {
      return jsonError(traceId, 401, "AUTH_REQUIRED", "Missing or invalid authentication.", ch);
    }

    const callerClient = createCallerClient(caller.authHeader);

    let rateOk = true;
    try {
      rateOk = await enforceRateLimitWithFallback(adminClient, {
        userId: caller.userId,
        endpoint: "chat",
        maxRequests: 10,
        windowSeconds: 60,
      });
    } catch (rateLimitThrown) {
      console.error(`[chat:${traceId}] rate limit enforcement threw`, rateLimitThrown);
      rateOk = true;
    }

    if (!rateOk) {
      return jsonError(
        traceId,
        429,
        "RATE_LIMITED",
        "Rate limit exceeded. Please wait before sending another message.",
        { ...ch, "Retry-After": "60" },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonError(traceId, 400, "INVALID_REQUEST", "Request body must be valid JSON.", ch);
    }

    const rawMessage = body?.message;
    const rawHistory = body?.history;
    const rawContext = body?.context;

    const MAX_MESSAGE_LENGTH = 8000;
    const MAX_HISTORY_ITEMS = 20;
    if (typeof rawMessage !== "string" || rawMessage.length > MAX_MESSAGE_LENGTH || !rawMessage.trim()) {
      return jsonError(traceId, 400, "INVALID_MESSAGE", "Message is required.", ch);
    }

    const validatedHistory: ChatMessage[] = [];
    if (Array.isArray(rawHistory)) {
      for (const item of rawHistory.slice(-MAX_HISTORY_ITEMS)) {
        if (
          item &&
          typeof item === "object" &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.length <= MAX_MESSAGE_LENGTH
        ) {
          validatedHistory.push({ role: item.role, content: item.content });
        }
      }
    }

    const context = parseChatContext(rawContext);
    const workspaceId = parseWorkspaceIdFromAuthHeader(caller.authHeader);
    const retrievalStartedAt = Date.now();
    const embedResult = await embedQuery(rawMessage, traceId);
    const failClosedOnEmbedding = Deno.env.get("CHAT_FAIL_CLOSED_ON_EMBEDDING") === "true";
    if (!embedResult.ok && failClosedOnEmbedding) {
      return jsonError(
        traceId,
        503,
        "EMBEDDING_FAILED",
        "The embedding service is temporarily unavailable. Please try again shortly.",
        ch,
      );
    }
    const embeddingOk = embedResult.ok;
    const queryEmbedding = embedResult.ok ? embedResult.vector : null;
    if (!embeddingOk) {
      console.warn(
        `[chat:${traceId}] embedding_degraded reason=${embedResult.reason} — using keyword/full-text retrieval only`,
      );
    }

    let documentEvidence: EvidenceItem[] = [];
    try {
      documentEvidence = await retrieveDocumentEvidence(adminClient, {
        traceId,
        role: caller.role,
        workspaceId,
        message: rawMessage,
        embedding: queryEmbedding,
      });
    } catch (err) {
      console.error(`[chat:${traceId}] document_retrieval_failed`, err);
      return jsonError(
        traceId,
        503,
        "DOCUMENT_RETRIEVAL_FAILED",
        "The knowledge search service is temporarily unavailable.",
        ch,
      );
    }

    // ID-based QRM retrieval (when frontend provides explicit context IDs)
    let contextCrmEvidence: EvidenceItem[] = [];
    try {
      contextCrmEvidence = await buildCustomerContextEvidence(adminClient, callerClient, {
        traceId,
        role: caller.role,
        context,
      });
    } catch (error) {
      console.error(`[chat:${traceId}] customer context retrieval failed`, error);
    }

    // Broad QRM search: always runs, searches contacts/companies/deals/
    // equipment/activities/voice notes/quotes by message text
    let broadCrmEvidence: EvidenceItem[] = [];
    try {
      broadCrmEvidence = await searchCrmBroadly(callerClient, {
        traceId,
        role: caller.role,
        message: rawMessage,
      });
    } catch (broadErr) {
      console.warn(`[chat:${traceId}] crm_broad_search failed (non-fatal)`, broadErr);
    }

    // Merge and deduplicate QRM evidence (context IDs take priority)
    const seenCrmIds = new Set<string>();
    const crmEvidence: EvidenceItem[] = [];
    for (const item of contextCrmEvidence) {
      seenCrmIds.add(item.sourceId);
      crmEvidence.push(item);
    }
    for (const item of broadCrmEvidence) {
      if (!seenCrmIds.has(item.sourceId)) {
        seenCrmIds.add(item.sourceId);
        crmEvidence.push(item);
      }
    }

    let serviceKnowledgeEvidence: EvidenceItem[] = [];
    try {
      serviceKnowledgeEvidence = await retrieveServiceKnowledgeEvidence(adminClient, {
        traceId,
        context,
        crmEvidence,
        message: rawMessage,
      });
    } catch (serviceKbErr) {
      console.warn(`[chat:${traceId}] service knowledge retrieval failed (non-fatal)`, serviceKbErr);
    }

    const evidence = [...crmEvidence, ...serviceKnowledgeEvidence, ...documentEvidence];
    let contextBlock = evidence.length > 0 ? formatEvidenceBlock(evidence) : null;

    // Phase E: AskIronAdvisor record-context preload.
    //
    // SECURITY: every preload branch MUST verify caller RLS access via
    // callerClient BEFORE any admin-privileged fetch. Without this guard,
    // a rep could pass an equipment_id / service_job_id they don't own and
    // exfiltrate private records via the preload block. (Round-4 audit fix.)
    if (context && (context.equipmentId || context.serviceJobId || context.partsOrderId || context.voiceCaptureId || context.flareReportId)) {
      const preloadParts: string[] = [];

      if (context.equipmentId) {
        try {
          // RLS probe: can the caller read this equipment row?
          const { data: rlsProbe } = await callerClient
            .from("qrm_equipment")
            .select("id")
            .eq("id", context.equipmentId)
            .maybeSingle();
          if (rlsProbe) {
            const { data: asset } = await adminClient.rpc("get_asset_360", { p_equipment_id: context.equipmentId });
            if (asset) {
              preloadParts.push(`### Asset 360 (preloaded by AskIronAdvisor)\n${JSON.stringify(asset, null, 0)}`);
            }
            const equip = (asset as { equipment?: { make?: string; model?: string } } | null)?.equipment;
            if (equip?.make || equip?.model) {
              const { data: kb } = await adminClient.rpc("match_service_knowledge", {
                p_make: equip?.make ?? null,
                p_model: equip?.model ?? null,
                p_fault_code: null,
                p_limit: 5,
              });
              if (Array.isArray(kb) && kb.length > 0) {
                preloadParts.push(`### Service Knowledge Base matches (verified solutions)\n${JSON.stringify(kb, null, 0)}`);
              }
            }
          } else {
            console.warn(`[chat:${traceId}] equipment preload denied by RLS for ${context.equipmentId}`);
          }
        } catch (err) {
          console.warn(`[chat:${traceId}] equipment preload failed:`, err);
        }
      }

      if (context.serviceJobId) {
        try {
          // Use callerClient directly — no admin escalation needed since the
          // row is the one we want to return in the preload anyway. RLS
          // either allows it or returns null.
          const { data: sj } = await callerClient
            .from("service_jobs")
            .select("*")
            .eq("id", context.serviceJobId)
            .maybeSingle();
          if (sj) preloadParts.push(`### Service job (preloaded)\n${JSON.stringify(sj, null, 0)}`);
        } catch { /* swallow */ }
      }

      if (context.partsOrderId) {
        try {
          const { data: po } = await callerClient
            .from("parts_orders")
            .select("*")
            .eq("id", context.partsOrderId)
            .maybeSingle();
          if (po) preloadParts.push(`### Parts order (preloaded)\n${JSON.stringify(po, null, 0)}`);
        } catch { /* swallow */ }
      }

      if (context.voiceCaptureId) {
        try {
          const { data: vc } = await callerClient
            .from("voice_captures")
            .select("*")
            .eq("id", context.voiceCaptureId)
            .maybeSingle();
          if (vc) preloadParts.push(`### Voice capture (preloaded)\n${JSON.stringify(vc, null, 0)}`);
        } catch { /* swallow */ }
      }

      // Wave 6.11 Flare context preload — RLS-gated via callerClient.
      // The flare_reports row is workspace-scoped via flare_workspace_read,
      // so callerClient returning a row means the caller has access.
      if (context.flareReportId) {
        try {
          const { data: flare } = await callerClient
            .from("flare_reports")
            .select("id, severity, status, user_description, route, url, page_title, console_errors, click_trail, route_trail, hypothesis_pattern, ai_severity_recommendation, ai_severity_reasoning, reproducer_steps, browser, os, viewport, created_at, reporter_email, reporter_role")
            .eq("id", context.flareReportId)
            .maybeSingle();
          if (flare) {
            preloadParts.push(`### Flare report (preloaded by AskIronAdvisor)\n${JSON.stringify(flare, null, 0)}`);
          } else {
            console.warn(`[chat:${traceId}] flare preload denied by RLS for ${context.flareReportId}`);
          }
        } catch (err) {
          console.warn(`[chat:${traceId}] flare preload failed:`, err);
        }
      }

      if (preloadParts.length > 0) {
        const preloadBlock = preloadParts.join("\n\n");
        contextBlock = contextBlock ? `${contextBlock}\n\n${preloadBlock}` : preloadBlock;
      }
    }

    console.info(
      `[chat:${traceId}] retrieval_summary embedding_ok=${embeddingOk} documents=${documentEvidence.length} crm_context=${contextCrmEvidence.length} crm_broad=${broadCrmEvidence.length} crm_merged=${crmEvidence.length} service_kb=${serviceKnowledgeEvidence.length} has_context_block=${Boolean(contextBlock)}`,
    );

    const toolInstructions = `
You have tools to query live QRM data AND to take actions on behalf of the user. Use query tools when:
- The pre-loaded evidence above doesn't answer the question fully
- The user asks for specific aggregations (pipeline totals, deals closing this week, etc.)
- The user asks about a specific contact, deal, or equipment not in the evidence
- The user needs current pricing, financing, or competitive intelligence
Prefer the pre-loaded evidence when it already contains the answer.

You can also take QRM ACTIONS when the user explicitly asks you to:
- createFollowUpTask — create tasks/reminders on deals
- logActivity — log notes, calls, emails, or meetings on deals/contacts/companies
- updateDealStage — move a deal to a new pipeline stage
- draftEmail — draft an email to a contact (present as a draft, never claim to send)
- getDealCoaching — provide coaching insights based on historical patterns
- generatePrepSheet — generate pre-meeting customer prep sheets
- getAnomalyAlerts — surface risk alerts (stalling deals, overdue follow-ups)
- getCompetitiveIntelligence — analyze competitor mentions from voice notes
- getVoiceNoteInsights — query voice note intelligence

For write actions (createFollowUpTask, logActivity, updateDealStage): confirm what you did and show the result. For draftEmail: present the draft clearly and tell the user to review it before sending.`;

    const systemPrompt = contextBlock
      ? `You are the QEP USA internal knowledge assistant. You have access to the company's full QRM, equipment fleet, market valuations, auction comps, competitor listings, customer DNA profiles, manufacturer incentives, financing rates, voice field notes, sales documents, and deal history. Answer from the provided evidence and your tools. The evidence has already been filtered to the caller's allowed access. Never speculate about hidden or restricted information.

${contextBlock}
${toolInstructions}

Rules:
- Be concise and direct.
- Cite the source title naturally in the answer when it materially supports the claim.
- Use QRM evidence (contacts, deals, equipment, voice notes, activities) for customer-specific and operational facts.
- Use document evidence for policy, process, and product reference facts.
- Use service knowledge evidence for recurring field fixes, fault-code history, and technician institutional memory.
- Market valuations provide current fair market values — cite the source and date.
- Auction results are historical comps — present as comparable sales data.
- Competitor listings show what rival dealers are offering — present as competitive intelligence.
- Customer DNA profiles describe buying patterns, negotiation style, and price sensitivity — use to contextualize customer questions.
- Fleet intelligence shows customer equipment and replacement predictions — use for proactive opportunity insights.
- Manufacturer incentives are active OEM programs — highlight when relevant to equipment being discussed.
- Financing rates are current lending terms — present specific rates and terms when asked about financing.
- Voice notes contain field observations recorded by sales reps — treat them as firsthand accounts.
- Service knowledge base matches are learned repair patterns — prefer verified fixes when available and label unverified notes clearly.
- If QRM and document evidence conflict, say which source you relied on.
- If the answer is not in your evidence or tools, say "I don't have that information in the accessible QEP knowledge base."`
      : `You are the QEP USA internal knowledge assistant. No pre-loaded evidence was retrieved for this request, but you have tools to query live QRM data. Use your tools to find the information the user is looking for. If you cannot find the answer with your tools either, say "I don't have that information in the accessible QEP knowledge base."
${toolInstructions}`;

    // ── Tool-calling loop: run non-streaming rounds until the model
    //    returns a text response or we hit the max rounds. ─────────────
    const messages: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...validatedHistory.map((h) => ({ role: h.role, content: h.content }) as OpenAIMessage),
      { role: "user", content: rawMessage },
    ];

    let toolRoundsUsed = 0;
    let finalText: string | null = null;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const result = await chatCompletionWithTools({ traceId, messages });

        if (result.toolCalls.length === 0) {
          finalText = result.content;
          break;
        }

        toolRoundsUsed = round + 1;
        console.info(
          `[chat:${traceId}] tool_round=${round + 1} calls=${result.toolCalls.map((tc) => tc.function.name).join(",")}`,
        );

        // Add the assistant's tool-call message to the conversation
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: result.toolCalls,
        });

        // Execute tools and add results
        const toolResults = await executeToolCalls(adminClient, result.toolCalls, traceId);
        for (const tr of toolResults) {
          messages.push(tr);
        }
      }
    } catch (error) {
      console.error(`[chat:${traceId}] model/tool generation failed model=${CHAT_MODEL}`, error);
      return jsonError(
        traceId,
        503,
        "MODEL_UNAVAILABLE",
        "The chat model is temporarily unavailable. Please try again shortly.",
        ch,
      );
    }

    // If the model returned text during tool rounds (no streaming needed),
    // we still stream it out for consistent client behavior.
    // If tool rounds were used, we stream the final answer.
    let openaiStream: Response | null = null;

    if (finalText === null) {
      // Hit max tool rounds — do a final streaming call without tools
      try {
        openaiStream = await openStreamingCompletion({ traceId, messages });
      } catch (error) {
        console.error(`[chat:${traceId}] final stream failed after tools model=${CHAT_MODEL}`, error);
        return jsonError(
          traceId,
          503,
          "MODEL_UNAVAILABLE",
          "The chat model is temporarily unavailable. Please try again shortly.",
          ch,
        );
      }
    } else if (toolRoundsUsed === 0) {
      // No tools invoked — stream the response directly for better UX
      try {
        openaiStream = await openStreamingCompletion({ traceId, messages });
      } catch (error) {
        console.error(`[chat:${traceId}] model generation failed model=${CHAT_MODEL}`, error);
        return jsonError(
          traceId,
          503,
          "MODEL_UNAVAILABLE",
          "The chat model is temporarily unavailable. Please try again shortly.",
          ch,
        );
      }
    }

    console.info(`[chat:${traceId}] tool_rounds_used=${toolRoundsUsed} streaming=${openaiStream !== null} finalText=${finalText !== null}`);

    const sources = buildSourcePayload(evidence);
    const retrievalLatencyMs = Date.now() - retrievalStartedAt;
    const encoder = new TextEncoder();
    const streamMeta = {
      trace_id: traceId,
      retrieval: {
        embedding_ok: embeddingOk,
        embedding_degraded: !embeddingOk,
        document_evidence_count: documentEvidence.length,
        crm_evidence_count: crmEvidence.length,
        service_evidence_count: serviceKnowledgeEvidence.length,
        tool_rounds_used: toolRoundsUsed,
        empty_evidence: evidence.length === 0,
        latency_ms: retrievalLatencyMs,
      },
    };

    try {
      await adminClient.from("retrieval_events").insert({
        workspace_id: workspaceId,
        trace_id: traceId,
        user_id: caller.userId,
        query_text: rawMessage.slice(0, 4000),
        evidence_count: evidence.length,
        top_source_type: evidence[0]?.sourceType ?? null,
        top_confidence: evidence[0]?.confidence ?? null,
        latency_ms: retrievalLatencyMs,
        embedding_ok: embeddingOk,
        tool_rounds_used: toolRoundsUsed,
      });
    } catch (retrievalLogErr) {
      console.warn(`[chat:${traceId}] retrieval event log failed`, retrievalLogErr);
    }

    // Detect knowledge gaps — questions with no supporting evidence
    if (evidence.length === 0 && rawMessage.length > 10) {
      try {
        await adminClient.rpc("log_knowledge_gap", {
          p_workspace_id: workspaceId,
          p_user_id: caller.userId,
          p_question: rawMessage.slice(0, 500),
          p_trace_id: traceId,
        });
      } catch (gapErr) {
        console.error(`[chat:${traceId}] knowledge gap log failed`, gapErr);
      }
    }

    const readable = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ meta: streamMeta })}\n\n`),
        );

        if (finalText !== null && openaiStream === null) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: finalText })}\n\n`),
          );
        } else if (openaiStream) {
          try {
            const reader = openaiStream.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data: ")) continue;
                const payload = trimmed.slice(6);
                if (payload === "[DONE]") continue;
                try {
                  const chunk = JSON.parse(payload);
                  const delta = chunk.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta.length > 0) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`),
                    );
                  }
                } catch {
                  // skip unparseable SSE lines
                }
              }
            }

            if (buffer.trim().startsWith("data: ") && !buffer.includes("[DONE]")) {
              try {
                const payload = buffer.trim().slice(6);
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`),
                  );
                }
              } catch { /* ignore */ }
            }
          } catch (streamError) {
            const errDetail =
              streamError instanceof Error
                ? `${streamError.name}: ${streamError.message}`
                : String(streamError);
            console.error(`[chat:${traceId}] stream error`, errDetail, streamError);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ text: `\n\nSorry, I encountered an error generating a response. Reference: ${traceId}` })}\n\n`,
              ),
            );
          }
        }

        if (sources.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        ...ch,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Trace-Id": traceId,
        "X-QEP-Chat-Revision": CHAT_EDGE_REVISION,
      },
    });
  } catch (error) {
    console.error(`[chat:${traceId}] fatal error`, error);
    return jsonError(
      traceId,
      500,
      "CHAT_INTERNAL_ERROR",
      "Chat encountered an unexpected error.",
      ch,
    );
  }
});
