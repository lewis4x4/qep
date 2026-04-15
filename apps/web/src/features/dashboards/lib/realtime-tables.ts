/**
 * Iron dashboard realtime subscription table map (Track 5 Slice 5.7).
 *
 * Each Iron role dashboard renders a different set of metrics sourced from
 * different tables in `useDashboardData.ts`. The realtime hook uses this
 * map to pick exactly which tables to listen on — subscribing to every
 * table everywhere would be wasteful and could drown out events.
 *
 * Exported as a pure function so the choice is testable and easy to
 * inspect when a new dashboard field is added.
 */

export type IronRoleKey = "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";

/** Tables an Iron role dashboard queries — any INSERT/UPDATE/DELETE invalidates the cache. */
export function tablesForIronRole(role: IronRoleKey): string[] {
  switch (role) {
    case "iron_manager":
      return [
        "crm_deals",
        "prospecting_kpis",
        "demos",
        "trade_valuations",
        "crm_equipment",
        "manufacturer_incentives",
        "qrm_predictions",
      ];
    case "iron_advisor":
      return [
        "crm_deals",
        "follow_up_touchpoints",
        "prospecting_kpis",
      ];
    case "iron_woman":
      return [
        "crm_deals",
        "deposits",
        "equipment_intake",
      ];
    case "iron_man":
      return [
        "equipment_intake",
        "demos",
        "rental_returns",
      ];
  }
}

/** Stable realtime channel name for an iron role — "dashboard:<role>". */
export function channelNameForRole(role: IronRoleKey, suffix?: string | null): string {
  return suffix ? `dashboard:${role}:${suffix}` : `dashboard:${role}`;
}
