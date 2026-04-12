import type { DataBadge } from "./integration-types.ts";

export type DgeRefreshStatus =
  | "fresh"
  | "refreshing"
  | "stale"
  | "degraded";

export interface DgeRefreshJobSummary {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  created_at: string;
  last_error?: string | null;
}

export interface DgeRefreshEnvelope {
  status: DgeRefreshStatus;
  stale: boolean;
  job_id: string | null;
  requested_at: string | null;
  last_error: string | null;
}

export function resolveRefreshEnvelope(params: {
  snapshotUpdatedAt: string | null;
  staleAfterMs: number;
  openJob: DgeRefreshJobSummary | null;
}): DgeRefreshEnvelope {
  const updatedAtMs = params.snapshotUpdatedAt
    ? Date.parse(params.snapshotUpdatedAt)
    : Number.NaN;
  const isStale = Number.isNaN(updatedAtMs)
    ? true
    : (Date.now() - updatedAtMs) > params.staleAfterMs;

  if (params.openJob) {
    return {
      status: params.openJob.status === "failed" ? "degraded" : "refreshing",
      stale: isStale,
      job_id: params.openJob.id,
      requested_at: params.openJob.created_at,
      last_error: params.openJob.last_error ?? null,
    };
  }

  if (Number.isNaN(updatedAtMs)) {
    return {
      status: "degraded",
      stale: true,
      job_id: null,
      requested_at: null,
      last_error: null,
    };
  }

  return {
    status: isStale ? "stale" : "fresh",
    stale: isStale,
    job_id: null,
    requested_at: null,
    last_error: null,
  };
}

export function mergeSnapshotBadges(
  badges: DataBadge[],
  refresh: DgeRefreshEnvelope,
): DataBadge[] {
  const next = new Set<DataBadge>(badges);
  if (refresh.stale) {
    next.add("STALE_CACHE");
  }
  if (refresh.status === "degraded") {
    next.add("AI_OFFLINE");
  }
  if (next.size === 0) {
    next.add(refresh.stale ? "STALE_CACHE" : "LIVE");
  }
  return [...next];
}
