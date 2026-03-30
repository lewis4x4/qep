/**
 * Frontend integration analytics tracker.
 * Fire-and-forget: never throws to UI code.
 *
 * Stores web events in activity_log with a contract-shaped payload so Data can
 * reconcile the same event names emitted by Edge.
 */

import { supabase } from "./supabase";
import type { Database } from "./database.types";

type IntegrationActivityType =
  | "admin_integrations_viewed"
  | "integration_card_opened"
  | "integration_panel_opened"
  | "integration_credentials_saved"
  | "integration_credentials_save_failed"
  | "integration_test_connection_clicked"
  | "integration_badge_rendered";

export async function trackIntegrationEvent(
  eventName: IntegrationActivityType,
  properties: Record<string, unknown>
): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("activity_log").insert([
      {
        activity_type:
          eventName as unknown as Database["public"]["Enums"]["activity_type"],
        success: true,
        payload: {
          event_id: eventId,
          event_name: eventName,
          occurred_at: occurredAt,
          workspace_id: "default",
          user_id: user?.id ?? null,
          source: "web",
          ...properties,
        },
      },
    ]);
  } catch {
    // Intentionally swallowed — analytics must never break the UI
  }
}
