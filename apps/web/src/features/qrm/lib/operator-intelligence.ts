import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

export interface OperatorVoiceSignal {
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  transcript: string | null;
  extractedData: ExtractedDealData | null;
}

export interface OperatorFeedbackSignal {
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  timeSaverNotes: string | null;
  serialSpecificNote: string | null;
  returnVisitRisk: string | null;
}

export interface OperatorIntelligenceAccount {
  companyId: string;
  companyName: string;
  concernCount: number;
  preferenceCount: number;
  highRiskCount: number;
  workaroundCount: number;
  latestAt: string | null;
  highlights: string[];
}

export interface OperatorIntelligenceSummary {
  accounts: number;
  concerns: number;
  preferences: number;
  highRiskReturns: number;
  workarounds: number;
}

export interface OperatorIntelligenceBoard {
  summary: OperatorIntelligenceSummary;
  accounts: OperatorIntelligenceAccount[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addHighlight(bucket: string[], value: string | null | undefined) {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!bucket.includes(trimmed)) bucket.push(trimmed);
}

export function buildOperatorIntelligenceBoard(input: {
  voiceSignals: OperatorVoiceSignal[];
  feedbackSignals: OperatorFeedbackSignal[];
}): OperatorIntelligenceBoard {
  const grouped = new Map<string, OperatorIntelligenceAccount>();
  let concernTotal = 0;
  let preferenceTotal = 0;
  let highRiskReturns = 0;
  let workaroundTotal = 0;

  const ensure = (companyId: string, companyName: string | null): OperatorIntelligenceAccount => {
    const existing = grouped.get(companyId);
    if (existing) return existing;
    const created: OperatorIntelligenceAccount = {
      companyId,
      companyName: companyName ?? "Account",
      concernCount: 0,
      preferenceCount: 0,
      highRiskCount: 0,
      workaroundCount: 0,
      latestAt: null,
      highlights: [],
    };
    grouped.set(companyId, created);
    return created;
  };

  for (const signal of input.voiceSignals) {
    if (!signal.companyId) continue;
    const row = ensure(signal.companyId, signal.companyName);
    const summary = signal.extractedData;
    const concern = summary?.opportunity.keyConcerns ?? null;
    const preferredChannel = summary?.record.preferredContactChannel ?? null;
    const newVsUsed = summary?.opportunity.newVsUsedPreference ?? null;
    const operatorSkill = summary?.operations.operatorSkillLevel ?? null;

    if (concern && concern !== "unknown") {
      row.concernCount += 1;
      concernTotal += 1;
      addHighlight(row.highlights, concern);
    }
    for (const value of [preferredChannel, newVsUsed, operatorSkill]) {
      if (value && value !== "unknown" && value !== "either" && value !== "none") {
        row.preferenceCount += 1;
        preferenceTotal += 1;
        addHighlight(row.highlights, value.replace(/_/g, " "));
      }
    }
    if (!row.latestAt || (parseTime(signal.createdAt) ?? 0) > (parseTime(row.latestAt) ?? 0)) {
      row.latestAt = signal.createdAt;
    }
  }

  for (const signal of input.feedbackSignals) {
    if (!signal.companyId) continue;
    const row = ensure(signal.companyId, signal.companyName);

    if (signal.returnVisitRisk === "high" || signal.returnVisitRisk === "medium") {
      row.highRiskCount += 1;
      highRiskReturns += 1;
      addHighlight(row.highlights, `return visit risk ${signal.returnVisitRisk}`);
    }
    for (const value of [signal.timeSaverNotes, signal.serialSpecificNote]) {
      if (value) {
        row.workaroundCount += 1;
        workaroundTotal += 1;
        addHighlight(row.highlights, value);
      }
    }
    if (!row.latestAt || (parseTime(signal.createdAt) ?? 0) > (parseTime(row.latestAt) ?? 0)) {
      row.latestAt = signal.createdAt;
    }
  }

  const accounts = [...grouped.values()].sort((a, b) => {
    if (b.concernCount !== a.concernCount) return b.concernCount - a.concernCount;
    if (b.highRiskCount !== a.highRiskCount) return b.highRiskCount - a.highRiskCount;
    return (parseTime(b.latestAt) ?? 0) - (parseTime(a.latestAt) ?? 0);
  });

  return {
    summary: {
      accounts: accounts.length,
      concerns: concernTotal,
      preferences: preferenceTotal,
      highRiskReturns,
      workarounds: workaroundTotal,
    },
    accounts,
  };
}
