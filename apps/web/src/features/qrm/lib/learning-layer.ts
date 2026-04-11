export type LearningConfidence = "high" | "medium" | "low";

export interface LearningWin {
  id: string;
  name: string;
  amount: number | null;
  closedAt: string;
}

export interface LearningLoss {
  id: string;
  name: string;
  lossReason: string | null;
  competitor: string | null;
  closedAt: string;
}

export interface LearningWorkflowRun {
  workflowSlug: string;
  status: string;
  durationMs: number | null;
  startedAt: string;
}

export interface LearningPatternSuggestion {
  id: string;
  shortLabel: string | null;
  occurrenceCount: number;
  uniqueUsers: number;
  status: string;
  promotedFlowId: string | null;
  lastSeenAt: string | null;
}

export interface LearningIntervention {
  id: string;
  alertType: string;
  resolutionType: string;
  resolutionNotes: string | null;
  recurrenceCount: number;
  resolvedAt: string;
}

export interface LearningLayerBoard {
  summary: {
    wins: number;
    losses: number;
    workflowPatterns: number;
    learnedPatterns: number;
  };
  wins: Array<{
    id: string;
    title: string;
    confidence: LearningConfidence;
    trace: string[];
    href: string;
  }>;
  losses: Array<{
    id: string;
    title: string;
    confidence: LearningConfidence;
    trace: string[];
    href: string;
  }>;
  workflows: Array<{
    key: string;
    title: string;
    confidence: LearningConfidence;
    trace: string[];
    href: string;
  }>;
  patterns: Array<{
    key: string;
    title: string;
    confidence: LearningConfidence;
    trace: string[];
    href: string;
  }>;
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildLearningLayerBoard(input: {
  wins: LearningWin[];
  losses: LearningLoss[];
  workflowRuns: LearningWorkflowRun[];
  suggestions: LearningPatternSuggestion[];
  interventions: LearningIntervention[];
}): LearningLayerBoard {
  const wins = input.wins
    .slice()
    .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      title: row.name,
      confidence: "high" as const,
      trace: [
        `${formatCurrency(row.amount)} closed-won revenue.`,
        `Closed ${new Date(row.closedAt).toLocaleDateString()}.`,
      ],
      href: `/qrm/deals/${row.id}`,
    }));

  const lossBuckets = new Map<string, { count: number; competitorCount: number }>();
  for (const loss of input.losses) {
    const key = loss.lossReason?.trim() || "Unspecified loss reason";
    const bucket = lossBuckets.get(key) ?? { count: 0, competitorCount: 0 };
    bucket.count += 1;
    if (loss.competitor) bucket.competitorCount += 1;
    lossBuckets.set(key, bucket);
  }

  const losses = [...lossBuckets.entries()]
    .map(([reason, bucket]) => ({
      id: reason,
      title: reason,
      confidence: bucket.count >= 2 ? "high" as const : "medium" as const,
      trace: [
        `${bucket.count} closed-lost deal${bucket.count === 1 ? "" : "s"} share this reason.`,
        bucket.competitorCount > 0
          ? `${bucket.competitorCount} of those losses named a competitor.`
          : "No competitor was explicitly recorded on these losses.",
      ],
      href: "/qrm/deals",
    }))
    .sort((a, b) => b.trace[0]!.localeCompare(a.trace[0]!))
    .slice(0, 6);

  const workflowBuckets = new Map<string, { completed: number; failed: number; durationTotal: number; durationCount: number }>();
  for (const run of input.workflowRuns) {
    const bucket = workflowBuckets.get(run.workflowSlug) ?? { completed: 0, failed: 0, durationTotal: 0, durationCount: 0 };
    if (run.status === "completed") bucket.completed += 1;
    if (run.status === "failed" || run.status === "dead_lettered") bucket.failed += 1;
    if (run.durationMs != null) {
      bucket.durationTotal += run.durationMs;
      bucket.durationCount += 1;
    }
    workflowBuckets.set(run.workflowSlug, bucket);
  }

  const workflows = [...workflowBuckets.entries()]
    .map(([workflowSlug, bucket]) => ({
      key: workflowSlug,
      title: titleize(workflowSlug),
      confidence: bucket.failed === 0 ? "high" as const : bucket.failed <= bucket.completed ? "medium" as const : "low" as const,
      trace: [
        `${bucket.completed} completed run${bucket.completed === 1 ? "" : "s"} · ${bucket.failed} failed.`,
        bucket.durationCount > 0
          ? `Average duration ${(bucket.durationTotal / bucket.durationCount / 60000).toFixed(1)} minutes.`
          : "No duration telemetry is available.",
      ],
      href: "/qrm/workflow-audit",
    }))
    .sort((a, b) => {
      const confidenceWeight = { high: 3, medium: 2, low: 1 };
      return confidenceWeight[b.confidence] - confidenceWeight[a.confidence];
    })
    .slice(0, 6);

  const patternItems = [
    ...input.suggestions.map((row) => ({
      key: `suggestion:${row.id}`,
      title: row.shortLabel ?? titleize(row.status === "promoted" ? "promoted_flow_pattern" : row.status),
      confidence: row.promotedFlowId ? "high" as const : row.occurrenceCount >= 3 ? "medium" as const : "low" as const,
      trace: [
        `${row.occurrenceCount} observed pattern occurrence${row.occurrenceCount === 1 ? "" : "s"} across ${row.uniqueUsers} user${row.uniqueUsers === 1 ? "" : "s"}.`,
        row.promotedFlowId ? "This pattern has already been promoted into a workflow." : `Current suggestion status: ${row.status}.`,
      ],
      href: "/qrm/sop-folk",
    })),
    ...input.interventions.map((row) => ({
      key: `intervention:${row.id}`,
      title: `${titleize(row.alertType)} resolved via ${titleize(row.resolutionType)}`,
      confidence: row.recurrenceCount >= 2 ? "high" as const : "medium" as const,
      trace: [
        `${row.recurrenceCount} recurrence${row.recurrenceCount === 1 ? "" : "s"} recorded.`,
        row.resolutionNotes ? row.resolutionNotes : `Resolved ${new Date(row.resolvedAt).toLocaleDateString()}.`,
      ],
      href: "/executive",
    })),
  ]
    .sort((a, b) => {
      const confidenceWeight = { high: 3, medium: 2, low: 1 };
      return confidenceWeight[b.confidence] - confidenceWeight[a.confidence];
    })
    .slice(0, 8);

  return {
    summary: {
      wins: input.wins.length,
      losses: input.losses.length,
      workflowPatterns: workflows.length,
      learnedPatterns: patternItems.length,
    },
    wins,
    losses,
    workflows,
    patterns: patternItems,
  };
}
