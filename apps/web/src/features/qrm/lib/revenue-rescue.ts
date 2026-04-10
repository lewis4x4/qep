import type { QrmWeightedDeal } from "./types";
import type { TimeBankRow } from "./time-bank";
import type { QuoteVelocityRow } from "../command-center/lib/quoteVelocity";
import type { BlockedDeal } from "../command-center/lib/blockerTypes";

export interface RevenueRescueCandidate {
  dealId: string;
  dealName: string;
  companyId: string | null;
  companyName: string;
  amount: number;
  weightedAmount: number;
  blockerCategory: string | null;
  quoteIssue: string | null;
  isOverTime: boolean;
  priorityScore: number;
  reasons: string[];
}

export interface RevenueRescueSummary {
  candidateCount: number;
  saveableWeightedRevenue: number;
  blockedCount: number;
  quoteAtRiskCount: number;
  overTimeCount: number;
}

export interface RevenueRescueBoard {
  summary: RevenueRescueSummary;
  candidates: RevenueRescueCandidate[];
}

export function buildRevenueRescueBoard(input: {
  deals: QrmWeightedDeal[];
  timeBankRows: TimeBankRow[];
  quoteRows: QuoteVelocityRow[];
  blockedDeals: BlockedDeal[];
}): RevenueRescueBoard {
  const timeBankByDeal = new Map(input.timeBankRows.map((row) => [row.deal_id, row]));
  const quoteByDeal = new Map<string, QuoteVelocityRow>();
  for (const row of input.quoteRows) {
    if (!row.dealId) continue;
    if (!quoteByDeal.has(row.dealId)) quoteByDeal.set(row.dealId, row);
  }
  const blockerByDeal = new Map(input.blockedDeals.map((row) => [row.dealId, row]));

  const candidates: RevenueRescueCandidate[] = [];

  for (const deal of input.deals) {
    const reasons: string[] = [];
    let score = 0;
    const blocker = blockerByDeal.get(deal.id) ?? null;
    const quote = quoteByDeal.get(deal.id) ?? null;
    const time = timeBankByDeal.get(deal.id) ?? null;

    if (blocker) {
      reasons.push(blocker.detail);
      score += 40;
    }

    let quoteIssue: string | null = null;
    if (quote?.isAging) {
      quoteIssue = `quote aging ${quote.ageDays}d`;
      reasons.push(quoteIssue);
      score += 25;
    } else if (quote?.isExpiringSoon) {
      quoteIssue = quote.daysUntilExpiry != null && quote.daysUntilExpiry <= 0
        ? "quote expired"
        : `quote expires in ${quote?.daysUntilExpiry}d`;
      reasons.push(quoteIssue);
      score += 20;
    } else if (quote?.requiresRequote) {
      quoteIssue = "requote required";
      reasons.push(quoteIssue);
      score += 15;
    }

    const isOverTime = Boolean(time?.is_over);
    if (isOverTime) {
      reasons.push(`stage time exceeded by ${Math.abs(time?.remaining_days ?? 0)}d`);
      score += 20;
    } else if ((time?.pct_used ?? 0) >= 0.85) {
      reasons.push(`stage time ${Math.round((time?.pct_used ?? 0) * 100)}% consumed`);
      score += 10;
    }

    if (reasons.length === 0) continue;

    score += Math.min(30, Math.round((deal.weightedAmount ?? 0) / 25_000) * 5);

    candidates.push({
      dealId: deal.id,
      dealName: deal.name,
      companyId: deal.companyId,
      companyName: "—",
      amount: deal.amount ?? 0,
      weightedAmount: deal.weightedAmount ?? 0,
      blockerCategory: blocker?.category ?? null,
      quoteIssue,
      isOverTime,
      priorityScore: score,
      reasons,
    });
  }

  candidates.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return b.weightedAmount - a.weightedAmount;
  });

  return {
    summary: {
      candidateCount: candidates.length,
      saveableWeightedRevenue: candidates.reduce((sum, row) => sum + row.weightedAmount, 0),
      blockedCount: candidates.filter((row) => row.blockerCategory != null).length,
      quoteAtRiskCount: candidates.filter((row) => row.quoteIssue != null).length,
      overTimeCount: candidates.filter((row) => row.isOverTime).length,
    },
    candidates,
  };
}
