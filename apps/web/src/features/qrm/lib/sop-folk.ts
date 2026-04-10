export interface SopComplianceSnapshot {
  templateId: string;
  templateTitle: string;
  department: string;
  totalExecutions: number;
  blockedExecutions: number;
  completionRatePct: number | null;
}

export interface FolkSuggestionSnapshot {
  id: string;
  occurrenceCount: number;
  uniqueUsers: number;
  status: string;
}

export interface SopFolkSummary {
  templates: number;
  weakTemplates: number;
  blockedRuns: number;
  folkSuggestions: number;
  folkUsageHits: number;
}

export function summarizeSopFolk(input: {
  compliance: SopComplianceSnapshot[];
  suggestions: FolkSuggestionSnapshot[];
}): SopFolkSummary {
  return {
    templates: input.compliance.length,
    weakTemplates: input.compliance.filter((row) => (row.completionRatePct ?? 0) < 70).length,
    blockedRuns: input.compliance.reduce((sum, row) => sum + row.blockedExecutions, 0),
    folkSuggestions: input.suggestions.filter((row) => row.status === "open").length,
    folkUsageHits: input.suggestions.reduce((sum, row) => sum + row.occurrenceCount, 0),
  };
}
