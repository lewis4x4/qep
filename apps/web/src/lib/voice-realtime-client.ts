import { supabase } from "@/lib/supabase";

export interface RealtimeTranscriptSession {
  stop(): void;
}

interface StartRealtimeTranscriptInput {
  stream?: MediaStream;
  onDelta(text: string): void;
  onError(error: Error): void;
  signal?: AbortSignal;
}

export type RealtimeSessionPayload = {
  value?: string;
  client_secret?: { value?: string } | string;
  ephemeral_key?: string;
  token?: string;
  model?: string;
  rtc_url?: string;
  sdp_url?: string;
};

type VoiceRealtimeSessionResponse = RealtimeSessionPayload & {
  provider?: string;
  mode?: string;
  transcription_model?: string;
  language?: string;
  session?: RealtimeSessionPayload;
};

export function normalizeRealtimeSessionPayload(
  response: VoiceRealtimeSessionResponse,
): RealtimeSessionPayload {
  const nestedSession = response.session ?? {};
  return {
    ...nestedSession,
    model: nestedSession.model ?? response.model,
    rtc_url: nestedSession.rtc_url ?? response.rtc_url,
    sdp_url: nestedSession.sdp_url ?? response.sdp_url,
    value: nestedSession.value ?? response.value,
    client_secret: nestedSession.client_secret ?? response.client_secret,
    ephemeral_key: nestedSession.ephemeral_key ?? response.ephemeral_key,
    token: nestedSession.token ?? response.token,
  };
}

function getEphemeralToken(payload: RealtimeSessionPayload): string | null {
  if (payload.value) return payload.value;
  if (typeof payload.client_secret === "string") return payload.client_secret;
  if (payload.client_secret?.value) return payload.client_secret.value;
  return payload.ephemeral_key ?? payload.token ?? null;
}

function extractTranscriptDelta(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const eventType = typeof record.type === "string" ? record.type : "";

  // Realtime transcript preview must only append true deltas. Some events carry
  // a full/interim transcript snapshot; appending those snapshots creates the
  // repeated phrase soup users saw while speaking. The final server transcript
  // remains authoritative after processing.
  if (
    eventType.includes("transcript") ||
    eventType.includes("transcription") ||
    eventType.includes("response.audio_transcript")
  ) {
    const delta = record.delta;
    if (typeof delta === "string" && delta.trim()) return delta;
  }

  return null;
}

async function requestRealtimeSession(signal?: AbortSignal): Promise<RealtimeSessionPayload | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-realtime-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ intent: "field-note-transcript-preview" }),
    signal,
  });

  if (!res.ok) return null;
  return normalizeRealtimeSessionPayload((await res.json()) as VoiceRealtimeSessionResponse);
}

export async function startRealtimeTranscript({
  stream,
  onDelta,
  onError,
  signal,
}: StartRealtimeTranscriptInput): Promise<RealtimeTranscriptSession | null> {
  if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") return null;

  let ownedStream: MediaStream | null = null;
  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;

  const cleanup = () => {
    try {
      dataChannel?.close();
    } catch {
      // no-op
    }
    try {
      peerConnection?.close();
    } catch {
      // no-op
    }
    if (ownedStream) {
      ownedStream.getTracks().forEach((track) => track.stop());
    }
    dataChannel = null;
    peerConnection = null;
    ownedStream = null;
  };

  try {
    const payload = await requestRealtimeSession(signal);
    if (signal?.aborted || !payload) return null;

    const ephemeralToken = getEphemeralToken(payload);
    if (!ephemeralToken) return null;

    let audioStream: MediaStream;
    if (stream) {
      audioStream = stream;
    } else {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ownedStream = audioStream;
    }

    peerConnection = new RTCPeerConnection();
    audioStream.getAudioTracks().forEach((track) => peerConnection?.addTrack(track, audioStream));

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onmessage = (message) => {
      try {
        const delta = extractTranscriptDelta(JSON.parse(String(message.data)));
        if (delta) onDelta(delta);
      } catch {
        // Ignore malformed realtime preview events. Final server transcript remains source of truth.
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const realtimeUrl =
      payload.sdp_url ??
      payload.rtc_url ??
      "https://api.openai.com/v1/realtime/calls";

    const sdpResponse = await fetch(realtimeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ephemeralToken}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
      signal,
    });

    if (!sdpResponse.ok) {
      cleanup();
      return null;
    }

    const answer = await sdpResponse.text();
    if (signal?.aborted) {
      cleanup();
      return null;
    }

    await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });

    return {
      stop: cleanup,
    };
  } catch (err) {
    cleanup();
    if (!signal?.aborted) {
      onError(err instanceof Error ? err : new Error("Realtime transcript preview failed"));
    }
    return null;
  }
}
