/**
 * admin-flare — helper for edge functions to emit a flare_report row
 * on structured system failures that operators need to see.
 *
 * Context: Slice-08 CP5 / Slice-07 audit M2. Previously, extract-price-sheet
 * and publish-price-sheet failures only surfaced as console.error logs in the
 * function runtime. Admins had no way to discover that an upload silently
 * failed unless they re-checked the sheet status by hand.
 *
 * This helper inserts a flare_report with origin metadata so the failure
 * appears in the existing /admin/flare triage surface. Fire-and-forget:
 * errors swallowed so a flare-insert failure never masks the original error.
 *
 * Usage:
 *   await emitAdminFlare(serviceClient, {
 *     source: "extract-price-sheet",
 *     priceSheetId,
 *     brandId,
 *     phase: "extract",
 *     message: "Claude parse failed after retry",
 *   });
 *
 * Note: this writes with the service client so it bypasses RLS — the caller
 * must already be in a privileged context (edge functions use service-role
 * for these operations).
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type AdminFlareSource =
  | "extract-price-sheet"
  | "publish-price-sheet";

export interface AdminFlareInput {
  source: AdminFlareSource;
  priceSheetId: string | null;
  brandId?: string | null;
  /** Which step of the pipeline broke. */
  phase: "extract" | "publish" | "download" | "parse" | "apply";
  /** Short human-readable summary — goes into user_description. */
  message: string;
  /** Extra structured context for the admin triage view. */
  extra?: Record<string, unknown>;
}

export async function emitAdminFlare(
  serviceClient: SupabaseClient,
  input: AdminFlareInput,
): Promise<void> {
  try {
    const description =
      `[${input.source}] ${input.phase} failed for sheet ${input.priceSheetId ?? "unknown"}: ${input.message}`
        .slice(0, 2000);

    await serviceClient.from("flare_reports").insert({
      severity:           "bug",
      user_description:   description,
      url:                `internal:${input.source}`,
      route:              `server:${input.source}`,
      page_title:         "Price sheet pipeline",
      hypothesis_pattern: `${input.source}:${input.phase}`,
      console_errors: [
        {
          level:   "error",
          source:  input.source,
          phase:   input.phase,
          message: input.message,
          price_sheet_id: input.priceSheetId,
          brand_id:       input.brandId ?? null,
          extra:          input.extra ?? null,
          timestamp:      new Date().toISOString(),
        },
      ],
      // Minimal env fields — this is a server-originated flare
      browser:    "server:deno",
      session_id: `edge-fn-${input.source}`,
      status:     "new",
    });
  } catch (err) {
    // Never let observability mask the underlying failure.
    console.warn(`[admin-flare] failed to emit flare for ${input.source}/${input.phase}:`, err);
  }
}
