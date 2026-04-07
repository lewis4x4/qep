/**
 * Wave 6.11 Flare — type contracts.
 *
 * These shapes are pinned by WAVE-6.11-FLARE-BUILD-SPEC.md §4. Field
 * names match the migration columns 1:1 so the edge fn can `.insert(payload)`
 * without renaming.
 */

export type FlareSeverity = "blocker" | "bug" | "annoyance" | "idea";

export type FlareStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "fixed"
  | "wontfix"
  | "duplicate";

export interface FlareClickEvent {
  ts: number;
  selector: string;
  text: string | null;
  x: number;
  y: number;
}

export interface FlareNetworkEvent {
  ts: number;
  url: string;
  method: string;
  status: number | null;
  duration_ms: number | null;
  error: string | null;
}

export interface FlareConsoleError {
  ts: number;
  level: "error" | "warn";
  message: string;
  stack: string | null;
}

export interface FlareRouteChange {
  ts: number;
  from: string;
  to: string;
}

export interface FlareVisibleEntity {
  type: string;
  id: string;
}

export interface FlareViewport {
  width: number;
  height: number;
  dpr: number;
}

export interface FlarePerformanceMetrics {
  lcp_ms: number | null;
  fid_ms: number | null;
  cls: number | null;
  memory_used_mb: number | null;
}

export interface FlareContext {
  // Identity
  user_id: string;
  workspace_id: string;
  reporter_email: string;
  reporter_role: string;
  reporter_iron_role: string | null;

  // Location
  url: string;
  route: string;
  page_title: string;

  // Visible entities
  visible_entities: FlareVisibleEntity[];

  // Ring buffer snapshots
  click_trail: FlareClickEvent[];
  network_trail: FlareNetworkEvent[];
  console_errors: FlareConsoleError[];
  route_trail: FlareRouteChange[];

  // State
  store_snapshot: Record<string, unknown> | null;
  react_query_cache_keys: string[];
  feature_flags: Record<string, boolean>;

  // Environment
  browser: string;
  os: string;
  viewport: FlareViewport;
  network_type: string | null;
  app_version: string;
  git_sha: string;
  build_timestamp: string;

  // Session
  session_id: string;
  tab_id: string;
  time_on_page_ms: number;

  // Performance
  performance_metrics: FlarePerformanceMetrics;
}

export interface FlareAnnotation {
  type: "arrow" | "circle" | "scribble";
  points: number[];
}

export interface FlareSubmitPayload {
  severity: FlareSeverity;
  user_description: string;
  screenshot_base64: string;
  dom_snapshot_gzipped: string;
  annotations: FlareAnnotation[];
  context: FlareContext;
}

export interface FlareSubmitResponse {
  report_id: string;
  linear_issue_url: string | null;
  paperclip_issue_url: string | null;
  slack_ts: string | null;
  similar_count_last_7d: number;
  ai_severity_recommendation?: FlareSeverity | null;
  ai_severity_reasoning?: string | null;
  hypothesis_pattern?: string | null;
  reproducer_steps?: string | null;
  recent_activity?: { id: string; type: string; subject: string | null; occurred_at: string } | null;
}
