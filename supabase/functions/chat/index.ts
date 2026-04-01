import {
  createAdminClient,
  createCallerClient,
  resolveCallerContext,
  type UserRole,
} from "../_shared/dge-auth.ts";
import { enforceRateLimitWithFallback } from "../_shared/rate-limit-fallback.ts";
import { suggestedFollowUpHintLine } from "../_shared/crm-follow-up-suggestions.ts";

/** Bumped when chat edge behavior changes; check response headers to confirm deploy. */
const CHAT_EDGE_REVISION = "20260331-openai-nano-retrieval2";
const CHAT_MODEL = "gpt-5.4-nano";

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
}

interface EvidenceItem {
  sourceType: "document" | "crm";
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
  };

  if (!parsed.customerProfileId && !parsed.contactId && !parsed.companyId && !parsed.dealId) {
    return null;
  }
  return parsed;
}

function formatEvidenceBlock(evidence: EvidenceItem[]): string {
  const grouped = {
    document: evidence.filter((item) => item.sourceType === "document"),
    crm: evidence.filter((item) => item.sourceType === "crm"),
  };

  const sections: string[] = [];
  if (grouped.document.length > 0) {
    sections.push(
      `Document evidence:\n${grouped.document.map((item) => `[${item.sourceTitle}]\n${item.excerpt}`).join("\n\n---\n\n")}`,
    );
  }
  if (grouped.crm.length > 0) {
    sections.push(
      `CRM evidence:\n${grouped.crm.map((item) => `[${item.sourceTitle}]\n${item.excerpt}`).join("\n\n---\n\n")}`,
    );
  }
  return sections.join("\n\n====\n\n");
}

function buildSourcePayload(evidence: EvidenceItem[]): SourcePayload[] {
  const byKey = new Map<string, SourcePayload>();
  for (const item of evidence) {
    const key = `${item.sourceType}:${item.sourceId}`;
    const existing = byKey.get(key);
    const next: SourcePayload = {
      id: item.sourceId,
      title: item.sourceTitle,
      confidence: Math.max(1, Math.round(item.confidence * 100)),
      kind: item.sourceType,
    };
    if (!existing || next.confidence > existing.confidence) {
      byKey.set(key, next);
    }
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

type EmbedQueryResult = { ok: true; vector: number[] } | { ok: false; reason: string };

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

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

function extractOpenAIText(payload: OpenAIChatCompletionResponse): string | null {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((item) => item?.type === "text" || item?.type === "output_text")
      .map((item) => item.text ?? "")
      .join("")
      .trim();
    return text || null;
  }
  return null;
}

async function generateAnswerWithOpenAI(input: {
  traceId: string;
  systemPrompt: string;
  history: ChatMessage[];
  message: string;
}): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: input.systemPrompt },
        ...input.history,
        { role: "user", content: input.message },
      ],
      max_completion_tokens: 1024,
    }),
  });

  const payload = await response.json() as OpenAIChatCompletionResponse;
  if (!response.ok) {
    const detail = payload.error?.message ?? `openai_http_${response.status}`;
    console.error(`[chat:${input.traceId}] openai_generation_failed`, payload);
    throw new Error(detail);
  }

  const text = extractOpenAIText(payload);
  if (!text) {
    throw new Error("empty_model_output");
  }
  return text;
}

async function retrieveDocumentEvidence(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    traceId: string;
    role: UserRole;
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
      sourceType: "document" as const,
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
      match_count: 6,
      semantic_match_threshold: 0.58,
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
      sourceTitle: `CRM Contact: ${[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Contact"}`,
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
      sourceTitle: `CRM Company: ${company.name}`,
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
      sourceTitle: `CRM Deal: ${deal.name}`,
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
        sourceTitle: "CRM Quotes",
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
        sourceTitle: "Recent CRM Activity",
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

    let crmEvidence: EvidenceItem[] = [];
    try {
      crmEvidence = await buildCustomerContextEvidence(adminClient, callerClient, {
        traceId,
        role: caller.role,
        context,
      });
    } catch (error) {
      console.error(`[chat:${traceId}] customer context retrieval failed`, error);
      return jsonError(
        traceId,
        503,
        "CRM_CONTEXT_RETRIEVAL_FAILED",
        "Customer context could not be loaded for this chat.",
        ch,
      );
    }

    const evidence = [...crmEvidence, ...documentEvidence];
    const contextBlock = evidence.length > 0 ? formatEvidenceBlock(evidence) : null;

    console.info(
      `[chat:${traceId}] retrieval_summary embedding_ok=${embeddingOk} documents=${documentEvidence.length} crm=${crmEvidence.length} has_context_block=${Boolean(contextBlock)}`,
    );

    const systemPrompt = contextBlock
      ? `You are the QEP USA internal knowledge assistant. Answer only from the provided evidence. The evidence has already been filtered to the caller's allowed access. Never speculate about hidden or restricted information.

${contextBlock}

Rules:
- Be concise and direct.
- Cite the source title naturally in the answer when it materially supports the claim.
- Use CRM evidence for customer-specific facts and document evidence for policy/process facts.
- If CRM and document evidence conflict, say which source you relied on.
- If the answer is not in the provided evidence, say "I don't have that information in the accessible QEP knowledge base."`
      : `You are the QEP USA internal knowledge assistant. No accessible evidence was retrieved for this request. Tell the user: "I don't have that information in the accessible QEP knowledge base." Do not speculate or imply that restricted information exists.`;

    let answerText: string;
    try {
      answerText = await generateAnswerWithOpenAI({
        traceId,
        systemPrompt,
        history: validatedHistory,
        message: rawMessage,
      });
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

    const sources = buildSourcePayload(evidence);
    const encoder = new TextEncoder();
    const streamMeta = {
      trace_id: traceId,
      retrieval: {
        embedding_ok: embeddingOk,
        embedding_degraded: !embeddingOk,
        document_evidence_count: documentEvidence.length,
        crm_evidence_count: crmEvidence.length,
        empty_evidence: evidence.length === 0,
      },
    };
    const readable = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ meta: streamMeta })}\n\n`),
          );
          if (answerText) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: answerText })}\n\n`),
            );
          }
          if (sources.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
          }
        } catch (streamError) {
          const errDetail =
            streamError instanceof Error
              ? `${streamError.name}: ${streamError.message}`
              : String(streamError);
          console.error(`[chat:${traceId}] stream error`, errDetail, streamError);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ text: `Sorry, I encountered an error generating a response. Reference: ${traceId}` })}\n\n`,
            ),
          );
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
