/**
 * Wave 7 Iron Companion v1.1 — voice API client.
 *
 * Single wrapper around the iron-transcribe edge function. Returns the
 * transcript + a confidence score (0..1, derived from Whisper's
 * avg_logprob across segments).
 */
import { supabase } from "@/lib/supabase";

export interface IronTranscribeResponse {
  ok: boolean;
  transcript: string;
  confidence: number;
  language?: string;
  duration_ms?: number;
  message?: string;
}

export async function ironTranscribe(blob: Blob, fileName: string): Promise<IronTranscribeResponse> {
  const form = new FormData();
  form.append("audio", new File([blob], fileName, { type: blob.type || "audio/webm" }));

  const invoke = (supabase as unknown as {
    functions: {
      invoke: (
        name: string,
        opts: { body: FormData },
      ) => Promise<{ data: IronTranscribeResponse | null; error: { message?: string } | null }>;
    };
  }).functions.invoke;

  const { data, error } = await invoke("iron-transcribe", { body: form });
  if (error) throw new Error(error.message ?? "iron-transcribe failed");
  return data ?? { ok: false, transcript: "", confidence: 0 };
}
