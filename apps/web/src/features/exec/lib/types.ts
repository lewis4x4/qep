/**
 * QEP Moonshot Command Center — shared type contracts.
 *
 * These shapes mirror the migration-187 + migration-188 columns 1:1 so the
 * snapshot runner (Slice 2) and dispatch helpers can serialize/deserialize
 * without renaming. Keep in sync with `analytics_*` tables.
 */

export type ExecRoleTab = "ceo" | "cfo" | "coo";

export type MetricRefreshState = "fresh" | "stale" | "recalculated" | "partial" | "failed";

export type AlertSeverity = "info" | "warn" | "error" | "critical";
export type AlertStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "dismissed";

/** Latest-snapshot row returned by `analytics_latest_snapshots` RPC. */
export interface KpiSnapshot {
  metric_key: string;
  metric_value: number | null;
  comparison_value: number | null;
  target_value: number | null;
  confidence_score: number | null;
  data_quality_score: number | null;
  period_start: string;
  period_end: string;
  calculated_at: string;
  refresh_state: MetricRefreshState;
  metadata: Record<string, unknown>;
}

/** Metric definition row from `analytics_metric_definitions`. */
export interface MetricDefinition {
  metric_key: string;
  label: string;
  description: string | null;
  formula_text: string;
  display_category: string;
  owner_role: ExecRoleTab | "shared";
  source_tables: string[];
  refresh_cadence: string;
  drill_contract: Record<string, unknown>;
  threshold_config: Record<string, unknown>;
  synthetic_weights: Record<string, number> | null;
  is_executive_metric: boolean;
}

/** A KPI tile's runtime payload — definition + latest snapshot fused. */
export interface KpiTileData {
  definition: MetricDefinition;
  snapshot: KpiSnapshot | null;
  /** Optional fallback value when no snapshot exists yet (Slice 1 lives here). */
  fallback_value: number | null;
  fallback_label: string | null;
  fallback_source: string | null;
}

export interface AnalyticsAlertRow {
  id: string;
  alert_type: string;
  metric_key: string | null;
  severity: AlertSeverity;
  title: string;
  description: string | null;
  role_target: ExecRoleTab | "shared";
  business_impact_value: number | null;
  business_impact_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  branch_id: string | null;
  root_cause_guess: string | null;
  suggested_action: string | null;
  status: AlertStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}
