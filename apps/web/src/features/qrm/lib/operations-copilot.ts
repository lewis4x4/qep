import type { QrmWeightedDeal } from "./types";

export type OpsCopilotCategory = "incomplete_deals" | "delayed_deposits" | "billing_handoff";
export type OpsCopilotConfidence = "high" | "medium" | "low";

export interface OpsCopilotDepositRow {
  id: string;
  dealId: string;
  status: string;
  requiredAmount: number;
  createdAt: string;
  receivedAt: string | null;
  verificationCycleHours: number | null;
}

export interface OpsCopilotBillingDraftRow {
  id: string;
  serviceJobId: string;
  createdAt: string;
  lineTotal: number | null;
  description: string | null;
  status: string;
}

export interface OpsCopilotInvoiceRoutingRow {
  id: string;
  invoiceNumber: string;
  serviceJobId: string | null;
  status: string;
}

export interface OpsCopilotRecommendation {
  key: string;
  category: OpsCopilotCategory;
  headline: string;
  confidence: OpsCopilotConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface OpsCopilotBoard {
  summary: {
    recommendationCount: number;
    incompleteDeals: number;
    delayedDeposits: number;
    billingIssues: number;
  };
  recommendations: OpsCopilotRecommendation[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function diffDays(from: string | null | undefined, nowTime: number): number | null {
  const parsed = parseTime(from);
  if (parsed == null) return null;
  return Math.floor((nowTime - parsed) / 86_400_000);
}

export function buildOperationsCopilotBoard(input: {
  deals: QrmWeightedDeal[];
  deposits: OpsCopilotDepositRow[];
  billingDrafts: OpsCopilotBillingDraftRow[];
  invoicesMissingBranch: OpsCopilotInvoiceRoutingRow[];
  nowTime?: number;
}): OpsCopilotBoard {
  const nowTime = input.nowTime ?? Date.now();
  const recommendations: OpsCopilotRecommendation[] = [];

  const incompleteDeals = input.deals.filter((deal) =>
    deal.primaryContactId == null ||
    deal.companyId == null ||
    deal.expectedCloseOn == null ||
    deal.amount == null,
  );

  if (incompleteDeals.length > 0) {
    const highValue = incompleteDeals
      .slice()
      .sort((a, b) => (b.weightedAmount ?? 0) - (a.weightedAmount ?? 0))[0] ?? null;
    recommendations.push({
      key: "complete-deals",
      category: "incomplete_deals",
      headline: "Complete critical deal records before operations carries the risk",
      confidence: incompleteDeals.length >= 3 ? "high" : "medium",
      trace: [
        `${incompleteDeals.length} open deal${incompleteDeals.length === 1 ? "" : "s"} are missing a critical field.`,
        highValue ? `Largest incomplete deal: ${highValue.name}.` : "No high-value incomplete deal identified.",
        "Critical fields checked: amount, expected close date, primary contact, and company.",
      ],
      actionLabel: "Open deals",
      href: "/qrm/deals",
    });
  }

  const delayedDeposits = input.deposits.filter((deposit) => {
    const ageDays = diffDays(deposit.receivedAt ?? deposit.createdAt, nowTime) ?? 0;
    if (deposit.status === "received") return ageDays >= 2;
    return (deposit.status === "pending" || deposit.status === "requested") && ageDays >= 7;
  });

  if (delayedDeposits.length > 0) {
    const totalExposure = delayedDeposits.reduce((sum, row) => sum + row.requiredAmount, 0);
    recommendations.push({
      key: "clear-deposits",
      category: "delayed_deposits",
      headline: "Clear delayed deposits before they freeze order flow",
      confidence: delayedDeposits.some((row) => row.status === "received") ? "high" : "medium",
      trace: [
        `${delayedDeposits.length} deposit${delayedDeposits.length === 1 ? "" : "s"} are aging beyond the operating threshold.`,
        `Total delayed exposure is $${Math.round(totalExposure).toLocaleString()}.`,
        delayedDeposits.some((row) => row.verificationCycleHours != null)
          ? "Verification-cycle-hour telemetry is already present on delayed rows."
          : "Delay was inferred from created/received timestamps.",
      ],
      actionLabel: "Open blockers",
      href: "/qrm/command/blockers",
    });
  }

  const staleDrafts = input.billingDrafts.filter((row) => {
    const ageDays = diffDays(row.createdAt, nowTime) ?? 0;
    return row.status === "draft" && ageDays >= 2;
  });
  const billingIssues = staleDrafts.length + input.invoicesMissingBranch.length;

  if (billingIssues > 0) {
    const draftTotal = staleDrafts.reduce((sum, row) => sum + (row.lineTotal ?? 0), 0);
    recommendations.push({
      key: "billing-handoff",
      category: "billing_handoff",
      headline: "Repair billing handoffs before revenue leaks into rework",
      confidence: input.invoicesMissingBranch.length > 0 ? "high" : "medium",
      trace: [
        `${staleDrafts.length} draft billing line${staleDrafts.length === 1 ? "" : "s"} have been sitting for 48h or longer.`,
        `${input.invoicesMissingBranch.length} service invoice${input.invoicesMissingBranch.length === 1 ? "" : "s"} are missing branch routing.`,
        draftTotal > 0 ? `Stale draft value totals $${Math.round(draftTotal).toLocaleString()}.` : "No staged line totals were available.",
      ],
      actionLabel: "Open service invoice",
      href: "/service/invoice",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      key: "ops-steady",
      category: "incomplete_deals",
      headline: "Operations posture is steady; keep the queues clean and watch for the next exception",
      confidence: "low",
      trace: [
        "No incomplete-deal, delayed-deposit, or billing-handoff issue is currently elevated.",
        `Open deals checked: ${input.deals.length}.`,
        `Deposits checked: ${input.deposits.length}.`,
      ],
      actionLabel: "Open command center",
      href: "/qrm",
    });
  }

  return {
    summary: {
      recommendationCount: recommendations.length,
      incompleteDeals: incompleteDeals.length,
      delayedDeposits: delayedDeposits.length,
      billingIssues,
    },
    recommendations,
  };
}
