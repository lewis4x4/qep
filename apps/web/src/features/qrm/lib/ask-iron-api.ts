/**
 * Client adapter for the qrm-ask-iron edge function.
 *
 * Keeps the fetch + auth plumbing in one place so the AskIronSurface stays
 * focused on rendering. Mirrors the shape of qrm-router-api.ts.
 */

import { supabase } from "@/lib/supabase";
import type { AskIronRequest, AskIronResponse } from "./ask-iron-types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export class AskIronOfflineError extends Error {
  constructor() {
    super("Ask Iron is offline — ANTHROPIC_API_KEY is not configured.");
    this.name = "AskIronOfflineError";
  }
}

export async function askIron(input: AskIronRequest): Promise<AskIronResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in is required to ask Iron.");
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/qrm-ask-iron`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  // 503 = zero-blocking degrade path (ANTHROPIC_API_KEY not set). Surface a
  // dedicated error type so the UI can show a "configure the assistant"
  // state instead of a generic crash banner.
  if (response.status === 503) throw new AskIronOfflineError();

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ||
      `Ask Iron request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as AskIronResponse;
}
