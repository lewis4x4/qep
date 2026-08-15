/**
 * qb-price-sheet-watchdog — Slice 16.
 *
 * Poll URL-based price-sheet sources on a cadence. When the hash
 * changes we download the body, stash it in Storage, insert a
 * qb_price_sheets row in pending_review, and fire extract-price-sheet
 * to trigger the existing Claude extraction + approval pipeline.
 *
 * Two invocation modes:
 *
 *   1. Manual trigger (admin hits "Check now" on a single source):
 *        POST body: { sourceId: "<uuid>", manualTrigger: true }
 *      → runs that one source regardless of cadence.
 *
 *   2. Batch tick (cron or ad-hoc /bulk ping):
 *        POST body: { } or { batch: true }
 *      → picks every active source where isOverdue(source) === true
 *        and runs each in sequence. Sequential (not parallel) so we
 *        don't stampede the extract-price-sheet edge function.
 *
 * Auth: admin/manager/owner JWT (workspace-bound) or service-role/cron.
 */

import { handleWatchdogRequest } from "./handler.ts";

Deno.serve((req) => handleWatchdogRequest(req));
