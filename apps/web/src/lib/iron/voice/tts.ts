/**
 * Wave 7 Iron Companion v1.2 — text-to-speech client.
 *
 * Bypasses supabase.functions.invoke (which auto-parses JSON) because
 * iron-tts returns raw audio/mpeg bytes. Uses a direct fetch with the
 * user's JWT, then plays via HTMLAudioElement.
 *
 * Key feature: barge-in. The active audio element is module-scoped so any
 * caller can cancel the in-flight playback by calling cancelIronSpeech().
 * IronBar wires this into the mic-button click and into the recorder
 * start() so users can interrupt Iron mid-sentence.
 */
import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let activeAudio: HTMLAudioElement | null = null;
let activeBlobUrl: string | null = null;

export interface IronSpeakOptions {
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  speed?: number;
  /** Called when playback actually starts (audio.play resolved). */
  onStart?: () => void;
  /** Called when playback finishes naturally (NOT on cancel). */
  onEnd?: () => void;
  /** Called on any error during fetch or playback. */
  onError?: (message: string) => void;
}

/**
 * Cancel any in-flight Iron speech immediately. Idempotent.
 *
 * Returns true if speech was actually cancelled, false if nothing was playing.
 * IronBar uses the return value to know whether the user "barged in" on
 * an in-progress narration.
 */
export function cancelIronSpeech(): boolean {
  const wasPlaying = activeAudio != null;
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = "";
    } catch {
      /* noop */
    }
    activeAudio = null;
  }
  if (activeBlobUrl) {
    try {
      URL.revokeObjectURL(activeBlobUrl);
    } catch {
      /* noop */
    }
    activeBlobUrl = null;
  }
  return wasPlaying;
}

export async function ironSpeak(text: string, options: IronSpeakOptions = {}): Promise<void> {
  // Cancel any previous narration before starting a new one — never queue
  cancelIronSpeech();

  // Get the current user JWT for the request
  const sessionResult = await supabase.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;
  if (!accessToken) {
    options.onError?.("not authenticated");
    return;
  }

  let blob: Blob;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/iron-tts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice: options.voice ?? "nova",
        speed: options.speed ?? 1.0,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      options.onError?.(`tts_failed:${res.status}:${errText.slice(0, 120)}`);
      return;
    }
    blob = await res.blob();
  } catch (err) {
    options.onError?.(err instanceof Error ? err.message : "tts fetch failed");
    return;
  }

  // Cancel again in case the user barged in during the fetch
  cancelIronSpeech();

  const url = URL.createObjectURL(blob);
  activeBlobUrl = url;
  const audio = new Audio(url);
  activeAudio = audio;

  audio.addEventListener("playing", () => {
    options.onStart?.();
  });

  audio.addEventListener("ended", () => {
    if (activeAudio === audio) {
      cancelIronSpeech();
      options.onEnd?.();
    }
  });

  audio.addEventListener("error", () => {
    if (activeAudio === audio) {
      cancelIronSpeech();
      options.onError?.("audio playback error");
    }
  });

  try {
    await audio.play();
  } catch (err) {
    // Auto-play blocked, user gesture required, etc.
    if (activeAudio === audio) cancelIronSpeech();
    options.onError?.(err instanceof Error ? err.message : "audio play() rejected");
  }
}

/** Whether Iron is currently speaking (active audio element). */
export function isIronSpeaking(): boolean {
  return activeAudio != null && !activeAudio.paused;
}
