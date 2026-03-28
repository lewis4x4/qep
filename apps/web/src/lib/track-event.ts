/**
 * Frontend analytics event tracker for integration UI events.
 * Fire-and-forget — errors are swallowed, never block UI interactions.
 * Writes to activity_log using the new integration event types (migration 014).
 */

import { supabase } from "./supabase";
import type { Database } from "./database.types";

type IntegrationActivityType = Extract<
  Database["public"]["Enums"]["activity_type"],
  | "integration_config_updated"
  | "integration_connection_tested"
  | "integration_card_clicked"
  | "integration_panel_opened"
>;

export async function trackIntegrationEvent(
  eventName: IntegrationActivityType,
  properties: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      activity_type: eventName,
      success: true,
      payload: { event_name: eventName, ...properties },
    });
  } catch {
    // Intentionally swallowed — analytics must never break the UI
  }
}
