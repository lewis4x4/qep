/**
 * AI Request Log API — read-only admin queries for qb_ai_request_log.
 *
 * R4: customer_type (raw DB value) is shown, NOT a display name — the plan
 *     defers display-name mapping to a later slice.
 * R5: time-to-quote is NOT computed here — it requires correlating with
 *     qb_quotes by user_id/created_at, deferred to Slice 07.
 *
 * Join strategy: brand name and model name are joined via Supabase FK syntax.
 * User email is NOT joined — profile table join is complex and not worth the
 * query cost for a read-only log view. The UI shows user_id[:8] + ellipsis.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type AiLogRow =
  Database["public"]["Tables"]["qb_ai_request_log"]["Row"] & {
    qb_brands:           { name: string } | null;
    qb_equipment_models: { name_display: string; list_price_cents: number } | null;
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
  return (data ?? []) as AiLogRow[];
}

export async function getAiLogStats(opts: AiLogFilter = {}): Promise<AiLogStats> {
  const rows = await getAiRequestLogs(opts);
  const total    = rows.length;
  const resolved = rows.filter((r) => r.resolved_model_id != null).length;
  const voice    = rows.filter((r) => r.prompt_source === "voice").length;
  const text     = rows.filter((r) => r.prompt_source === "text").length;
  return { total, resolved, voice, text };
}
