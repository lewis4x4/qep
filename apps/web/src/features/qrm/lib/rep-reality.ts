export interface RepRealityDeal {
  dealId: string;
  dealName: string;
  companyName: string;
  weightedAmount: number;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  pctUsed: number | null;
  isOver: boolean;
}

export interface RepRealitySummary {
  activeDeals: number;
  weightedRevenue: number;
  overdueFollowUps: number;
  overTimeDeals: number;
  voiceNotes30d: number;
  touches7d: number;
}

export interface RepRealityInsight {
  label: string;
  tone: "warn" | "neutral" | "good";
}

export interface RepRealityBoard {
  summary: RepRealitySummary;
  focusDeals: RepRealityDeal[];
  insights: RepRealityInsight[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildRepRealityBoard(input: {
  deals: RepRealityDeal[];
  voiceNotes30d: number;
  touches7d: number;
  nowTime?: number;
}): RepRealityBoard {
  const nowTime = input.nowTime ?? Date.now();
  const overdueFollowUps = input.deals.filter((deal) => {
    const nextFollowUp = parseTime(deal.nextFollowUpAt);
    return nextFollowUp != null && nextFollowUp < nowTime;
  }).length;
  const overTimeDeals = input.deals.filter((deal) => deal.isOver).length;

  const focusDeals = [...input.deals].sort((a, b) => {
    const aOverdue = a.nextFollowUpAt && (parseTime(a.nextFollowUpAt) ?? nowTime) < nowTime ? 1 : 0;
    const bOverdue = b.nextFollowUpAt && (parseTime(b.nextFollowUpAt) ?? nowTime) < nowTime ? 1 : 0;
    if (bOverdue !== aOverdue) return bOverdue - aOverdue;
    if (Number(b.isOver) !== Number(a.isOver)) return Number(b.isOver) - Number(a.isOver);
    return b.weightedAmount - a.weightedAmount;
  });

  const insights: RepRealityInsight[] = [];
  if (overdueFollowUps > 0) {
    insights.push({ label: `${overdueFollowUps} follow-up${overdueFollowUps === 1 ? "" : "s"} are overdue.`, tone: "warn" });
  }
  if (overTimeDeals > 0) {
    insights.push({ label: `${overTimeDeals} deal${overTimeDeals === 1 ? "" : "s"} have burned through stage time.`, tone: "warn" });
  }
  if (input.voiceNotes30d === 0) {
    insights.push({ label: "No voice notes logged in the last 30 days.", tone: "neutral" });
  }
  if (input.touches7d === 0) {
    insights.push({ label: "No activity touches logged in the last 7 days.", tone: "warn" });
  }
  if (insights.length === 0) {
    insights.push({ label: "Your pipeline hygiene is clear right now.", tone: "good" });
  }

  return {
    summary: {
      activeDeals: input.deals.length,
      weightedRevenue: input.deals.reduce((sum, deal) => sum + deal.weightedAmount, 0),
      overdueFollowUps,
      overTimeDeals,
      voiceNotes30d: input.voiceNotes30d,
      touches7d: input.touches7d,
    },
    focusDeals,
    insights,
  };
}
