export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_EMBEDDING_DIMENSIONS = 1536;

interface EmbeddingItem {
  embedding: number[];
  index?: number;
}

function getOpenAiApiKey(): string {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return apiKey;
}

export function formatVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Embedding API error: ${JSON.stringify(payload)}`);
  }

  return (payload.data as EmbeddingItem[])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (!embedding?.length) {
    throw new Error("Embedding API returned an empty vector");
  }
  return embedding;
}
