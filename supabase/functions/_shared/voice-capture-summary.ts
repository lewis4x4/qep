import type { VoiceCaptureExtractedDealData } from "./voice-capture-crm.ts";

const MIN_SUMMARY_BULLETS = 5;
const MAX_SUMMARY_BULLETS = 8;
const MAX_BULLET_LENGTH = 160;

export interface VoiceCaptureSummaryInput {
  transcript: string;
  extracted?: VoiceCaptureExtractedDealData | null;
  openAiKey: string | null | undefined;
  model: string;
  timeoutMs?: number;
}

export interface VoiceCaptureSummaryResult {
  bullets: string[] | null;
  error: string | null;
}

export function normalizeVoiceCaptureSummaryBullets(raw: unknown): string[] | null {
  let candidate = raw;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed) as unknown;
    } catch {
      candidate = [trimmed];
    }
  }

  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    candidate = (candidate as { bullets?: unknown }).bullets;
  }

  if (!Array.isArray(candidate)) return null;

  const seen = new Set<string>();
  const bullets: string[] = [];

  for (const item of candidate) {
    if (typeof item !== "string") continue;
    const normalized = item
      .replace(/^\s*(?:[-*•‣–—]|\d+[.)])\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) continue;

    const dedupeKey = normalized.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    bullets.push(
      normalized.length > MAX_BULLET_LENGTH
        ? `${normalized.slice(0, MAX_BULLET_LENGTH - 1).trimEnd()}…`
        : normalized,
    );
    if (bullets.length >= MAX_SUMMARY_BULLETS) break;
  }

  return bullets.length >= MIN_SUMMARY_BULLETS ? bullets : null;
}

export async function generateVoiceCaptureSummaryBullets(
  input: VoiceCaptureSummaryInput,
): Promise<VoiceCaptureSummaryResult> {
  const transcript = input.transcript.trim();
  if (!transcript) return { bullets: null, error: "empty transcript" };
  if (!input.openAiKey?.trim()) return { bullets: null, error: "OPENAI_API_KEY is not configured" };
  if (!input.model?.trim()) return { bullets: null, error: "summary model is not configured" };

  const extractedContext = input.extracted
    ? JSON.stringify({
      record: input.extracted.record,
      opportunity: input.extracted.opportunity,
      operations: input.extracted.operations,
      guidance: input.extracted.guidance,
    })
    : "null";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Summarize dealership sales voice captures. Return JSON only, never markdown. Do not invent facts.",
          },
          {
            role: "user",
            content: `Create 5-8 short, specific bullets for a sales rep reviewing this field note. Focus on customer/company, equipment, deal stage, urgency/timeline, budget/financing, objections/concerns, next steps, and manager attention only when grounded. Avoid generic filler.\n\nTranscript:\n\"\"\"\n${transcript}\n\"\"\"\n\nExtracted context:\n${extractedContext}\n\nReturn exactly this JSON shape: {"bullets":["..."]}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { bullets: null, error: `summary API error ${res.status}: ${body.slice(0, 300)}` };
    }

    const data = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const rawContent = data?.choices?.[0]?.message?.content?.trim();
    if (!rawContent) return { bullets: null, error: "summary API returned no content" };

    const cleaned = rawContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as unknown;
    const bullets = normalizeVoiceCaptureSummaryBullets(parsed);
    if (!bullets) return { bullets: null, error: "summary did not contain 5-8 valid bullets" };

    return { bullets, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { bullets: null, error: message };
  }
}
