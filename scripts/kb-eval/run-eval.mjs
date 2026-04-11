#!/usr/bin/env node

import "../instrument.mjs";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";
import { bootstrapLiveCorpus } from "./bootstrap-live-corpus.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
loadLocalEnv(repoRoot);
const outputDir = join(repoRoot, "test-results", "kb-eval");
const queriesPath = join(__dirname, "golden-queries.json");
const latestPath = join(outputDir, "latest.json");
const baselinePath = join(outputDir, "baseline.json");

function requiredEnv(name) {
  return process.env[name]?.trim() ?? "";
}

const strictMode =
  requiredEnv("KB_EVAL_REQUIRED") === "true" ||
  requiredEnv("CI") === "true";

function logSkip(reason) {
  if (strictMode) {
    console.error(`kb:eval REQUIRED - ${reason}`);
    process.exit(1);
  }
  console.log(`kb:eval SKIP - ${reason}`);
  process.exit(0);
}

async function embedQuery(message) {
  const openAiKey = requiredEnv("OPENAI_API_KEY");
  if (!openAiKey) return null;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embeddings failed (${response.status})`);
  }

  const payload = await response.json();
  return payload.data?.[0]?.embedding ?? null;
}

function scoreQuery(query, rows) {
  const expectedSourceTypes = query.expected_source_types ?? [];
  const normalizedSourceTypes = rows.map((row) => {
    if (["contact", "company", "deal", "equipment", "activity", "voice_capture"].includes(row.source_type)) {
      return "crm";
    }
    return row.source_type;
  });
  const sourceTypeHit = expectedSourceTypes.length === 0
    ? rows.length === 0
    : normalizedSourceTypes.some((sourceType) => expectedSourceTypes.includes(sourceType));
  const minResultsHit = typeof query.min_results === "number"
    ? rows.length >= query.min_results
    : true;

  return {
    source_type_hit: sourceTypeHit,
    min_results_hit: minResultsHit,
    pass: sourceTypeHit && minResultsHit,
  };
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
  "say",
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

function normalizeSearchText(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simplifyQuestion(message) {
  return message
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
}

function extractSearchTokens(message) {
  const normalized = normalizeSearchText(message);
  const seen = new Set();
  const tokens = [];
  for (const token of normalized.split(" ")) {
    if (token.length < 3 || QUERY_STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function buildKeywordCandidates(message) {
  const candidates = [];
  const raw = message.trim();
  const simplified = simplifyQuestion(raw);
  const tokenPhrase = extractSearchTokens(raw).slice(0, 6).join(" ");
  const identifierCandidates = raw.match(/\b[a-z0-9]{2,}(?:[-/][a-z0-9]{2,})+\b/gi) ?? [];

  for (const candidate of [raw, simplified, tokenPhrase, ...identifierCandidates]) {
    const normalized = candidate?.trim();
    if (!normalized || candidates.includes(normalized)) continue;
    candidates.push(normalized);
  }

  return candidates;
}

const url = requiredEnv("SUPABASE_URL") || requiredEnv("VITE_SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) {
  logSkip("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run live retrieval evals");
}

const queries = JSON.parse(readFileSync(queriesPath, "utf8"))
  .filter((query) => query.enabled !== false);

if (queries.length === 0) {
  logSkip("no enabled golden queries");
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

mkdirSync(outputDir, { recursive: true });

await bootstrapLiveCorpus();

const startedAt = Date.now();
const results = [];

for (const query of queries) {
  const embedding = await embedQuery(query.message);
  let rows = [];
  let lastError = null;
  for (const keywordQuery of buildKeywordCandidates(query.message)) {
    const { data, error } = await supabase.rpc("retrieve_document_evidence", {
      query_embedding: embedding ? `[${embedding.join(",")}]` : null,
      keyword_query: keywordQuery,
      user_role: query.user_role ?? "manager",
      match_count: 8,
      semantic_match_threshold: 0.45,
      p_workspace_id: query.workspace_id ?? "default",
    });

    if (error) {
      lastError = error;
      continue;
    }

    rows = data ?? [];
    if (rows.length > 0) break;
  }

  if (lastError && rows.length === 0) {
    results.push({
      id: query.id,
      message: query.message,
      error: lastError.message,
      pass: false,
      rows: [],
    });
    continue;
  }

  const score = scoreQuery(query, rows);
  results.push({
    id: query.id,
    message: query.message,
    score,
    pass: score.pass,
    rows: rows.slice(0, 5),
  });
}

const summary = {
  total: results.length,
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).length,
  elapsed_ms: Date.now() - startedAt,
};

const payload = {
  generated_at: new Date().toISOString(),
  summary,
  results,
};

writeFileSync(latestPath, JSON.stringify(payload, null, 2));

if (!process.env.KB_EVAL_WRITE_BASELINE && !process.env.CI) {
  if (!process.env.KB_EVAL_NO_BASELINE_NOTE) {
    if (!process.env.KB_EVAL_WRITE_BASELINE && !process.env.CI) {
      console.log(`kb:eval baseline path: ${baselinePath}`);
    }
  }
}

if (process.env.KB_EVAL_WRITE_BASELINE === "true") {
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
  console.log(`kb:eval baseline written -> ${baselinePath}`);
}

console.log(`kb:eval latest -> ${latestPath}`);
console.log(`kb:eval summary: ${summary.passed}/${summary.total} passed`);

if (summary.failed > 0) {
  process.exit(1);
}
