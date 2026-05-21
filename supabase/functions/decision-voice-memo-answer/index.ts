import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { decryptOneDriveToken } from "../_shared/integration-crypto.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  isGenericAudioMimeType,
  isSupportedAudioMimeType,
  resolveAudioUploadMetadata,
} from "../_shared/audio-mime.ts";
import {
  buildSignedDecisionActionLink,
  resolveDecisionMagicLinkSecret,
} from "../_shared/decision-magic-link.ts";
import {
  buildVoiceMemoCandidatePatch,
  coerceAiExtraction,
  extractDecisionActionDeterministic,
  type VoiceMemoExtraction,
} from "./logic.ts";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const WHISPER_TIMEOUT_MS = 30_000;
const AI_EXTRACTION_TIMEOUT_MS = 15_000;
const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
const DEFAULT_EXTRACT_MODEL = "gpt-4o-mini";
const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_STORAGE_BUCKET = "decision-voice-memos";

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "webm",
  "ogg",
  "mp4",
  "m4a",
  "mp3",
  "wav",
  "aac",
]);
const CONFIRMABLE_STATUSES = new Set(["open", "escalated", "shadow_ship"]);
const DEFAULT_CONFIRMATION_ORIGINS = new Set([
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
]);

type AdminClient = any;

type GraphItemRef = {
  sync_state_id?: string;
  user_id?: string;
  drive_id?: string;
  item_id?: string;
  path?: string;
  name?: string;
};

type RequestBody = {
  decision_id?: string;
  decision_code?: string;
  audio_url?: string;
  storage_bucket?: string;
  storage_path?: string;
  graph_item?: GraphItemRef;
  sync_state_id?: string;
  sender_user_id?: string;
  allow_ai_extraction?: boolean;
  confirmation_base_url?: string;
  action_base_url?: string;
  recipient_email?: string;
  recipient_phone?: string;
};

type DecisionRow = {
  id: string;
  code: string;
  owner_role: string;
  status: string;
  ai_prep_packet: Record<string, unknown> | null;
};

type SyncStateRow = {
  id: string;
  user_id: string | null;
  access_token: string | null;
  token_expires_at: string | null;
};

type AudioPayload = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  source: Record<string, unknown>;
};

class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  const startedAt = Date.now();

  try {
    const serviceCaller = isServiceRoleCaller(req);
    if (!serviceCaller) {
      const auth = await requireServiceUser(
        req.headers.get("Authorization"),
        origin,
      );
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError("Forbidden", 403, origin);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError("Server misconfiguration", 500, origin);
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    if (!body.decision_id && !body.decision_code) {
      return safeJsonError(
        "decision_id or decision_code is required",
        400,
        origin,
      );
    }

    const admin: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const decision = await loadDecision(admin, body);
    if (!decision) return safeJsonError("Decision not found", 404, origin);
    if (!CONFIRMABLE_STATUSES.has(decision.status)) {
      return safeJsonError(
        `Decision status '${decision.status}' is not awaiting confirmation`,
        409,
        origin,
      );
    }

    const audio = await loadAudioPayload(admin, body, serviceCaller);
    const transcription = await transcribeAudio(audio);
    if (!transcription.transcript) {
      return safeJsonError("No speech detected in voice memo", 422, origin);
    }

    const extraction = await extractDecisionAction(
      transcription.transcript,
      body.allow_ai_extraction !== false,
    );
    const createdAt = new Date().toISOString();
    const source = {
      ...audio.source,
      audio_mime: audio.mimeType,
      bytes: audio.bytes.byteLength,
      transcription_model: transcription.model,
      transcription_language: transcription.language,
      transcription_confidence: transcription.confidence,
    };
    const patch = buildVoiceMemoCandidatePatch(decision.ai_prep_packet, {
      transcript: transcription.transcript,
      extraction,
      source,
      createdAt,
    });

    const { error: updateError } = await admin
      .from("qep_decisions")
      .update(patch)
      .eq("id", decision.id);

    if (updateError) {
      return safeJsonError(
        `Failed to store voice memo candidate: ${updateError.message}`,
        500,
        origin,
      );
    }

    const confirmationBaseUrl = resolveConfirmationBaseUrl(body);
    const magicLink = confirmationBaseUrl
      ? await buildCandidateMagicLink(confirmationBaseUrl, decision, extraction)
      : null;
    const smsConfirmation = buildSmsConfirmation(
      body.recipient_phone,
      decision,
      extraction,
      magicLink?.url ?? null,
    );
    const emailConfirmation = buildEmailConfirmation(
      body.recipient_email,
      decision,
      transcription.transcript,
      extraction,
      magicLink?.url ?? null,
    );

    return safeJsonOk({
      ok: true,
      decision_id: decision.id,
      decision_code: decision.code,
      action: extraction.action,
      rationale: extraction.rationale,
      transcript: transcription.transcript,
      confirmation_required: true,
      stored_packet_key: "ai_prep_packet.voice_memo_candidate",
      magic_link: magicLink,
      sms_confirmation: smsConfirmation,
      email_confirmation: emailConfirmation,
      duration_ms: Date.now() - startedAt,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "decision-voice-memo-answer", req });
    if (error instanceof HttpError) {
      return safeJsonError(error.message, error.status, origin);
    }
    return safeJsonError(
      error instanceof Error ? error.message : "Internal error",
      500,
      origin,
    );
  }
});

async function loadDecision(
  admin: AdminClient,
  body: RequestBody,
): Promise<DecisionRow | null> {
  let query = admin
    .from("qep_decisions")
    .select("id, code, owner_role, status, ai_prep_packet")
    .limit(1);

  if (body.decision_id) query = query.eq("id", body.decision_id);
  else query = query.eq("code", body.decision_code);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new HttpError(`Failed to load decision: ${error.message}`, 500);
  }
  return (data as DecisionRow | null) ?? null;
}

async function loadAudioPayload(
  admin: AdminClient,
  body: RequestBody,
  serviceCaller: boolean,
): Promise<AudioPayload> {
  if (body.graph_item) return fetchGraphAudio(admin, body);
  if (body.storage_path) return fetchStorageAudio(admin, body);
  if (body.audio_url) return fetchUrlAudio(body.audio_url, serviceCaller);
  throw new HttpError("Provide graph_item, storage_path, or audio_url", 400);
}

async function fetchGraphAudio(
  admin: AdminClient,
  body: RequestBody,
): Promise<AudioPayload> {
  const item = body.graph_item;
  if (!item) throw new HttpError("graph_item is required", 400);
  if (!item.item_id && !item.path) {
    throw new HttpError(
      "graph_item.item_id or graph_item.path is required",
      400,
    );
  }

  const syncState = await resolveSyncState(admin, body, item);
  if (!syncState?.access_token) {
    throw new HttpError("No usable onedrive_sync_state token found", 400);
  }
  if (
    syncState.token_expires_at &&
    Date.parse(syncState.token_expires_at) <= Date.now()
  ) {
    throw new HttpError("Selected OneDrive access token is expired", 400);
  }

  const accessToken = await decryptOneDriveToken(syncState.access_token);
  const url = buildGraphContentUrl(item);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string };
    };
    throw new HttpError(
      `Microsoft Graph audio read failed (${response.status}): ${
        String(payload.error?.message ?? "unknown error").slice(0, 500)
      }`,
      502,
    );
  }

  const fileName = item.name ?? graphFileName(item) ??
    parseContentDispositionFileName(
      response.headers.get("content-disposition"),
    ) ?? "decision-voice-memo.webm";
  const bytes = await readLimitedBytes(response);
  return normalizeAudioPayload(
    bytes,
    response.headers.get("content-type"),
    fileName,
    {
      kind: "onedrive_graph_item",
      sync_state_id: syncState.id,
      user_id: syncState.user_id,
      drive_id: item.drive_id ?? null,
      item_id: item.item_id ?? null,
      path: item.path ?? null,
      file_name: fileName,
    },
  );
}

async function fetchStorageAudio(
  admin: AdminClient,
  body: RequestBody,
): Promise<AudioPayload> {
  const allowedBucket = Deno.env.get("DECISION_VOICE_MEMO_BUCKET")?.trim() ||
    DEFAULT_STORAGE_BUCKET;
  const bucket = body.storage_bucket?.trim() || allowedBucket;
  if (bucket !== allowedBucket) {
    throw new HttpError(
      "storage_bucket is not allowed for voice memo answers",
      403,
    );
  }
  const path = body.storage_path?.trim();
  if (!path) throw new HttpError("storage_path is required", 400);

  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error) {
    throw new HttpError(
      `Failed to download audio fixture: ${error.message}`,
      502,
    );
  }
  if (!data) throw new HttpError("Storage audio fixture not found", 404);

  const bytes = await readBlobLimited(data);
  const fileName = path.split("/").pop() || "decision-voice-memo.webm";
  return normalizeAudioPayload(bytes, data.type, fileName, {
    kind: "supabase_storage",
    bucket,
    path,
    file_name: fileName,
  });
}

async function fetchUrlAudio(
  audioUrl: string,
  serviceCaller: boolean,
): Promise<AudioPayload> {
  const url = assertFetchableUrl(audioUrl, serviceCaller);
  const response = await fetch(url.toString(), {
    headers: { Accept: "audio/*,application/octet-stream;q=0.8" },
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new HttpError(`Audio URL fetch failed (${response.status})`, 502);
  }

  const fileName = parseContentDispositionFileName(
    response.headers.get("content-disposition"),
  ) ??
    url.pathname.split("/").pop() ??
    "decision-voice-memo.webm";
  const bytes = await readLimitedBytes(response);
  return normalizeAudioPayload(
    bytes,
    response.headers.get("content-type"),
    fileName,
    {
      kind: "audio_url",
      url: redactUrl(url),
      file_name: fileName,
    },
  );
}

async function resolveSyncState(
  admin: AdminClient,
  body: RequestBody,
  item: GraphItemRef,
): Promise<SyncStateRow | null> {
  let query = admin
    .from("onedrive_sync_state")
    .select("id, user_id, access_token, token_expires_at")
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  const syncStateId = item.sync_state_id ?? body.sync_state_id;
  const userId = item.user_id ?? body.sender_user_id;
  if (!syncStateId && !userId) {
    throw new HttpError(
      "graph_item requires sync_state_id or user_id/sender_user_id",
      400,
    );
  }
  if (syncStateId) query = query.eq("id", syncStateId);
  else query = query.eq("user_id", userId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new HttpError(
      `Failed to load onedrive_sync_state: ${error.message}`,
      500,
    );
  }
  return (data as SyncStateRow | null) ?? null;
}

function buildGraphContentUrl(item: GraphItemRef): string {
  if (item.item_id && item.drive_id) {
    return `${GRAPH_BASE_URL}/drives/${
      encodeURIComponent(item.drive_id)
    }/items/${encodeURIComponent(item.item_id)}/content`;
  }
  if (item.item_id) {
    return `${GRAPH_BASE_URL}/me/drive/items/${
      encodeURIComponent(item.item_id)
    }/content`;
  }
  const cleanPath = (item.path ?? "").replace(/^\/+/, "");
  const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
  return `${GRAPH_BASE_URL}/me/drive/root:/${encodedPath}:/content`;
}

async function readLimitedBytes(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) {
    throw new HttpError(
      `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB)`,
      413,
    );
  }
  if (!response.body) return readBlobLimited(await response.blob());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(
        `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB)`,
        413,
      );
    }
    chunks.push(value);
  }
  if (total === 0) throw new HttpError("audio file is empty", 400);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBlobLimited(blob: Blob): Promise<Uint8Array> {
  if (blob.size === 0) throw new HttpError("audio file is empty", 400);
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new HttpError(
      `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB)`,
      413,
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) throw new HttpError("audio file is empty", 400);
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new HttpError(
      `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB)`,
      413,
    );
  }
  return bytes;
}

function normalizeAudioPayload(
  bytes: Uint8Array,
  declaredMimeType: string | null | undefined,
  fileName: string,
  source: Record<string, unknown>,
): AudioPayload {
  const metadata = resolveAudioUploadMetadata(
    declaredMimeType,
    fileName,
    bytes,
  );
  const declaredBase =
    (declaredMimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const declaredSupported = declaredBase.length > 0 &&
    isSupportedAudioMimeType(declaredBase);
  const hasAudioExtension = hasSupportedAudioExtension(fileName);

  if (!isSupportedAudioMimeType(metadata.mimeType)) {
    throw new HttpError(
      `Unsupported audio MIME type: ${metadata.mimeType}`,
      415,
    );
  }
  if (
    !metadata.detectedMimeType && !declaredSupported && !hasAudioExtension &&
    isGenericAudioMimeType(declaredBase)
  ) {
    throw new HttpError("Audio MIME type could not be verified", 415);
  }

  return {
    bytes,
    mimeType: metadata.mimeType,
    fileName,
    source: {
      ...source,
      declared_mime: metadata.declaredMimeType,
      detected_mime: metadata.detectedMimeType,
    },
  };
}

async function transcribeAudio(audio: AudioPayload): Promise<{
  transcript: string;
  confidence: number;
  language: string;
  model: string;
}> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ??
    "";
  if (!apiKey) throw new HttpError("OpenAI key not configured", 500);

  const model = Deno.env.get("DECISION_VOICE_TRANSCRIBE_MODEL")?.trim() ||
    DEFAULT_TRANSCRIBE_MODEL;
  const form = new FormData();
  const audioBuffer = audio.bytes.buffer.slice(
    audio.bytes.byteOffset,
    audio.bytes.byteOffset + audio.bytes.byteLength,
  ) as ArrayBuffer;
  form.append(
    "file",
    new Blob([audioBuffer], { type: audio.mimeType }),
    audio.fileName || "decision-voice-memo.webm",
  );
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("language", "en");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(
      `whisper ${response.status}: ${text.slice(0, 200)}`,
      502,
    );
  }

  const data = await response.json().catch(() => null) as
    | Record<string, unknown>
    | null;
  if (!data) throw new HttpError("whisper returned non-json", 502);

  return {
    transcript: String(data.text ?? "").trim(),
    confidence: whisperConfidence(data),
    language: typeof data.language === "string" ? data.language : "en",
    model,
  };
}

async function extractDecisionAction(
  transcript: string,
  allowAiExtraction: boolean,
): Promise<VoiceMemoExtraction> {
  const deterministic = extractDecisionActionDeterministic(transcript);
  if (deterministic.method !== "fallback_need_info" || !allowAiExtraction) {
    return deterministic;
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ??
    "";
  if (!apiKey) return deterministic;

  const model = Deno.env.get("DECISION_VOICE_EXTRACT_MODEL")?.trim() ||
    DEFAULT_EXTRACT_MODEL;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract the owner's tentative decision action from a voice memo. Return JSON only with action approve|block|need_info, rationale, and confidence 0..1. If the memo is ambiguous, use need_info.",
        },
        { role: "user", content: transcript.slice(0, 6000) },
      ],
    }),
    signal: AbortSignal.timeout(AI_EXTRACTION_TIMEOUT_MS),
  });

  if (!response.ok) return deterministic;
  const payload = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) return deterministic;

  try {
    return coerceAiExtraction(JSON.parse(content), deterministic);
  } catch {
    return deterministic;
  }
}

async function buildCandidateMagicLink(
  baseUrl: string,
  decision: DecisionRow,
  extraction: VoiceMemoExtraction,
): Promise<{ url: string; token: string; exp: number; action: string }> {
  const secret = resolveDecisionMagicLinkSecret();
  const link = await buildSignedDecisionActionLink(
    baseUrl,
    {
      decision_id: decision.id,
      decision_code: decision.code,
      action: extraction.action,
      owner_role: decision.owner_role,
      nonce: crypto.randomUUID(),
    },
    secret,
    60 * 60 * 24,
  );
  return { ...link, action: extraction.action };
}

function buildSmsConfirmation(
  recipientPhone: string | undefined,
  decision: DecisionRow,
  extraction: VoiceMemoExtraction,
  magicLinkUrl: string | null,
): { to: string | null; body: string; dry_run: true } {
  const prefix =
    `QEP ${decision.code}: voice memo read as ${extraction.action}. Reply/confirm before it is applied.`;
  return {
    to: recipientPhone?.trim() || null,
    body: magicLinkUrl
      ? `${prefix} ${magicLinkUrl}`
      : `${prefix} Rationale: ${extraction.rationale}`,
    dry_run: true,
  };
}

function buildEmailConfirmation(
  recipientEmail: string | undefined,
  decision: DecisionRow,
  transcript: string,
  extraction: VoiceMemoExtraction,
  magicLinkUrl: string | null,
): {
  to: string | null;
  subject: string;
  text: string;
  html: string;
  dry_run: true;
} {
  const subject = `Confirm QEP decision ${decision.code}: ${extraction.action}`;
  const text = [
    `Voice memo was interpreted as: ${extraction.action}`,
    `Rationale: ${extraction.rationale}`,
    magicLinkUrl
      ? `Confirm: ${magicLinkUrl}`
      : "No magic link was generated; confirm from the Decision Inbox.",
    "",
    "Transcript:",
    transcript,
  ].join("\n");
  const html =
    `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;">
    <h2>Confirm QEP decision ${escapeHtml(decision.code)}</h2>
    <p><strong>Voice memo action:</strong> ${escapeHtml(extraction.action)}</p>
    <p><strong>Rationale:</strong> ${escapeHtml(extraction.rationale)}</p>
    ${
      magicLinkUrl
        ? `<p><a href="${escapeHtml(magicLinkUrl)}">Confirm ${
          escapeHtml(extraction.action)
        }</a></p>`
        : "<p>Confirm from the Decision Inbox.</p>"
    }
    <h3>Transcript</h3><p>${escapeHtml(transcript)}</p>
  </body></html>`;
  return {
    to: recipientEmail?.trim() || null,
    subject,
    text,
    html,
    dry_run: true,
  };
}

function whisperConfidence(data: Record<string, unknown>): number {
  let confidence = 0.85;
  const segments = data.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    let logprobSum = 0;
    let count = 0;
    for (const seg of segments) {
      if (
        seg && typeof seg === "object" &&
        typeof (seg as Record<string, unknown>).avg_logprob === "number"
      ) {
        logprobSum += (seg as Record<string, number>).avg_logprob;
        count++;
      }
    }
    if (count > 0) {
      confidence = Math.max(0, Math.min(1, 1 + (logprobSum / count) / 0.5));
    }
  }
  return confidence;
}

function assertFetchableUrl(value: string, serviceCaller: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError("audio_url must be a valid URL", 400);
  }
  if (url.protocol !== "https:") {
    throw new HttpError("audio_url must be https", 400);
  }
  if (isBlockedHost(url.hostname)) {
    throw new HttpError("audio_url host is not allowed", 400);
  }

  const allowedHosts = parseCsvEnv("DECISION_VOICE_AUDIO_URL_ALLOWED_HOSTS");
  if (!serviceCaller && !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new HttpError("audio_url host is not allowlisted", 403);
  }
  return url;
}

function resolveConfirmationBaseUrl(body: RequestBody): string {
  const requested = body.confirmation_base_url?.trim() ??
    body.action_base_url?.trim() ?? "";
  const envBase = Deno.env.get("DECISION_MAGIC_LINK_BASE_URL")?.trim() ?? "";
  const baseUrl = requested || envBase;
  if (!baseUrl) return "";

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HttpError("confirmation_base_url must be a valid URL", 400);
  }

  const allowedOrigins = new Set(DEFAULT_CONFIRMATION_ORIGINS);
  if (envBase) allowedOrigins.add(new URL(envBase).origin);
  for (const origin of parseCsvEnv("DECISION_MAGIC_LINK_ALLOWED_ORIGINS")) {
    allowedOrigins.add(origin);
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new HttpError("confirmation_base_url origin is not allowed", 403);
  }
  return url.toString();
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0" || host === "::1") return true;
  if (host === "metadata.google.internal") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  if (/^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,2})\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  const cgnat = host.match(/^100\.(\d{1,2})\./);
  if (cgnat) {
    const second = Number(cgnat[1]);
    if (second >= 64 && second <= 127) return true;
  }
  return false;
}

function parseCsvEnv(name: string): Set<string> {
  return new Set(
    (Deno.env.get(name) ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hasSupportedAudioExtension(fileName: string): boolean {
  const ext = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext);
}

function graphFileName(item: GraphItemRef): string | null {
  if (item.name?.trim()) return item.name.trim();
  if (!item.path) return null;
  return item.path.split("/").filter(Boolean).pop() ?? null;
}

function parseContentDispositionFileName(value: string | null): string | null {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) return decodeURIComponent(utf8.replaceAll('"', ""));
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function redactUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
