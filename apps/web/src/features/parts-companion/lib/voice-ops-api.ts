// ============================================================
// Parts Voice Ops API (Slice 3.2)
// ============================================================

import { supabase } from "../../../lib/supabase";
import { normalizeVoiceOpsResult } from "./voice-ops-api-normalizers";

export interface VoiceOpsContext {
  customer_id?: string;
  customer_name?: string;
  last_part?: string;
  branch?: string;
  page?: string;
}

export interface VoiceToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  elapsed_ms: number;
}

export interface VoiceOpsResult {
  ok: boolean;
  spoken_text: string;
  intent: "lookup" | "stock_check" | "add_to_order" | "history" | "other";
  tool_calls: VoiceToolCall[];
  elapsed_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd_cents: number;
}

export async function submitVoiceCommand(input: {
  transcript: string;
  confidence?: number;
  context?: VoiceOpsContext;
}): Promise<VoiceOpsResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  const { data, error } = await supabase.functions.invoke("parts-voice-ops", {
    body: {
      transcript: input.transcript,
      transcript_confidence: input.confidence ?? null,
      context: input.context ?? null,
    },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return normalizeVoiceOpsResult(data);
}
