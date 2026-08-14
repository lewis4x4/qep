/**
 * Anomaly Scan Edge Function
 *
 * Runs periodic analysis across QRM data to detect:
 * 1. Stalling deals — no activity in 7+ days, deal not closed
 * 2. Overdue follow-ups — past their next_follow_up_at date
 * 3. Activity gaps — reps with no logged activity in 3+ days
 * 4. Pipeline risk — deals closing within 7 days with low-stage status
 * 5. Stale embeddings — CRM entities out of sync with crm_embeddings
 * 6. Orphan chunks — unpublished documents with lingering chunk rows
 *
 * Callable via service role (cron) or by admin/manager/owner (on-demand).
 * Workspace scoping and truncation metadata are enforced in handler.ts.
 *
 * ── Phase 0 P0.4 Day 7 — DUAL-WRITE TO FLOW BUS ────────────────────────────
 *
 * In addition to inserting into anomaly_alerts (the existing direct-insert
 * path), this function ALSO publishes an `anomaly.detected` event to the
 * flow bus (supabase/functions/_shared/flow-bus/publish.ts) for each new
 * anomaly. The bus publish is best-effort: a failure logs to sentry but
 * never breaks the primary anomaly_alerts flow.
 */
import { handleAnomalyScan } from "./handler.ts";

Deno.serve((req) => handleAnomalyScan(req));
