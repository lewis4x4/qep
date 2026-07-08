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

/** Tables an Iron role dashboard queries — any INSERT/UPDATE/DELETE invalidates the cache.
 *
 * These must be BASE TABLE names, not views: `crm_deals`/`crm_equipment` are
 * compatibility views over `qrm_deals`/`qrm_equipment`, and postgres_changes
 * events carry the base-table name from the WAL — a subscription on a view
 * name never fires (views can't join the realtime publication at all).
 * Dashboard queries still read the views; only these invalidation listeners
 * need the underlying tables. */
export function tablesForIronRole(role: IronRoleKey): string[] {
  switch (role) {
    case "iron_manager":
      return [
        "qrm_deals",
        "prospecting_kpis",
        "demos",
        "trade_valuations",
        "qrm_equipment",
        "manufacturer_incentives",
        "qrm_predictions",
      ];
    case "iron_advisor":
      return [
        "qrm_deals",
        "follow_up_touchpoints",
        "prospecting_kpis",
      ];
    case "iron_woman":
      return [
        "qrm_deals",
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
