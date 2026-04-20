/**
 * AI Request Log API — read-only admin queries for qb_ai_request_log.
 *
 * R4: customer_type (raw DB value) is shown, NOT a display name — the plan
 *     defers display-name mapping to a later slice.
 * R5 (Slice 07 CP8 + Slice 09 CP4): time-to-quote is computed by joining
 *     against BOTH qb_quotes.originating_log_id AND
 *     quote_packages.originating_log_id. The live Quote Builder V2 flow
 *     writes to quote_packages (qb_quotes requires a cents-denominated
 *     pricing breakdown not available at QuoteBuilderV2 save time — a
 *     future slice migrates that). For each log row we find the EARLIEST
 *     quote across both tables and return the seconds between
 *     log.created_at and quote.created_at. Rows with no matching quote
 *     return null (rendered as "—").
 *
 * Join strategy: brand name and model name are joined via Supabase FK syntax.
 * Quotes are fetched in parallel from both tables, scoped to the visible log
 * ids (500 max).
 *
 * User email is NOT joined — profile table join is complex and not worth the
 * query cost for a read-only log view. The UI shows user_id[:8] + ellipsis.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type AiLogRow =
  Database["public"]["Tables"]["qb_ai_request_log"]["Row"] & {
    qb_brands:           { name: string } | null;
    qb_equipment_models: { name_display: string; list_price_cents: number } | null;
    /** Seconds between log.created_at and the earliest originating quote.
     *  Null when no quote has originated from this log row yet. */
    time_to_quote_seconds: number | null;
    /** Id of the earliest originating quote, if any — useful for deep-linking. */
    originating_quote_id: string | null;
  };

export interface AiLogFilter {
  daysBack?:    number | null;
  promptSource?: "text" | "voice" | "all";
}

export interface AiLogStats {
  total:    number;
  resolved: number;
  voice:    number;
  text:     number;
}

const LOG_LIMIT = 500;

function cutoffIso(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

/**
 * For a set of log ids, returns a map from log id → earliest originating quote
 * { id, createdAt, timeToQuoteSeconds } so the main getAiRequestLogs can merge.
 * Exported for tests. Pure over its inputs.
 */
export function deriveTimeToQuote(
  logs: Array<{ id: string; created_at: string }>,
  quotes: Array<{ id: string; originating_log_id: string | null; created_at: string }>,
): Map<string, { quoteId: string; timeToQuoteSeconds: number }> {
  const earliest = new Map<string, { id: string; created_at: string }>();
  for (const q of quotes) {
    if (!q.originating_log_id) continue;
    const prev = earliest.get(q.originating_log_id);
    if (!prev || new Date(q.created_at).getTime() < new Date(prev.created_at).getTime()) {
      earliest.set(q.originating_log_id, { id: q.id, created_at: q.created_at });
    }
  }

  const result = new Map<string, { quoteId: string; timeToQuoteSeconds: number }>();
  const logById = new Map(logs.map((l) => [l.id, l]));
  for (const [logId, quote] of earliest) {
    const log = logById.get(logId);
    if (!log) continue;
    const deltaMs = new Date(quote.created_at).getTime() - new Date(log.created_at).getTime();
    // Guard: if quote was created before the log (clock skew / bad data), skip
    if (deltaMs < 0) continue;
    result.set(logId, {
      quoteId: quote.id,
      timeToQuoteSeconds: Math.round(deltaMs / 1000),
    });
  }
  return result;
}

export async function getAiRequestLogs(opts: AiLogFilter = {}): Promise<AiLogRow[]> {
  const { daysBack = 7, promptSource = "all" } = opts;

  let query = supabase
    .from("qb_ai_request_log")
    .select(
      "*, qb_brands!resolved_brand_id(name), qb_equipment_models!resolved_model_id(name_display, list_price_cents)"
    )
    .order("created_at", { ascending: false });

  if (daysBack != null) {
    query = query.gte("created_at", cutoffIso(daysBack));
  }

  if (promptSource && promptSource !== "all") {
    query = query.eq("prompt_source", promptSource);
  }

  const { data, error } = await query.limit(LOG_LIMIT);
  if (error) return [];
  const logs = (data ?? []) as Omit<AiLogRow, "time_to_quote_seconds" | "originating_quote_id">[];
  if (logs.length === 0) return [];

  // Fetch originating quotes for this page of logs from BOTH tables in
  // parallel. Slice 07 CP8 queried qb_quotes; Slice 09 CP4 adds
  // quote_packages (where live Quote Builder V2 writes actually land).
  const logIds = logs.map((l) => l.id);
  const [qbRes, pkgRes] = await Promise.all([
    supabase
      .from("qb_quotes")
      .select("id, originating_log_id, created_at")
      .in("originating_log_id", logIds),
    supabase
      .from("quote_packages")
      .select("id, originating_log_id, created_at")
      .in("originating_log_id", logIds),
  ]);
  const quoteRows = [
    ...((qbRes.data  ?? []) as Array<{ id: string; originating_log_id: string | null; created_at: string }>),
    ...((pkgRes.data ?? []) as Array<{ id: string; originating_log_id: string | null; created_at: string }>),
  ];

  const deltas = deriveTimeToQuote(logs, quoteRows);

  return logs.map((l) => {
    const match = deltas.get(l.id);
    return {
      ...l,
      time_to_quote_seconds: match?.timeToQuoteSeconds ?? null,
      originating_quote_id:  match?.quoteId ?? null,
    } as AiLogRow;
  });
}

/**
 * Format time-to-quote seconds as a compact human string.
 *   null → "—"  ·  42s → "42s"  ·  195s → "3m 15s"  ·  3845s → "1h 4m"
 */
export function formatTimeToQuote(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export async function getAiLogStats(opts: AiLogFilter = {}): Promise<AiLogStats> {
  const rows = await getAiRequestLogs(opts);
  const total    = rows.length;
  const resolved = rows.filter((r) => r.resolved_model_id != null).length;
  const voice    = rows.filter((r) => r.prompt_source === "voice").length;
  const text     = rows.filter((r) => r.prompt_source === "text").length;
  return { total, resolved, voice, text };
}
