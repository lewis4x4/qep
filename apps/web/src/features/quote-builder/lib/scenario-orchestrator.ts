/**
 * Scenario Orchestrator — Client-side wrapper for qb-ai-scenarios (Slice 05)
 *
 * Consumes the SSE stream from qb-ai-scenarios and exposes a clean async
 * iterator so the ConversationalDealEngine component can render scenario cards
 * progressively without dealing with raw fetch + ReadableStream plumbing.
 *
 * Usage:
 *   const session = streamScenarios({ prompt, supabase });
 *   for await (const event of session) {
 *     if (event.type === 'scenario') addCard(event.scenario);
 *     if (event.type === 'complete') setDone(true);
 *   }
 *
 * The function is cancellable: call session.cancel() to abort the stream.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteScenario } from "@/features/quote-builder/lib/programs-types";

// ── SSE event shapes (mirroring edge function output) ─────────────────────────

export interface SseStatusEvent {
  type: "status";
  message: string;
}

export interface SseResolvedEvent {
  type: "resolved";
  model: {
    id: string;
    modelCode: string;
    nameDisplay: string;
    listPriceCents: number;
    modelYear: number | null;
    brandCode: string;
    brandName: string;
  };
  parsedSummary: string;
  deliveryState: string;
  customerType: "standard" | "gmu";
}

export interface SseScenarioEvent {
  type: "scenario";
  scenario: QuoteScenario;
  index: number;
}

export interface SseCompleteEvent {
  type: "complete";
  totalScenarios: number;
  latencyMs: number;
  logId: string | null;
  resolvedModel?: {
    id: string;
    modelCode: string;
    nameDisplay: string;
    listPriceCents: number;
  };
  brandId: string | null;
  deliveryState: string;
  customerType: "standard" | "gmu";
  programCount?: number;
}

export interface SseErrorEvent {
  type: "error";
  message: string;
  fatal: boolean;
  candidates?: Array<{
    modelCode: string;
    nameDisplay: string;
    listPriceCents: number;
  }>;
  parsedSummary?: string;
}

export type SseEvent =
  | SseStatusEvent
  | SseResolvedEvent
  | SseScenarioEvent
  | SseCompleteEvent
  | SseErrorEvent;

// ── Cancellable async iterable ────────────────────────────────────────────────

export interface ScenarioSession extends AsyncIterable<SseEvent> {
  /** Abort the in-flight request (no-op if already complete). */
  cancel(): void;
}

export interface StreamScenariosOptions {
  prompt: string;
  promptSource?: "text" | "voice";
  /** Override: skip parse step and use a known model UUID. */
  modelId?: string;
  /** Override: brand UUID. */
  brandId?: string;
  /** Override: 2-letter state. */
  deliveryState?: string;
  /** Override: customer type. */
  customerType?: "standard" | "gmu";
  supabase: SupabaseClient;
}

/**
 * Open a streaming session to qb-ai-scenarios.
 * Returns a cancellable async iterable of SSE events.
 */
export function streamScenarios(opts: StreamScenariosOptions): ScenarioSession {
  const controller = new AbortController();

  async function* generator(): AsyncGenerator<SseEvent> {
    const { data: { session } } = await opts.supabase.auth.getSession();
    if (!session) {
      yield { type: "error", fatal: true, message: "Not signed in." };
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const url         = `${supabaseUrl}/functions/v1/qb-ai-scenarios`;

    let res: Response;
    try {
      res = await fetch(url, {
        method:  "POST",
        signal:  controller.signal,
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey":        anonKey,
        },
        body: JSON.stringify({
          prompt:        opts.prompt,
          promptSource:  opts.promptSource ?? "text",
          modelId:       opts.modelId,
          brandId:       opts.brandId,
          deliveryState: opts.deliveryState,
          customerType:  opts.customerType,
        }),
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      yield { type: "error", fatal: true, message: "Network error — check your connection." };
      return;
    }

    if (!res.ok) {
      let msg = `qb-ai-scenarios failed (${res.status})`;
      try {
        const body = await res.json() as { error?: string };
        if (body.error) msg = body.error;
      } catch { /* ignore */ }
      yield { type: "error", fatal: true, message: msg };
      return;
    }

    if (!res.body) {
      yield { type: "error", fatal: true, message: "Empty response from server." };
      return;
    }

    // Parse the SSE stream line by line
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        break; // stream aborted or connection reset
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice("data: ".length).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw) as SseEvent;
          yield event;
          if (event.type === "complete") return;
        } catch {
          // Malformed SSE line — skip
        }
      }
    }
  }

  const iterable: ScenarioSession = {
    [Symbol.asyncIterator]: generator,
    cancel() { controller.abort(); },
  };

  return iterable;
}

// ── Quick-fetch helper (non-streaming) for pre-populating form ────────────────

/**
 * Resolve a model UUID from a free-text prompt (calls qb-parse-request).
 * Used when the rep selects a scenario and the UI needs to pre-populate form state.
 */
export async function resolveModelFromPrompt(
  prompt: string,
  supabase: SupabaseClient,
): Promise<{ modelId: string | null; brandId: string | null; deliveryState: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { modelId: null, brandId: null, deliveryState: null };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/qb-parse-request`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey":        anonKey,
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) return { modelId: null, brandId: null, deliveryState: null };
    const data = await res.json() as {
      resolvedModelId: string | null;
      resolvedBrandId: string | null;
      parsedIntent: { deliveryState: string | null };
    };
    return {
      modelId:       data.resolvedModelId,
      brandId:       data.resolvedBrandId,
      deliveryState: data.parsedIntent?.deliveryState ?? null,
    };
  } catch {
    return { modelId: null, brandId: null, deliveryState: null };
  }
}
