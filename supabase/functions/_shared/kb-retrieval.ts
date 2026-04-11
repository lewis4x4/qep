export interface KbEvidenceRow {
  source_type: string;
  source_id: string;
  source_title: string;
  excerpt: string;
  confidence: number;
  access_class: string | null;
  chunk_kind?: string | null;
  parent_chunk_id?: string | null;
  section_title?: string | null;
  page_number?: number | null;
  context_excerpt?: string | null;
}

interface RerankResponse {
  ranked_ids?: string[];
  scores?: Record<string, number>;
}

const KB_RERANK_MODEL = "gpt-5.4-mini";
const KB_RERANK_TIMEOUT_MS = 20_000;

export function buildEvidenceContextLabel(row: Pick<KbEvidenceRow, "section_title" | "page_number">): string | null {
  const parts: string[] = [];
  if (row.section_title) parts.push(`Section: ${row.section_title}`);
  if (typeof row.page_number === "number") parts.push(`Page: ${row.page_number}`);
  return parts.length > 0 ? parts.join(" | ") : null;
}

export function buildEvidenceExcerpt(row: Pick<KbEvidenceRow, "excerpt" | "context_excerpt" | "section_title" | "page_number">): string {
  const label = buildEvidenceContextLabel(row);
  const parts = [
    label,
    row.excerpt?.trim() || "",
    row.context_excerpt?.trim() ? `Context: ${row.context_excerpt.trim()}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join("\n");
}

export async function rerankKbEvidence<T extends KbEvidenceRow>(
  query: string,
  rows: T[],
  options: {
    loggerTag: string;
    maxCandidates?: number;
    finalCount?: number;
  },
): Promise<T[]> {
  const finalCount = Math.max(1, options.finalCount ?? 6);
  const candidates = rows.slice(0, Math.max(1, options.maxCandidates ?? 12));
  if (candidates.length <= 1) return rows.slice(0, finalCount);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return rows.slice(0, finalCount);

  const indexed = candidates.map((row, index) => ({
    row,
    candidate_id: `c${index + 1}`,
    index,
  }));

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: KB_RERANK_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Rank the candidate evidence strictly by how well it answers the query. Return JSON with ranked_ids and scores only. Do not include any ids not provided.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query,
              candidates: indexed.map((item) => ({
                candidate_id: item.candidate_id,
                source_type: item.row.source_type,
                source_title: item.row.source_title,
                excerpt: item.row.excerpt,
                context_excerpt: item.row.context_excerpt ?? null,
                section_title: item.row.section_title ?? null,
                page_number: item.row.page_number ?? null,
                initial_confidence: item.row.confidence,
              })),
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(KB_RERANK_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[${options.loggerTag}] kb rerank skipped status=${response.status}`);
      return rows.slice(0, finalCount);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      console.warn(`[${options.loggerTag}] kb rerank skipped empty-content`);
      return rows.slice(0, finalCount);
    }

    const parsed = JSON.parse(content) as RerankResponse;
    const rankedIds = Array.isArray(parsed.ranked_ids) ? parsed.ranked_ids : [];
    if (rankedIds.length === 0) {
      console.warn(`[${options.loggerTag}] kb rerank skipped missing-ranked-ids`);
      return rows.slice(0, finalCount);
    }

    const scoreById = new Map(
      Object.entries(parsed.scores ?? {})
        .filter(([, score]) => Number.isFinite(score))
        .map(([id, score]) => [id, Number(score)]),
    );
    const orderById = new Map(rankedIds.map((id, index) => [id, index]));

    return indexed
      .sort((left, right) => {
        const leftRank = orderById.get(left.candidate_id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = orderById.get(right.candidate_id) ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;

        const leftScore = scoreById.get(left.candidate_id) ?? left.row.confidence;
        const rightScore = scoreById.get(right.candidate_id) ?? right.row.confidence;
        if (leftScore !== rightScore) return rightScore - leftScore;

        if (left.row.confidence !== right.row.confidence) return right.row.confidence - left.row.confidence;
        return left.index - right.index;
      })
      .map((item) => item.row)
      .slice(0, finalCount);
  } catch (error) {
    console.warn(
      `[${options.loggerTag}] kb rerank fallback`,
      error instanceof Error ? error.message : String(error),
    );
    return rows.slice(0, finalCount);
  }
}
