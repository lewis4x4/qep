import type { AnalyticsAlertRow, ExecRoleTab } from "./types";

export type OwnerBriefingBucket = "certain" | "probable" | "suspected" | "dont_act_yet";
export type OwnerBriefingConfidence = "high" | "medium" | "low";

export interface OwnerBriefingSignal {
  id: string;
  bucket: OwnerBriefingBucket;
  confidence: OwnerBriefingConfidence;
  headline: string;
  trace: string[];
  href: string;
}

export interface OwnerBriefingBoard {
  summary: {
    certain: number;
    probable: number;
    suspected: number;
    dontActYet: number;
  };
  signals: OwnerBriefingSignal[];
}

export interface OwnerBriefingLensInput {
  role: ExecRoleTab;
  label: string;
  alerts: number;
  criticalAlerts: number;
  staleMetrics: number;
  freshestAt: string | null;
}

function bucketWeight(bucket: OwnerBriefingBucket): number {
  switch (bucket) {
    case "certain":
      return 4;
    case "probable":
      return 3;
    case "suspected":
      return 2;
    default:
      return 1;
  }
}

export function buildOwnerBriefingBoard(input: {
  alerts: AnalyticsAlertRow[];
  lenses: OwnerBriefingLensInput[];
}): OwnerBriefingBoard {
  const signals: OwnerBriefingSignal[] = [];

  for (const alert of input.alerts) {
    const bucket: OwnerBriefingBucket =
      alert.severity === "critical"
        ? "certain"
        : alert.severity === "error"
          ? "probable"
          : alert.severity === "warn"
            ? "suspected"
            : "dont_act_yet";

    const confidence: OwnerBriefingConfidence =
      alert.severity === "critical"
        ? "high"
        : alert.severity === "error"
          ? "medium"
          : "low";

    signals.push({
      id: alert.id,
      bucket,
      confidence,
      headline: alert.title,
      trace: [
        alert.description ?? "No additional alert description was recorded.",
        alert.role_target ? `Role target: ${alert.role_target.toUpperCase()}.` : "Role target unavailable.",
        alert.metric_key ? `Metric key: ${alert.metric_key}.` : "Alert is not tied to a single metric key.",
      ],
      href: alert.entity_type === "deal" && alert.entity_id
        ? `/qrm/deals/${alert.entity_id}`
        : alert.role_target === "cfo"
          ? "/executive?tab=cfo"
          : alert.role_target === "coo"
            ? "/executive?tab=coo"
            : "/executive",
    });
  }

  for (const lens of input.lenses) {
    if (lens.criticalAlerts > 0) {
      signals.push({
        id: `lens-critical:${lens.role}`,
        bucket: "probable",
        confidence: "medium",
        headline: `${lens.label} lens is carrying concentrated pressure`,
        trace: [
          `${lens.criticalAlerts} critical alert${lens.criticalAlerts === 1 ? "" : "s"} are active on this lens.`,
          `${lens.alerts} total alert${lens.alerts === 1 ? "" : "s"} are still open.`,
          lens.freshestAt ? `Latest fresh signal landed at ${lens.freshestAt}.` : "Freshness timestamp is unavailable.",
        ],
        href: `/executive`,
      });
    } else if (lens.staleMetrics > 0) {
      signals.push({
        id: `lens-stale:${lens.role}`,
        bucket: "dont_act_yet",
        confidence: "low",
        headline: `${lens.label} lens has stale inputs`,
        trace: [
          `${lens.staleMetrics} metric${lens.staleMetrics === 1 ? "" : "s"} are stale on this lens.`,
          `${lens.alerts} alert${lens.alerts === 1 ? "" : "s"} are open while data freshness is degraded.`,
          "Use this as a caution signal, not as a trigger for immediate intervention.",
        ],
        href: "/executive",
      });
    } else if (lens.alerts > 0) {
      signals.push({
        id: `lens-watch:${lens.role}`,
        bucket: "suspected",
        confidence: "low",
        headline: `${lens.label} lens needs a watch-list pass`,
        trace: [
          `${lens.alerts} alert${lens.alerts === 1 ? "" : "s"} are open on this lens.`,
          `${lens.criticalAlerts} of them are critical.`,
          "No data freshness problem is suppressing this lens right now.",
        ],
        href: "/executive",
      });
    }
  }

  signals.sort((a, b) => {
    const bucketDelta = bucketWeight(b.bucket) - bucketWeight(a.bucket);
    if (bucketDelta !== 0) return bucketDelta;
    const confidenceWeight = { high: 3, medium: 2, low: 1 };
    return confidenceWeight[b.confidence] - confidenceWeight[a.confidence];
  });

  return {
    summary: {
      certain: signals.filter((signal) => signal.bucket === "certain").length,
      probable: signals.filter((signal) => signal.bucket === "probable").length,
      suspected: signals.filter((signal) => signal.bucket === "suspected").length,
      dontActYet: signals.filter((signal) => signal.bucket === "dont_act_yet").length,
    },
    signals,
  };
}
