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

  // IMPORTANT: never destructure `invoke` off `supabase.functions` — the
  // FunctionsClient.invoke method dereferences `this.region` internally,
  // so calling it as a free function throws "undefined is not an object
  // (evaluating 'this.region')" in Safari. Always invoke through the
  // live receiver.
  const fns = (supabase as unknown as {
    functions: {
      invoke: (
        name: string,
        opts: { body: FormData },
      ) => Promise<{ data: IronTranscribeResponse | null; error: { message?: string } | null }>;
    };
  }).functions;

  const { data, error } = await fns.invoke("iron-transcribe", { body: form });
  if (error) throw new Error(error.message ?? "iron-transcribe failed");
  return data ?? { ok: false, transcript: "", confidence: 0 };
}
