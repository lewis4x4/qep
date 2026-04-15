// ============================================================
// Edge Function: ai-parts-lookup
// Purpose: AI-powered parts search with federated catalog + RAG results.
// Classifies query type, searches parts_catalog (semantic + FTS hybrid) +
// Knowledge Assistant, merges and ranks results with confidence scores.
//
// Slice 3.1: adds semantic search via match_parts_hybrid RPC. Query is
// embedded ONCE and reused for both KB RAG and parts semantic search.
// ============================================================

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";
import {
  rerankKbEvidence,
  type KbEvidenceRow,
} from "../_shared/kb-retrieval.ts";

// ── Types ───────────────────────────────────────────────────

type QueryType =
  | "part_number"
  | "machine_component"
  | "natural_language"
  | "cross_reference";

type MatchType = "exact" | "semantic" | "fts" | "hybrid" | "cross_ref" | "machine_compat";

interface SearchRequest {
  query: string;
  filters?: {
    manufacturer?: string | null;
    category?: string | null;
    machine_profile_id?: string | null;
  };
  include_cross_references?: boolean;
  limit?: number;
}

interface PartSearchResult {
  part_id: string;
  part_number: string;
  description: string | null;
  manufacturer: string | null;
  category: string | null;
  confidence: number;
  match_type: MatchType;
  cross_references: Array<{
    source: string;
    part_number: string;
    verified: boolean;
  }>;
  frequently_ordered_with: Array<{
    part_number: string;
    description: string;
  }>;
  compatible_machines: string[];
  intellidealer_status: "not_connected";
  notes: string | null;
  source: "catalog" | "rag" | "cross_ref";
}

interface SearchResponse {
  query_type: QueryType;
  machine_identified: {
    id: string;
    manufacturer: string;
    model: string;
  } | null;
  results: PartSearchResult[];
  kb_evidence: Array<{
    source_title: string;
    excerpt: string;
    confidence: number;
    page_number?: number | null;
  }>;
  total_results: number;
  search_time_ms: number;
  degraded: boolean;
  degraded_reason?: string;
  /** Which catalog-search paths ran. Exposed so frontend can show "🧠 Smart match" banner. */
  match_mix: {
    semantic: number;
    fts: number;
    hybrid: number;
    exact: number;
    cross_ref: number;
    machine_compat: number;
  };
}

// ── Circuit Breaker (for embedding + KB RAG) ────────────────
// In serverless each cold start resets counters — the embedding timeout is
// the primary protection. This breaker prevents repeated timeouts within
// a warm instance from hammering the embedding service.

const RAG_CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 minutes
const RAG_FAILURE_THRESHOLD = 3;

let consecutiveRagFailures = 0;
let ragCircuitOpenUntil = 0;

function isRagCircuitOpen(): boolean {
  if (Date.now() < ragCircuitOpenUntil) return true;
  if (consecutiveRagFailures >= RAG_FAILURE_THRESHOLD) {
    ragCircuitOpenUntil = Date.now() + RAG_CIRCUIT_OPEN_MS;
    console.warn(
      `[ai-parts-lookup] RAG circuit opened after ${consecutiveRagFailures} failures — FTS-only for ${RAG_CIRCUIT_OPEN_MS / 1000}s`,
    );
    return true;
  }
  return false;
}

// ── Query Classification ────────────────────────────────────

const PART_NUMBER_PATTERN = /^[A-Z]{2,4}[-_]\d{2,4}[-_][A-Z]{2}[-_]\d{2,4}$/i;
const CROSS_REF_KEYWORDS = [
  "napa",
  "donaldson",
  "baldwin",
  "fleetguard",
  "wix",
  "cat ",
  "caterpillar",
  "aftermarket",
  "cross ref",
  "equivalent",
  "substitute",
  "interchange",
];
const MACHINE_KEYWORDS = [
  "barko",
  "bandit",
  "asv",
  "prinoth",
  "yanmar",
  "serco",
  "shearex",
  "lamtrac",
  "cmi",
];

function classifyQuery(query: string): QueryType {
  const q = query.trim();

  // Direct part number match
  if (PART_NUMBER_PATTERN.test(q)) return "part_number";

  // Standalone part-number-like patterns (alphanumeric with dashes, 6+ chars, no spaces)
  if (/^[A-Z0-9][-A-Z0-9]{5,}$/i.test(q) && !q.includes(" ")) return "part_number";

  const lower = q.toLowerCase();

  if (CROSS_REF_KEYWORDS.some((kw) => lower.includes(kw))) return "cross_reference";

  const hasMachine = MACHINE_KEYWORDS.some((m) => lower.includes(m));
  if (hasMachine) return "machine_component";

  return "natural_language";
}

// ── Embedding (called once per request, reused by semantic + RAG) ──────────

async function embedQueryOnce(query: string): Promise<number[] | null> {
  if (isRagCircuitOpen()) return null;
  try {
    // 5s timeout — embedding typically returns in <500ms
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const embedding = await embedText(query);
    clearTimeout(timeoutId);
    return embedding;
  } catch (err) {
    consecutiveRagFailures++;
    console.error("[ai-parts-lookup] embedding failed:", err);
    return null;
  }
}

// ── Catalog search: exact (part_number) ─────────────────────

async function searchExact(
  supabase: any,
  query: string,
  filters: SearchRequest["filters"],
  limit: number,
): Promise<PartSearchResult[]> {
  const safeQuery = query.replace(/[%_*\\,()]/g, (ch) => `\\${ch}`);
  let q = supabase
    .from("parts_catalog")
    .select("*")
    .or(`part_number.ilike.${safeQuery}%,part_number.ilike.%${safeQuery}%`)
    .is("deleted_at", null)
    .eq("is_active", true)
    .limit(limit);

  if (filters?.manufacturer) q = q.ilike("manufacturer", filters.manufacturer);
  if (filters?.category) q = q.ilike("category", filters.category);

  const { data } = await q;
  const out: PartSearchResult[] = [];
  for (const row of data ?? []) {
    const isExact = row.part_number.toLowerCase() === query.toLowerCase();
    out.push(catalogRowToResult(row, isExact ? 1.0 : 0.85, "exact"));
  }
  return out;
}

// ── Catalog search: cross-reference JSONB ───────────────────

async function searchCrossRef(
  supabase: any,
  query: string,
  filters: SearchRequest["filters"],
  limit: number,
): Promise<PartSearchResult[]> {
  let q = supabase
    .from("parts_catalog")
    .select("*")
    .is("deleted_at", null)
    .eq("is_active", true)
    .limit(200); // scan-ish; cross_refs is JSONB

  if (filters?.manufacturer) q = q.ilike("manufacturer", filters.manufacturer);
  if (filters?.category) q = q.ilike("category", filters.category);

  const { data } = await q;
  const out: PartSearchResult[] = [];
  for (const row of data ?? []) {
    const refs = (row.cross_references ?? []) as Array<{
      part_number?: string;
      verified?: boolean;
    }>;
    const match = refs.find((r) =>
      r.part_number?.toLowerCase().includes(query.toLowerCase()),
    );
    if (match) {
      out.push(catalogRowToResult(row, match.verified ? 0.92 : 0.75, "cross_ref"));
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ── Catalog search: semantic + FTS hybrid via RPC ──────────

async function searchHybrid(
  supabase: any,
  query: string,
  queryEmbedding: number[] | null,
  filters: SearchRequest["filters"],
  limit: number,
): Promise<PartSearchResult[]> {
  // When we have an embedding, use the hybrid RPC (semantic + FTS in one call).
  // When we don't (breaker open / OpenAI down), fall back to FTS-only path.
  if (!queryEmbedding) {
    return searchFtsFallback(supabase, query, filters, limit);
  }

  const vectorLiteral = formatVectorLiteral(queryEmbedding);

  const { data, error } = await supabase.rpc("match_parts_hybrid", {
    p_query_embedding: vectorLiteral,
    p_query_text: query,
    p_workspace: null,
    p_manufacturer: filters?.manufacturer ?? null,
    p_category: filters?.category ?? null,
    p_alpha: 0.6,
    p_match_count: Math.max(limit, 20),
  });

  if (error) {
    console.warn("[ai-parts-lookup] match_parts_hybrid failed:", error.message);
    return searchFtsFallback(supabase, query, filters, limit);
  }

  if (!data || data.length === 0) {
    return searchFtsFallback(supabase, query, filters, limit);
  }

  // Hydrate the missing fields (RPC returns a subset). Batched lookup on part_id.
  const ids = data.map((r: any) => r.part_id);
  const { data: rows } = await supabase
    .from("parts_catalog")
    .select("*")
    .in("id", ids)
    .is("deleted_at", null);

  const rowById = new Map<string, any>();
  for (const r of rows ?? []) rowById.set(r.id, r);

  const out: PartSearchResult[] = [];
  for (const hit of data as any[]) {
    const row = rowById.get(hit.part_id);
    if (!row) continue;
    const hybridScore = Number(hit.hybrid_score) || 0;
    const matchType: MatchType = hit.match_source === "both"
      ? "hybrid"
      : hit.match_source === "semantic"
        ? "semantic"
        : "fts";
    out.push(catalogRowToResult(row, hybridScore, matchType));
    if (out.length >= limit) break;
  }
  return out;
}

async function searchFtsFallback(
  supabase: any,
  query: string,
  filters: SearchRequest["filters"],
  limit: number,
): Promise<PartSearchResult[]> {
  let q = supabase
    .from("parts_catalog")
    .select("*")
    .is("deleted_at", null)
    .eq("is_active", true)
    .textSearch(
      "part_number,description,manufacturer,category",
      query.split(/\s+/).join(" & "),
      { type: "websearch" },
    )
    .limit(limit);

  if (filters?.manufacturer) q = q.ilike("manufacturer", filters.manufacturer);
  if (filters?.category) q = q.ilike("category", filters.category);

  const { data } = await q;
  const out: PartSearchResult[] = [];
  for (const row of data ?? []) {
    out.push(catalogRowToResult(row, 0.65, "fts"));
  }
  return out;
}

function catalogRowToResult(
  row: any,
  confidence: number,
  matchType: MatchType,
): PartSearchResult {
  return {
    part_id: row.id,
    part_number: row.part_number,
    description: row.description,
    manufacturer: row.manufacturer,
    category: row.category,
    confidence: Math.max(0, Math.min(1, confidence)),
    match_type: matchType,
    cross_references: row.cross_references || [],
    frequently_ordered_with: [],
    compatible_machines: row.compatible_machines || [],
    intellidealer_status: "not_connected",
    notes: null,
    source: "catalog",
  };
}

// ── Machine Identification ──────────────────────────────────

async function identifyMachine(
  supabase: any,
  query: string,
): Promise<{ id: string; manufacturer: string; model: string } | null> {
  const words = query.toLowerCase().split(/\s+/);
  const machineWord = words.find((w) =>
    MACHINE_KEYWORDS.some((m) => w.includes(m)),
  );
  if (!machineWord) return null;

  const modelPattern = words.find((w) => /\d/.test(w) && w !== machineWord);

  let q = supabase
    .from("machine_profiles")
    .select("id, manufacturer, model")
    .ilike("manufacturer", `%${machineWord}%`)
    .is("deleted_at", null)
    .limit(1);

  if (modelPattern) q = q.ilike("model", `%${modelPattern}%`);

  const { data } = await q;
  if (data && data.length > 0) {
    return {
      id: data[0].id,
      manufacturer: data[0].manufacturer,
      model: data[0].model,
    };
  }
  return null;
}

// ── KB RAG Search (reuses pre-computed embedding) ──────────

async function searchRag(
  supabase: any,
  query: string,
  queryEmbedding: number[] | null,
  limit: number,
): Promise<{ evidence: KbEvidenceRow[]; parts: PartSearchResult[] }> {
  if (!queryEmbedding) return { evidence: [], parts: [] };
  if (isRagCircuitOpen()) return { evidence: [], parts: [] };

  try {
    const vectorLiteral = formatVectorLiteral(queryEmbedding);

    const { data: chunks } = await supabase.rpc("match_document_chunks", {
      query_embedding: vectorLiteral,
      match_threshold: 0.65,
      match_count: 20,
    });

    if (!chunks || chunks.length === 0) {
      consecutiveRagFailures = 0;
      return { evidence: [], parts: [] };
    }

    const evidenceRows: KbEvidenceRow[] = chunks.map((c: any) => ({
      source_type: "document",
      source_id: c.document_id || c.id,
      source_title: c.title || c.document_title || "Manufacturer Document",
      excerpt: c.content || c.chunk_text || "",
      confidence: c.similarity || 0.5,
      section_title: c.section_title || null,
      page_number: c.page_number || null,
    }));

    const reranked = await rerankKbEvidence(query, evidenceRows, {
      loggerTag: "ai-parts-lookup",
      maxCandidates: 20,
      finalCount: limit,
    });

    consecutiveRagFailures = 0;
    return { evidence: reranked, parts: [] };
  } catch (err) {
    consecutiveRagFailures++;
    console.error("RAG search failed:", err);
    return { evidence: [], parts: [] };
  }
}

// ── Catalog dispatcher ──────────────────────────────────────

async function searchCatalog(
  supabase: any,
  query: string,
  queryType: QueryType,
  queryEmbedding: number[] | null,
  filters: SearchRequest["filters"],
  limit: number,
): Promise<PartSearchResult[]> {
  let primary: PartSearchResult[] = [];

  if (queryType === "part_number") {
    primary = await searchExact(supabase, query, filters, limit);
  } else if (queryType === "cross_reference") {
    primary = await searchCrossRef(supabase, query, filters, limit);
  } else {
    // natural_language / machine_component → semantic + FTS hybrid
    primary = await searchHybrid(supabase, query, queryEmbedding, filters, limit);
  }

  // Supplement with hybrid if primary path returned < limit results
  if (primary.length < limit && queryType !== "natural_language") {
    const existingIds = new Set(primary.map((r) => r.part_id));
    const supplement = await searchHybrid(
      supabase,
      query,
      queryEmbedding,
      filters,
      limit - primary.length,
    );
    for (const s of supplement) {
      if (!existingIds.has(s.part_id)) primary.push(s);
    }
  }

  return primary.slice(0, limit);
}

// ── Main Handler ────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  const { supabase } = auth;
  const startTime = Date.now();

  let body: SearchRequest;
  try {
    body = (await req.json()) as SearchRequest;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  const { query, filters, limit: rawLimit } = body;
  const limit = Math.min(rawLimit ?? 10, 25);

  if (!query || typeof query !== "string") {
    return safeJsonError("query is required", 400, origin);
  }
  if (query.trim().length < 2) {
    return safeJsonError("query must be at least 2 characters", 400, origin);
  }
  if (query.length > 500) {
    return safeJsonError("query must be at most 500 characters", 400, origin);
  }

  const queryText = query.trim();
  const queryType = classifyQuery(queryText);

  // Embed query ONCE (reused by both semantic catalog search and KB RAG)
  const needsEmbedding =
    queryType === "natural_language" || queryType === "machine_component";
  const queryEmbedding = needsEmbedding ? await embedQueryOnce(queryText) : null;

  // Run federated search in parallel
  const [catalogResults, machineId, ragResults] = await Promise.all([
    searchCatalog(supabase, queryText, queryType, queryEmbedding, filters, limit),
    queryType === "machine_component"
      ? identifyMachine(supabase, queryText)
      : Promise.resolve(null),
    needsEmbedding
      ? searchRag(supabase, queryText, queryEmbedding, limit)
      : Promise.resolve({ evidence: [], parts: [] }),
  ]);

  // Machine-compatibility parts (when a machine was identified)
  let machinePartResults: PartSearchResult[] = [];
  if (machineId && filters?.machine_profile_id !== machineId.id) {
    const { data: machineParts } = await supabase
      .from("parts_catalog")
      .select("*")
      .contains("compatible_machines", [machineId.id])
      .is("deleted_at", null)
      .eq("is_active", true)
      .limit(limit);

    if (machineParts) {
      machinePartResults = machineParts.map((row: any) =>
        catalogRowToResult(row, 0.8, "machine_compat"),
      );
    }
  }

  // Merge + dedupe
  const allResults = [...catalogResults, ...machinePartResults, ...ragResults.parts];
  const seen = new Set<string>();
  const deduped: PartSearchResult[] = [];
  for (const r of allResults.sort((a, b) => b.confidence - a.confidence)) {
    const key = r.part_number.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }
  const finalResults = deduped.slice(0, limit);

  const matchMix = {
    semantic: 0,
    fts: 0,
    hybrid: 0,
    exact: 0,
    cross_ref: 0,
    machine_compat: 0,
  };
  for (const r of finalResults) matchMix[r.match_type]++;

  const degraded = isRagCircuitOpen() || (needsEmbedding && queryEmbedding === null);

  // Best-effort log to counter_inquiries (doesn't block response on failure)
  try {
    const primaryMatchType =
      matchMix.hybrid > 0
        ? "hybrid"
        : matchMix.semantic > 0
          ? "semantic"
          : matchMix.exact > 0 || matchMix.cross_ref > 0
            ? "exact"
            : matchMix.fts > 0
              ? "fts"
              : null;
    await supabase.from("counter_inquiries").insert({
      user_id: auth.userId,
      inquiry_type: "lookup",
      query_text: queryText,
      result_parts: finalResults.slice(0, 5).map((r) => r.part_number),
      machine_profile_id: machineId?.id ?? null,
      match_type: primaryMatchType,
      duration_seconds: (Date.now() - startTime) / 1000,
      outcome: finalResults.length > 0 ? "resolved" : "no_results",
    });
  } catch (logErr) {
    console.warn("[ai-parts-lookup] inquiry log failed (non-fatal):", logErr);
  }

  const response: SearchResponse = {
    query_type: queryType,
    machine_identified: machineId,
    results: finalResults,
    kb_evidence: ragResults.evidence.map((e) => ({
      source_title: e.source_title,
      excerpt: e.excerpt,
      confidence: e.confidence,
      page_number: e.page_number,
    })),
    total_results: finalResults.length,
    search_time_ms: Date.now() - startTime,
    degraded,
    ...(degraded
      ? { degraded_reason: "Semantic search unavailable — showing keyword matches" }
      : {}),
    match_mix: matchMix,
  };

  return safeJsonOk(response, origin);
});
