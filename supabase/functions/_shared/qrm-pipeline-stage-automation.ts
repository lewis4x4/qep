export type QuotePipelineStageTargetKey =
  | "quoteCreated"
  | "quoteSent"
  | "quotePresented"
  | "salesOrderSigned";

export interface QuotePipelineStageTarget {
  key: QuotePipelineStageTargetKey;
  stageNames: readonly string[];
  fallbackSortOrder: number;
}

export interface QuotePipelineStageRow {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  is_closed_won?: boolean | null;
  is_closed_lost?: boolean | null;
}

export const QUOTE_PIPELINE_STAGE_TARGETS: Record<QuotePipelineStageTargetKey, QuotePipelineStageTarget> = {
  quoteCreated: { key: "quoteCreated", stageNames: ["Quote Created"], fallbackSortOrder: 6 },
  quoteSent: { key: "quoteSent", stageNames: ["Quote Sent"], fallbackSortOrder: 7 },
  quotePresented: { key: "quotePresented", stageNames: ["Quote Presented", "Quote Sent"], fallbackSortOrder: 8 },
  salesOrderSigned: { key: "salesOrderSigned", stageNames: ["Sales Order Signed"], fallbackSortOrder: 13 },
};

export function chooseQuotePipelineTargetStage(input: {
  candidates: QuotePipelineStageRow[];
  workspaceId: string;
  target: QuotePipelineStageTarget;
}): QuotePipelineStageRow | null {
  const workspaceId = input.workspaceId || "default";
  const openCandidates = input.candidates.filter((candidate) =>
    candidate.is_closed_won !== true &&
    candidate.is_closed_lost !== true &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    Number.isFinite(Number(candidate.sort_order))
  );
  const primaryStageName = input.target.stageNames[0] ?? null;
  const fallbackStageNames = input.target.stageNames.slice(1);

  const findNamedStage = (candidateWorkspaceId: string, stageNames: readonly string[]) => {
    for (const stageName of stageNames) {
      const match = openCandidates.find((candidate) =>
        candidate.workspace_id === candidateWorkspaceId && candidate.name === stageName
      );
      if (match) return match;
    }
    return null;
  };

  const findBySortOrder = (candidateWorkspaceId: string) =>
    openCandidates.find((candidate) =>
      candidate.workspace_id === candidateWorkspaceId && Number(candidate.sort_order) === input.target.fallbackSortOrder
    ) ?? null;

  return (primaryStageName ? findNamedStage(workspaceId, [primaryStageName]) : null) ??
    findBySortOrder(workspaceId) ??
    (primaryStageName ? findNamedStage("default", [primaryStageName]) : null) ??
    findBySortOrder("default") ??
    findNamedStage(workspaceId, fallbackStageNames) ??
    findNamedStage("default", fallbackStageNames);
}

export function shouldAdvanceQuoteDealStage(input: {
  currentSortOrder: number | null;
  targetSortOrder: number;
}): boolean {
  if (input.currentSortOrder === null) return true;
  return input.currentSortOrder < input.targetSortOrder;
}
