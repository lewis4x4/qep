// ============================================================
// Edge Function: ai-parts-lookup
// Purpose: AI-powered parts search with federated catalog + RAG results.
// Classifies query type, searches parts_catalog + Knowledge Assistant,
// merges and ranks results with confidence scores.
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
}

// ── Circuit Breaker ─────────────────────────────────────────
// Per-instance breaker with aggressive thresholds. In serverless, each
// cold start resets counters — the embedding timeout (5s) is the primary
// protection. This breaker prevents repeated timeouts within a single
// warm instance from hammering the embedding service.
//
// Threshold is kept low (3) so even short-lived instances trip quickly.
// The 5-minute open window protects warm instances that serve many requests.

const RAG_CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 minutes
const RAG_FAILURE_THRESHOLD = 3;

let consecutiveRagFailures = 0;
let ragCircuitOpenUntil = 0;

function isRagCircuitOpen(): boolean {
  if (Date.now() < ragCircuitOpenUntil) return true;
  if (consecutiveRagFailures >= RAG_FAILURE_THRESHOLD) {
    ragCircuitOpenUntil = Date.now() + RAG_CIRCUIT_OPEN_MS;
    console.warn(
      `[ai-parts-lookup] RAG circuit opened after ${consecutiveRagFailures} failures — catalog-only for ${RAG_CIRCUIT_OPEN_MS / 1000}s`,
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

  // Check for standalone part-number-like patterns (alphanumeric with dashes, 6+ chars)
  if (/^[A-Z0-9][-A-Z0-9]{5,}$/i.test(q) && !q.includes(" "))
    return "part_number";

  const lower = q.toLowerCase();

  // Cross-reference detection
  if (CROSS_REF_KEYWORDS.some((kw) => lower.includes(kw)))
    return "cross_reference";

  // Machine + component detection (contains a machine brand + a part/component term)
  const hasMachine = MACHINE_KEYWORDS.some((m) => lower.includes(m));
  if (hasMachine) return "machine_component";

  // Fallback to natural language
  return "natural_language";
}

// ── Catalog Search ──────────────────────────────────────────

async function searchCatalog(
  supabase: any,
  query: string,
  queryType: QueryType,
  filters: SearchRequest["filters"],
  limit: number,
): Promise<PartSearchResult[]> {
  const results: PartSearchResult[] = [];

  if (queryType === "part_number") {
    // Exact or prefix match on part_number
    // Escape PostgREST special chars in the query to prevent filter injection
    const safeQuery = query.replace(/[%_*\\,()]/g, (ch) => `\\${ch}`);
    const { data } = await supabase
      .from("parts_catalog")
      .select("*")
      .or(`part_number.ilike.${safeQuery}%,part_number.ilike.%${safeQuery}%`)
      .is("deleted_at", null)
      .eq("is_active", true)
      .limit(limit);

    if (data) {
      for (const row of data) {
        results.push(catalogRowToResult(row, row.part_number.toLowerCase() === query.toLowerCase() ? 1.0 : 0.85));
      }
    }
  }

  if (queryType === "cross_reference") {
    // Search cross_references JSONB
    const { data } = await supabase
      .from("parts_catalog")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
      .limit(limit);

    if (data) {
      for (const row of data) {
        const refs = row.cross_references || [];
        const match = refs.find(
          (r: any) =>
            r.part_number?.toLowerCase().includes(query.toLowerCase()),
        );
        if (match) {
          results.push(catalogRowToResult(row, match.verified ? 0.92 : 0.75));
        }
      }
    }
  }

  // Full-text search for all query types (including as supplement)
  if (results.length < limit) {
    const remaining = limit - results.length;
    const existingIds = new Set(results.map((r) => r.part_id));

    const { data } = await supabase
      .from("parts_catalog")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
      .textSearch(
        "part_number,description,manufacturer,category",
        query.split(/\s+/).join(" & "),
        { type: "websearch" },
      )
      .limit(remaining);

    if (data) {
      for (const row of data) {
        if (!existingIds.has(row.id)) {
          results.push(catalogRowToResult(row, 0.65));
        }
      }
    }
  }

  // Apply filters
  return results.filter((r) => {
    if (filters?.manufacturer && r.manufacturer !== filters.manufacturer)
      return false;
    if (filters?.category && r.category !== filters.category) return false;
    return true;
  });
}

function catalogRowToResult(row: any, confidence: number): PartSearchResult {
  return {
    part_id: row.id,
    part_number: row.part_number,
    description: row.description,
    manufacturer: row.manufacturer,
    category: row.category,
    confidence,
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

  // Try to find a model number in the query
  const modelPattern = words.find((w) => /\d/.test(w) && w !== machineWord);

  let q = supabase
    .from("machine_profiles")
    .select("id, manufacturer, model")
    .ilike("manufacturer", `%${machineWord}%`)
    .is("deleted_at", null)
    .limit(1);

  if (modelPattern) {
    q = q.ilike("model", `%${modelPattern}%`);
  }

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

// ── RAG Search ──────────────────────────────────────────────

async function searchRag(
  supabase: any,
  query: string,
  limit: number,
): Promise<{
  evidence: KbEvidenceRow[];
  parts: PartSearchResult[];
}> {
  if (isRagCircuitOpen()) {
    return { evidence: [], parts: [] };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const embedding = await embedText(query);
    clearTimeout(timeoutId);

    const vectorLiteral = formatVectorLiteral(embedding);

    // Vector similarity search on KB chunks
    const { data: chunks } = await supabase.rpc("match_document_chunks", {
      query_embedding: vectorLiteral,
      match_threshold: 0.65,
      match_count: 20,
    });

    if (!chunks || chunks.length === 0) {
      consecutiveRagFailures = 0;
      return { evidence: [], parts: [] };
    }

    // Map chunks to KbEvidenceRow format for reranking
    const evidenceRows: KbEvidenceRow[] = chunks.map((c: any) => ({
      source_type: "document",
      source_id: c.document_id || c.id,
      source_title: c.title || c.document_title || "Manufacturer Document",
      excerpt: c.content || c.chunk_text || "",
      confidence: c.similarity || 0.5,
      section_title: c.section_title || null,
      page_number: c.page_number || null,
    }));

    // Rerank evidence
    const reranked = await rerankKbEvidence(query, evidenceRows, {
      loggerTag: "ai-parts-lookup",
      maxCandidates: 20,
      finalCount: limit,
    });

    consecutiveRagFailures = 0;

    return {
      evidence: reranked,
      parts: [], // Part extraction from KB happens client-side or in future enhancement
    };
  } catch (err) {
    consecutiveRagFailures++;
    console.error("RAG search failed:", err);
    return { evidence: [], parts: [] };
  }
}

// ── Main Handler ────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST")
    return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(
    req.headers.get("Authorization"),
    origin,
  );
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

  // Classify query
  const queryType = classifyQuery(query.trim());

  // Run federated search in parallel
  const [catalogResults, machineId, ragResults] = await Promise.all([
    searchCatalog(supabase, query.trim(), queryType, filters, limit),
    queryType === "machine_component"
      ? identifyMachine(supabase, query.trim())
      : Promise.resolve(null),
    searchRag(supabase, query.trim(), limit),
  ]);

  // If machine identified and we have a machine_profile_id, also search parts for that machine
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
        catalogRowToResult(row, 0.80),
      );
    }
  }

  // Merge and deduplicate results
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

  const degraded = isRagCircuitOpen();

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
      ? { degraded_reason: "AI search temporarily unavailable — showing catalog results" }
      : {}),
  };

  return safeJsonOk(response, origin);
});
