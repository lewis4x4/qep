export type StreamAction =
  | StartAction
  | ChunkAction
  | FinalizeAction
  | CancelAction;

export interface StartAction {
  action: "start";
  clientSessionId: string;
  companyId: string;
  contactId: string | null;
  dealId: string | null;
}

export interface ChunkAction {
  action: "chunk";
  sessionId: string;
  clientSessionId: string;
  clientChunkId: string | null;
  chunkIndex: number;
  audioBase64: string;
  mimeType: string;
  durationMs: number | null;
}

export interface FinalizeAction {
  action: "finalize";
  sessionId: string;
  clientSessionId: string;
  expectedChunkCount: number;
  durationSeconds: number | null;
}

export interface CancelAction {
  action: "cancel";
  sessionId: string;
  clientSessionId: string;
}

export type NormalizedStreamAction =
  | { ok: true; value: StreamAction }
  | {
    ok: false;
    error: string;
    status: number;
    fields?: Record<string, unknown>;
  };

export interface TranscriptChunk {
  chunk_index: number;
  transcript: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "23505";
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

export function normalizeStreamAction(raw: unknown): NormalizedStreamAction {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_json_body", status: 400 };
  }

  const body = raw as Record<string, unknown>;
  const action = text(body.action, 24);
  const clientSessionId = text(body.clientSessionId, 120);

  if (!action || !clientSessionId) {
    return {
      ok: false,
      error: "missing_action_or_client_session",
      status: 400,
    };
  }

  if (action === "start") {
    const companyId = text(body.companyId, 40);
    const contactId = text(body.contactId, 40);
    const dealId = text(body.dealId, 40);
    if (!companyId || !isUuid(companyId)) {
      return { ok: false, error: "invalid_company_id", status: 400 };
    }
    if (contactId && !isUuid(contactId)) {
      return { ok: false, error: "invalid_contact_id", status: 400 };
    }
    if (dealId && !isUuid(dealId)) {
      return { ok: false, error: "invalid_deal_id", status: 400 };
    }
    return {
      ok: true,
      value: { action, clientSessionId, companyId, contactId, dealId },
    };
  }

  const sessionId = text(body.sessionId, 40);
  if (!sessionId || !isUuid(sessionId)) {
    return { ok: false, error: "invalid_session_id", status: 400 };
  }

  if (action === "chunk") {
    const chunkIndex = nonNegativeInteger(body.chunkIndex);
    const audioBase64 = text(body.audioBase64, 8_000_000);
    const mimeType = text(body.mimeType, 120) ?? "audio/webm";
    const durationMs = body.durationMs == null
      ? null
      : nonNegativeInteger(body.durationMs);
    if (chunkIndex == null) {
      return { ok: false, error: "invalid_chunk_index", status: 400 };
    }
    if (!audioBase64 || audioBase64.length < 16) {
      return { ok: false, error: "missing_audio", status: 400 };
    }
    if (body.durationMs != null && durationMs == null) {
      return { ok: false, error: "invalid_duration_ms", status: 400 };
    }
    return {
      ok: true,
      value: {
        action,
        sessionId,
        clientSessionId,
        clientChunkId: text(body.clientChunkId, 120),
        chunkIndex,
        audioBase64,
        mimeType,
        durationMs,
      },
    };
  }

  if (action === "finalize") {
    const expectedChunkCount = nonNegativeInteger(body.expectedChunkCount);
    const durationSeconds = body.durationSeconds == null
      ? null
      : nonNegativeInteger(body.durationSeconds);
    if (expectedChunkCount == null) {
      return { ok: false, error: "invalid_expected_chunk_count", status: 400 };
    }
    if (body.durationSeconds != null && durationSeconds == null) {
      return { ok: false, error: "invalid_duration_seconds", status: 400 };
    }
    return {
      ok: true,
      value: {
        action,
        sessionId,
        clientSessionId,
        expectedChunkCount,
        durationSeconds,
      },
    };
  }

  if (action === "cancel") {
    return { ok: true, value: { action, sessionId, clientSessionId } };
  }

  return { ok: false, error: "unsupported_action", status: 400 };
}

export function findMissingChunkIndexes(
  expectedCount: number,
  chunks: TranscriptChunk[],
): number[] {
  const seen = new Set<number>();
  for (const chunk of chunks) {
    if (Number.isInteger(chunk.chunk_index) && chunk.chunk_index >= 0) {
      seen.add(chunk.chunk_index);
    }
  }
  const missing: number[] = [];
  for (let i = 0; i < expectedCount; i += 1) {
    if (!seen.has(i)) missing.push(i);
  }
  return missing;
}

export function buildFinalTranscript(chunks: TranscriptChunk[]): string {
  const byIndex = new Map<number, string>();
  for (const chunk of chunks) {
    if (!Number.isInteger(chunk.chunk_index) || chunk.chunk_index < 0) continue;
    const transcript = chunk.transcript?.trim();
    if (!transcript || byIndex.has(chunk.chunk_index)) continue;
    byIndex.set(chunk.chunk_index, transcript);
  }
  return [...byIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, transcript]) => transcript)
    .join("\n")
    .trim();
}

export function buildStreamExtractedData(input: {
  streamSessionId: string;
  clientSessionId: string;
  chunkCount: number;
  companyId: string | null;
  contactId?: string | null;
  dealId?: string | null;
  finalizedAt: string;
}): Record<string, unknown> {
  return {
    source: "voice_capture_stream",
    captureMode: "live_call",
    streamSessionId: input.streamSessionId,
    clientSessionId: input.clientSessionId,
    chunkCount: input.chunkCount,
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    dealId: input.dealId ?? null,
    finalizedAt: input.finalizedAt,
  };
}
