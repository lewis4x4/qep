/**
 * VC-3 live call capture stream.
 *
 * Accepts idempotent ~10s MediaRecorder chunks from customer detail,
 * transcribes each chunk, and finalizes one voice_captures row plus one
 * linked crm_activities call receipt. Gateway JWT verification is disabled;
 * requireServiceUser validates the caller token in-function for ES256 support.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonErrorWithFields,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { enforceRateLimitWithFallback } from "../_shared/rate-limit-fallback.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  audioExtensionFromMimeType,
  canonicalizeAudioMimeType,
} from "../_shared/audio-mime.ts";
import { resolveVoiceCaptureModelConfig } from "../_shared/voice-model-config.ts";
import {
  normalizeVoiceCaptureExtractedDealData,
  writeVoiceCaptureToLocalCrm,
} from "../_shared/voice-capture-crm.ts";
import {
  buildFinalTranscript,
  buildStreamExtractedData,
  type ChunkAction,
  type FinalizeAction,
  findMissingChunkIndexes,
  isDuplicateKeyError,
  normalizeStreamAction,
  type StartAction,
} from "./stream-helpers.ts";

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

type AdminClient = SupabaseClient;

interface StreamSessionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  client_session_id: string;
  company_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  status: "active" | "finalizing" | "finalized" | "failed" | "cancelled";
  started_at: string;
  stopped_at: string | null;
  finalized_at: string | null;
  duration_seconds: number | null;
  expected_chunk_count: number | null;
  transcript: string | null;
  voice_capture_id: string | null;
  crm_activity_id: string | null;
  sync_error: string | null;
  metadata: Record<string, unknown>;
}

interface StreamChunkRow {
  id: string;
  session_id: string;
  chunk_index: number;
  client_chunk_id: string | null;
  transcript: string | null;
  status: "processing" | "done" | "failed" | "skipped";
  audio_storage_path: string | null;
}

function createAdminClient(): AdminClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64(input: string): Uint8Array {
  try {
    const clean = input.replace(/^data:[^;]+;base64,/, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

async function transcribeChunk(
  audio: Uint8Array,
  mimeType: string,
  openaiKey: string,
): Promise<string> {
  const modelConfig = resolveVoiceCaptureModelConfig();
  const canonicalMime = canonicalizeAudioMimeType(mimeType);
  const extension = audioExtensionFromMimeType(canonicalMime);
  const form = new FormData();
  form.append(
    "file",
    new Blob([toArrayBuffer(audio)], { type: canonicalMime }),
    `chunk.${extension}`,
  );
  form.append("model", modelConfig.transcriptionModel);
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`transcribe ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.text()).trim();
}

async function loadSession(
  admin: AdminClient,
  input: {
    sessionId: string;
    clientSessionId: string;
    userId: string;
    workspaceId: string;
  },
): Promise<StreamSessionRow | null> {
  const { data, error } = await admin
    .from("voice_capture_stream_sessions")
    .select("*")
    .eq("id", input.sessionId)
    .eq("client_session_id", input.clientSessionId)
    .eq("user_id", input.userId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as StreamSessionRow | null) ?? null;
}

async function enforceStreamRateLimit(
  admin: AdminClient,
  userId: string,
  action: "control" | "chunk",
): Promise<boolean> {
  return await enforceRateLimitWithFallback(admin, {
    userId,
    endpoint: action === "chunk"
      ? "voice-capture-stream:chunk"
      : "voice-capture-stream:control",
    maxRequests: action === "chunk" ? 30 : 20,
    windowSeconds: 60,
  });
}

async function handleStart(
  admin: AdminClient,
  auth: { supabase: SupabaseClient; userId: string; workspaceId: string },
  action: StartAction,
  origin: string | null,
): Promise<Response> {
  if (!await enforceStreamRateLimit(admin, auth.userId, "control")) {
    return safeJsonError("Rate limit exceeded — slow down.", 429, origin);
  }

  // VC-3 is a customer-record capture surface. Reject optional target IDs
  // until the UI/API explicitly validates company ownership for those paths.
  if (action.contactId || action.dealId) {
    return safeJsonError(
      "live call capture currently supports company targets only",
      400,
      origin,
    );
  }

  const { data: company, error: companyError } = await auth.supabase
    .from("crm_companies")
    .select("id, name")
    .eq("id", action.companyId)
    .eq("workspace_id", auth.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (companyError) return safeJsonError("company_lookup_failed", 500, origin);
  if (!company) {
    return safeJsonError("company not found or access denied", 404, origin);
  }

  const sessionInsert = {
    workspace_id: auth.workspaceId,
    user_id: auth.userId,
    client_session_id: action.clientSessionId,
    company_id: action.companyId,
    contact_id: action.contactId,
    deal_id: action.dealId,
    status: "active",
    metadata: { source: "customer_detail_live_call" },
  };

  let session: StreamSessionRow | null = null;
  const { data: existing, error: existingError } = await admin
    .from("voice_capture_stream_sessions")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .eq("user_id", auth.userId)
    .eq("client_session_id", action.clientSessionId)
    .maybeSingle();
  if (existingError) throw existingError;
  session = existing as StreamSessionRow | null;

  if (session) {
    const targetMatches = session.company_id === action.companyId &&
      (session.contact_id ?? null) === (action.contactId ?? null) &&
      (session.deal_id ?? null) === (action.dealId ?? null);
    if (!targetMatches) {
      return safeJsonError("target_mismatch", 409, origin);
    }
    if (session.status === "cancelled") {
      return safeJsonError(
        "session_cancelled_start_new_client_session",
        409,
        origin,
      );
    }
  }

  if (!session) {
    const { data, error } = await admin
      .from("voice_capture_stream_sessions")
      .insert(sessionInsert)
      .select("*")
      .single();
    if (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const { data: raced, error: racedError } = await admin
        .from("voice_capture_stream_sessions")
        .select("*")
        .eq("workspace_id", auth.workspaceId)
        .eq("user_id", auth.userId)
        .eq("client_session_id", action.clientSessionId)
        .single();
      if (racedError) throw racedError;
      session = raced as StreamSessionRow;
    } else {
      session = data as StreamSessionRow;
    }
  }

  return safeJsonOk(
    {
      session_id: session.id,
      client_session_id: session.client_session_id,
      status: session.status,
      company: { id: company.id, name: company.name },
      capture_id: session.voice_capture_id,
      crm_activity_id: session.crm_activity_id,
    },
    origin,
  );
}

async function findExistingChunk(
  admin: AdminClient,
  sessionId: string,
  chunkIndex: number,
  clientChunkId: string | null,
): Promise<StreamChunkRow | null> {
  const byIndex = await admin
    .from("voice_capture_stream_chunks")
    .select(
      "id, session_id, chunk_index, client_chunk_id, transcript, status, audio_storage_path",
    )
    .eq("session_id", sessionId)
    .eq("chunk_index", chunkIndex)
    .maybeSingle();
  if (byIndex.error) throw byIndex.error;
  if (byIndex.data) return byIndex.data as StreamChunkRow;

  if (!clientChunkId) return null;
  const byClientId = await admin
    .from("voice_capture_stream_chunks")
    .select(
      "id, session_id, chunk_index, client_chunk_id, transcript, status, audio_storage_path",
    )
    .eq("session_id", sessionId)
    .eq("client_chunk_id", clientChunkId)
    .maybeSingle();
  if (byClientId.error) throw byClientId.error;
  return (byClientId.data as StreamChunkRow | null) ?? null;
}

async function handleChunk(
  admin: AdminClient,
  auth: { userId: string; workspaceId: string },
  action: ChunkAction,
  origin: string | null,
): Promise<Response> {
  if (!await enforceStreamRateLimit(admin, auth.userId, "chunk")) {
    return safeJsonError("Rate limit exceeded — slow down.", 429, origin);
  }

  const session = await loadSession(admin, {
    sessionId: action.sessionId,
    clientSessionId: action.clientSessionId,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
  });
  if (!session) {
    return safeJsonError("session not found or access denied", 404, origin);
  }
  if (session.status !== "active") {
    return safeJsonError(`session is ${session.status}`, 409, origin);
  }

  const audio = decodeBase64(action.audioBase64);
  if (audio.length === 0) {
    return safeJsonError("audio decode failed", 400, origin);
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    return safeJsonError("audio chunk too large", 413, origin);
  }

  let chunk: StreamChunkRow | null = null;
  const { data: inserted, error: insertError } = await admin
    .from("voice_capture_stream_chunks")
    .insert({
      session_id: session.id,
      workspace_id: auth.workspaceId,
      user_id: auth.userId,
      client_chunk_id: action.clientChunkId,
      chunk_index: action.chunkIndex,
      mime_type: action.mimeType,
      byte_size: audio.length,
      duration_ms: action.durationMs,
      status: "processing",
      metadata: { source: "customer_detail_live_call" },
    })
    .select(
      "id, session_id, chunk_index, client_chunk_id, transcript, status, audio_storage_path",
    )
    .single();

  if (insertError) {
    if (!isDuplicateKeyError(insertError)) throw insertError;
    chunk = await findExistingChunk(
      admin,
      session.id,
      action.chunkIndex,
      action.clientChunkId,
    );
    if (!chunk) throw insertError;
    if (
      chunk.chunk_index !== action.chunkIndex ||
      (action.clientChunkId && chunk.client_chunk_id &&
        chunk.client_chunk_id !== action.clientChunkId)
    ) {
      return safeJsonError("chunk_id_mismatch", 409, origin);
    }
    if (chunk.status === "done" || chunk.status === "skipped") {
      return safeJsonOk(
        {
          session_id: session.id,
          chunk_index: chunk.chunk_index,
          client_chunk_id: chunk.client_chunk_id,
          status: chunk.status,
          duplicate: true,
          transcript: chunk.transcript ?? "",
        },
        origin,
      );
    }
    if (chunk.status === "processing") {
      return safeJsonOk(
        {
          session_id: session.id,
          chunk_index: chunk.chunk_index,
          client_chunk_id: chunk.client_chunk_id,
          status: "processing",
          duplicate: true,
          transcript: chunk.transcript ?? "",
        },
        origin,
        202,
      );
    }
    const retried = await admin
      .from("voice_capture_stream_chunks")
      .update({
        status: "processing",
        error: null,
        received_at: new Date().toISOString(),
      })
      .eq("id", chunk.id)
      .select(
        "id, session_id, chunk_index, client_chunk_id, transcript, status, audio_storage_path",
      )
      .single();
    if (retried.error) throw retried.error;
    chunk = retried.data as StreamChunkRow;
  } else {
    chunk = inserted as StreamChunkRow;
  }

  const canonicalMime = canonicalizeAudioMimeType(action.mimeType);
  const extension = audioExtensionFromMimeType(canonicalMime);
  const storagePath =
    `${auth.userId}/live-call/${session.id}/${action.chunkIndex}.${extension}`;

  const upload = await admin.storage
    .from("voice-recordings")
    .upload(
      storagePath,
      new Blob([toArrayBuffer(audio)], { type: canonicalMime }),
      {
        contentType: canonicalMime,
        upsert: true,
      },
    );

  if (upload.error) {
    await admin.from("voice_capture_stream_chunks")
      .update({ status: "failed", error: upload.error.message })
      .eq("id", chunk.id);
    return safeJsonError("audio_upload_failed", 500, origin);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    await admin.from("voice_capture_stream_chunks")
      .update({
        status: "failed",
        audio_storage_path: storagePath,
        error: "OPENAI_API_KEY not configured",
      })
      .eq("id", chunk.id);
    return safeJsonError("OPENAI_API_KEY not configured", 503, origin);
  }

  try {
    const transcript = await transcribeChunk(audio, canonicalMime, openaiKey);
    await admin
      .from("voice_capture_stream_chunks")
      .update({
        status: transcript ? "done" : "skipped",
        transcript,
        audio_storage_path: storagePath,
        transcribed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", chunk.id);

    return safeJsonOk(
      {
        session_id: session.id,
        chunk_index: action.chunkIndex,
        client_chunk_id: action.clientChunkId,
        status: transcript ? "done" : "skipped",
        duplicate: false,
        transcript,
      },
      origin,
    );
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : "chunk_transcription_failed";
    await admin.from("voice_capture_stream_chunks")
      .update({
        status: "failed",
        audio_storage_path: storagePath,
        error: message,
      })
      .eq("id", chunk.id);
    throw err;
  }
}

async function handleFinalize(
  admin: AdminClient,
  auth: { userId: string; workspaceId: string },
  action: FinalizeAction,
  origin: string | null,
): Promise<Response> {
  if (!await enforceStreamRateLimit(admin, auth.userId, "control")) {
    return safeJsonError("Rate limit exceeded — slow down.", 429, origin);
  }

  const existingSession = await loadSession(admin, {
    sessionId: action.sessionId,
    clientSessionId: action.clientSessionId,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
  });
  if (!existingSession) {
    return safeJsonError("session not found or access denied", 404, origin);
  }

  if (existingSession.status === "finalized") {
    return safeJsonOk(
      {
        id: existingSession.id,
        capture_id: existingSession.voice_capture_id,
        crm_activity_id: existingSession.crm_activity_id,
        local_crm_saved: Boolean(existingSession.crm_activity_id),
        transcript: existingSession.transcript ?? "",
        duration_seconds: existingSession.duration_seconds ??
          action.durationSeconds ?? 0,
        target_type: existingSession.company_id ? "company" : "unknown",
        target_id: existingSession.company_id,
      },
      origin,
    );
  }

  if (existingSession.status === "finalizing") {
    return safeJsonError("finalization_in_progress", 409, origin);
  }
  if (existingSession.status === "cancelled") {
    return safeJsonError("session_cancelled", 409, origin);
  }

  const moved = await admin
    .from("voice_capture_stream_sessions")
    .update({
      status: "finalizing",
      expected_chunk_count: action.expectedChunkCount,
      duration_seconds: action.durationSeconds,
      stopped_at: new Date().toISOString(),
      sync_error: null,
    })
    .eq("id", existingSession.id)
    .in("status", ["active", "failed"])
    .select("*")
    .maybeSingle();
  if (moved.error) throw moved.error;
  const session = moved.data as StreamSessionRow | null;
  if (!session) return safeJsonError("finalization_in_progress", 409, origin);

  try {
    const { data: chunks, error: chunksError } = await admin
      .from("voice_capture_stream_chunks")
      .select("chunk_index, transcript")
      .eq("session_id", session.id)
      .in("status", ["done", "skipped"])
      .order("chunk_index", { ascending: true });
    if (chunksError) throw chunksError;

    const transcriptChunks = (chunks ?? []) as Array<
      { chunk_index: number; transcript: string | null }
    >;
    const missing = findMissingChunkIndexes(
      action.expectedChunkCount,
      transcriptChunks,
    );
    if (missing.length > 0) {
      await admin.from("voice_capture_stream_sessions")
        .update({
          status: "active",
          sync_error: `missing chunks: ${missing.join(",")}`,
        })
        .eq("id", session.id);
      return safeJsonErrorWithFields("missing_chunks", 409, origin, {
        missing_chunks: missing,
      });
    }

    const transcript = buildFinalTranscript(transcriptChunks);
    if (!transcript) {
      await admin.from("voice_capture_stream_sessions")
        .update({
          status: "failed",
          sync_error: "empty transcript",
          transcript: "",
        })
        .eq("id", session.id);
      return safeJsonError("empty_transcript", 422, origin);
    }

    const finalizedAt = new Date().toISOString();
    const extractedData = buildStreamExtractedData({
      streamSessionId: session.id,
      clientSessionId: session.client_session_id,
      chunkCount: transcriptChunks.length,
      companyId: session.company_id,
      contactId: session.contact_id,
      dealId: session.deal_id,
      finalizedAt,
    });

    const { data: capture, error: captureError } = await admin
      .from("voice_captures")
      .upsert({
        id: session.id,
        user_id: auth.userId,
        workspace_id: auth.workspaceId,
        activity_type: "call",
        audio_storage_path: `${auth.userId}/live-call/${session.id}`,
        duration_seconds: action.durationSeconds,
        transcript,
        extracted_data: extractedData,
        linked_company_id: session.company_id,
        linked_contact_id: session.contact_id,
        linked_deal_id: session.deal_id,
        sync_status: "processing",
        sync_error: null,
      }, { onConflict: "id" })
      .select("id")
      .single();
    if (captureError || !capture) {
      throw captureError ?? new Error("capture_upsert_failed");
    }

    const normalizedExtracted = normalizeVoiceCaptureExtractedDealData(
      extractedData,
    );
    const crmResult = await writeVoiceCaptureToLocalCrm(admin, {
      workspaceId: auth.workspaceId,
      actorUserId: auth.userId,
      captureId: capture.id as string,
      dealId: session.deal_id,
      companyId: session.company_id,
      contactId: session.contact_id,
      occurredAtIso: finalizedAt,
      transcript,
      extracted: normalizedExtracted,
      primaryActivityType: "call",
      primaryActivityKind: "call",
      createFollowUpTask: false,
      primaryActivityMetadata: {
        captureMode: "live_call",
        streamSessionId: session.id,
        clientSessionId: session.client_session_id,
        chunkCount: transcriptChunks.length,
      },
    });

    await admin
      .from("voice_captures")
      .update({
        sync_status: crmResult.saved ? "synced" : "pending",
        linked_company_id: crmResult.companyId,
        linked_contact_id: crmResult.contactId,
        linked_deal_id: crmResult.dealId,
        sync_error: crmResult.saved ? null : "local CRM activity was not saved",
      })
      .eq("id", capture.id);

    await admin
      .from("voice_capture_stream_sessions")
      .update({
        status: "finalized",
        finalized_at: finalizedAt,
        stopped_at: finalizedAt,
        duration_seconds: action.durationSeconds,
        expected_chunk_count: action.expectedChunkCount,
        transcript,
        voice_capture_id: capture.id,
        crm_activity_id: crmResult.noteActivityId,
        sync_error: crmResult.saved ? null : "local CRM activity was not saved",
        metadata: {
          ...(session.metadata ?? {}),
          captureMode: "live_call",
          chunkCount: transcriptChunks.length,
        },
      })
      .eq("id", session.id);

    return safeJsonOk(
      {
        id: session.id,
        capture_id: capture.id,
        crm_activity_id: crmResult.noteActivityId,
        local_crm_saved: crmResult.saved,
        transcript,
        duration_seconds: action.durationSeconds ?? 0,
        target_type: crmResult.companyId
          ? "company"
          : crmResult.dealId
          ? "deal"
          : "contact",
        target_id: crmResult.companyId ?? crmResult.dealId ??
          crmResult.contactId,
        target_display_name: null,
      },
      origin,
    );
  } catch (err) {
    await admin
      .from("voice_capture_stream_sessions")
      .update({
        status: "failed",
        sync_error: err instanceof Error
          ? err.message.slice(0, 500)
          : "finalize_failed",
      })
      .eq("id", session.id);
    throw err;
  }
}

async function handleCancel(
  admin: AdminClient,
  auth: { userId: string; workspaceId: string },
  action: { sessionId: string; clientSessionId: string },
  origin: string | null,
): Promise<Response> {
  if (!await enforceStreamRateLimit(admin, auth.userId, "control")) {
    return safeJsonError("Rate limit exceeded — slow down.", 429, origin);
  }
  const session = await loadSession(admin, {
    sessionId: action.sessionId,
    clientSessionId: action.clientSessionId,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
  });
  if (!session) {
    return safeJsonError("session not found or access denied", 404, origin);
  }
  if (session.status === "finalized") {
    return safeJsonOk({
      status: "finalized",
      capture_id: session.voice_capture_id,
    }, origin);
  }
  await admin
    .from("voice_capture_stream_sessions")
    .update({ status: "cancelled", stopped_at: new Date().toISOString() })
    .eq("id", session.id)
    .neq("status", "finalized");
  return safeJsonOk({ status: "cancelled" }, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("method_not_allowed", 405, origin);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return safeJsonError("invalid_json", 400, origin);
  }

  const normalized = normalizeStreamAction(raw);
  if (!normalized.ok) {
    return safeJsonErrorWithFields(
      normalized.error,
      normalized.status,
      origin,
      normalized.fields ?? {},
    );
  }

  const auth = await requireServiceUser(
    req.headers.get("Authorization"),
    origin,
  );
  if (!auth.ok) return auth.response;
  const admin = createAdminClient();

  try {
    switch (normalized.value.action) {
      case "start":
        return await handleStart(admin, auth, normalized.value, origin);
      case "chunk":
        return await handleChunk(admin, auth, normalized.value, origin);
      case "finalize":
        return await handleFinalize(admin, auth, normalized.value, origin);
      case "cancel":
        return await handleCancel(admin, auth, normalized.value, origin);
    }
  } catch (err) {
    captureEdgeException(err, { fn: "voice-capture-stream", req });
    console.error("[voice-capture-stream] unexpected error", err);
    return safeJsonError(
      err instanceof Error ? err.message : "voice_capture_stream_failed",
      500,
      origin,
    );
  }
});
