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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = firstString(item);
    return text ? [text] : [];
  });
}

function normalizeCustomerType(value: unknown): "standard" | "gmu" {
  return value === "gmu" ? "gmu" : "standard";
}

function normalizeScenario(value: unknown): QuoteScenario | null {
  if (!isRecord(value)) return null;
  const label = firstString(value.label);
  const description = firstString(value.description);
  const customerOutOfPocketCents = numberOrNull(value.customerOutOfPocketCents);
  const totalPaidByCustomerCents = numberOrNull(value.totalPaidByCustomerCents);
  const dealerMarginCents = numberOrNull(value.dealerMarginCents);
  const dealerMarginPct = numberOrNull(value.dealerMarginPct);
  const commissionCents = numberOrNull(value.commissionCents);
  if (
    !label
    || !description
    || customerOutOfPocketCents == null
    || totalPaidByCustomerCents == null
    || dealerMarginCents == null
    || dealerMarginPct == null
    || commissionCents == null
  ) {
    return null;
  }
  const monthlyPaymentCents = numberOrNull(value.monthlyPaymentCents);
  const termMonths = numberOrNull(value.termMonths);
  return {
    label,
    description,
    programIds: stringArray(value.programIds),
    customerOutOfPocketCents,
    ...(monthlyPaymentCents == null ? {} : { monthlyPaymentCents }),
    ...(termMonths == null ? {} : { termMonths }),
    totalPaidByCustomerCents,
    dealerMarginCents,
    dealerMarginPct,
    commissionCents,
    pros: stringArray(value.pros),
    cons: stringArray(value.cons),
  };
}

function normalizeResolvedModel(value: unknown): SseResolvedEvent["model"] | null {
  if (!isRecord(value)) return null;
  const id = firstString(value.id);
  const modelCode = firstString(value.modelCode);
  const nameDisplay = firstString(value.nameDisplay);
  const listPriceCents = numberOrNull(value.listPriceCents);
  const brandCode = firstString(value.brandCode);
  const brandName = firstString(value.brandName);
  if (!id || !modelCode || !nameDisplay || listPriceCents == null || !brandCode || !brandName) return null;
  return {
    id,
    modelCode,
    nameDisplay,
    listPriceCents,
    modelYear: numberOrNull(value.modelYear),
    brandCode,
    brandName,
  };
}

function normalizeCompleteModel(value: unknown): SseCompleteEvent["resolvedModel"] | undefined {
  if (!isRecord(value)) return undefined;
  const id = firstString(value.id);
  const modelCode = firstString(value.modelCode);
  const nameDisplay = firstString(value.nameDisplay);
  const listPriceCents = numberOrNull(value.listPriceCents);
  if (!id || !modelCode || !nameDisplay || listPriceCents == null) return undefined;
  return { id, modelCode, nameDisplay, listPriceCents };
}

function normalizeCandidateRows(value: unknown): NonNullable<SseErrorEvent["candidates"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const modelCode = firstString(row.modelCode);
    const nameDisplay = firstString(row.nameDisplay);
    const listPriceCents = numberOrNull(row.listPriceCents);
    if (!modelCode || !nameDisplay || listPriceCents == null) return [];
    return [{ modelCode, nameDisplay, listPriceCents }];
  });
}

export function normalizeSseEvent(value: unknown): SseEvent | null {
  if (!isRecord(value)) return null;
  if (value.type === "status") {
    const message = firstString(value.message);
    return message ? { type: "status", message } : null;
  }
  if (value.type === "resolved") {
    const model = normalizeResolvedModel(value.model);
    const parsedSummary = firstString(value.parsedSummary);
    const deliveryState = firstString(value.deliveryState);
    if (!model || !parsedSummary || !deliveryState) return null;
    return {
      type: "resolved",
      model,
      parsedSummary,
      deliveryState,
      customerType: normalizeCustomerType(value.customerType),
    };
  }
  if (value.type === "scenario") {
    const scenario = normalizeScenario(value.scenario);
    const index = numberOrNull(value.index);
    if (!scenario || index == null) return null;
    return { type: "scenario", scenario, index };
  }
  if (value.type === "complete") {
    const totalScenarios = numberOrNull(value.totalScenarios);
    const latencyMs = numberOrNull(value.latencyMs);
    const deliveryState = firstString(value.deliveryState);
    if (totalScenarios == null || latencyMs == null || !deliveryState) return null;
    const programCount = numberOrNull(value.programCount);
    return {
      type: "complete",
      totalScenarios,
      latencyMs,
      logId: nullableString(value.logId),
      resolvedModel: normalizeCompleteModel(value.resolvedModel),
      brandId: nullableString(value.brandId),
      deliveryState,
      customerType: normalizeCustomerType(value.customerType),
      ...(programCount == null ? {} : { programCount }),
    };
  }
  if (value.type === "error") {
    const message = firstString(value.message);
    if (!message) return null;
    return {
      type: "error",
      message,
      fatal: value.fatal === true,
      candidates: normalizeCandidateRows(value.candidates),
      parsedSummary: firstString(value.parsedSummary) ?? undefined,
    };
  }
  return null;
}

export function normalizeParseRequestPayload(value: unknown): {
  modelId: string | null;
  brandId: string | null;
  deliveryState: string | null;
} {
  const record = isRecord(value) ? value : {};
  const parsedIntent = isRecord(record.parsedIntent) ? record.parsedIntent : {};
  return {
    modelId: nullableString(record.resolvedModelId),
    brandId: nullableString(record.resolvedBrandId),
    deliveryState: nullableString(parsedIntent.deliveryState),
  };
}

function errorMessageFromPayload(value: unknown): string | null {
  return isRecord(value) ? firstString(value.error, value.message) : null;
}

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
        msg = errorMessageFromPayload(await res.json()) ?? msg;
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
          const event = normalizeSseEvent(JSON.parse(raw));
          if (!event) continue;
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
    return normalizeParseRequestPayload(await res.json().catch(() => ({})));
  } catch {
    return { modelId: null, brandId: null, deliveryState: null };
  }
}
