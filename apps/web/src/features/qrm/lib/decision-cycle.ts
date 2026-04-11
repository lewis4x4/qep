export type DecisionCycleConfidence = "high" | "medium" | "low";

export interface DecisionCycleClosedDeal {
  id: string;
  name: string;
  createdAt: string;
  closedAt: string;
}

export interface DecisionCycleOpenDeal {
  id: string;
  name: string;
  createdAt: string;
  expectedCloseOn: string | null;
  nextFollowUpAt: string | null;
}

export interface DecisionCycleSignature {
  dealId: string;
  signedAt: string;
}

export interface DecisionCycleCadence {
  dealId: string;
  status: string;
  startedAt: string;
  overdueTouchpoints: number;
  pendingTouchpoints: number;
}

export interface DecisionCycleRow {
  key: string;
  title: string;
  confidence: DecisionCycleConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface DecisionCycleBoard {
  summary: {
    learnedCycleDays: number | null;
    signatureToCloseDays: number | null;
    activeDeals: number;
    driftCount: number;
  };
  rhythm: DecisionCycleRow[];
  syncGaps: DecisionCycleRow[];
  nextWindow: DecisionCycleRow[];
}

interface DecisionCycleSyncGapRow extends DecisionCycleRow {
  drifting: boolean;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const startTime = parseTime(start);
  const endTime = parseTime(end);
  if (startTime == null || endTime == null) return null;
  return Math.round((endTime - startTime) / 86_400_000);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function monthsUntil(targetMonth: number | null | undefined, nowMonth: number): number | null {
  if (!targetMonth || targetMonth < 1 || targetMonth > 12) return null;
  const zeroBasedTarget = targetMonth - 1;
  return (zeroBasedTarget - nowMonth + 12) % 12;
}

function monthLabel(month: number | null | undefined): string | null {
  if (!month || month < 1 || month > 12) return null;
  return new Date(2000, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function buildDecisionCycleBoard(input: {
  accountId: string;
  closedDeals: DecisionCycleClosedDeal[];
  openDeals: DecisionCycleOpenDeal[];
  signatures: DecisionCycleSignature[];
  cadences: DecisionCycleCadence[];
  budgetCycleMonth: number | null | undefined;
  seasonalPattern: string | null | undefined;
  nowTime?: number;
}): DecisionCycleBoard {
  const nowTime = input.nowTime ?? Date.now();
  const now = new Date(nowTime);
  const accountCommandHref = `/qrm/accounts/${input.accountId}/command`;
  const strategistHref = `/qrm/accounts/${input.accountId}/strategist`;

  const createdToClose = input.closedDeals
    .map((deal) => daysBetween(deal.createdAt, deal.closedAt))
    .filter((value): value is number => value != null);
  const learnedCycleDays = average(createdToClose);

  const signatureByDeal = new Map<string, DecisionCycleSignature[]>();
  for (const row of input.signatures) {
    const bucket = signatureByDeal.get(row.dealId) ?? [];
    bucket.push(row);
    signatureByDeal.set(row.dealId, bucket);
  }

  const signatureToCloseDays = average(
    input.closedDeals
      .map((deal) => {
        const signatures = signatureByDeal.get(deal.id) ?? [];
        const latestSignature = signatures
          .slice()
          .sort((a, b) => (parseTime(b.signedAt) ?? 0) - (parseTime(a.signedAt) ?? 0))[0];
        return latestSignature ? daysBetween(latestSignature.signedAt, deal.closedAt) : null;
      })
      .filter((value): value is number => value != null),
  );

  const budgetMonthLabel = monthLabel(input.budgetCycleMonth);
  const monthsToBudget = monthsUntil(input.budgetCycleMonth, now.getMonth());
  const seasonalPattern = input.seasonalPattern?.trim() ? titleize(input.seasonalPattern) : null;

  const rhythm: DecisionCycleRow[] = [
    {
      key: "historic-cycle",
      title: "Historic purchase rhythm",
      confidence: learnedCycleDays != null ? "high" : "low",
      trace: [
        learnedCycleDays != null
          ? `Closed deals average ${learnedCycleDays} days from creation to close.`
          : "No closed deal history is available yet.",
        `${input.closedDeals.length} historical deal${input.closedDeals.length === 1 ? "" : "s"} feed this cycle model.`,
      ],
      actionLabel: "Open account command",
      href: accountCommandHref,
    },
    {
      key: "signature-rhythm",
      title: "Commitment rhythm after signature",
      confidence: signatureToCloseDays != null ? "medium" : "low",
      trace: [
        signatureToCloseDays != null
          ? `Signed deals take about ${signatureToCloseDays} days from signature to close.`
          : "No signed-to-close history is available yet.",
        `${input.signatures.length} quote signature${input.signatures.length === 1 ? "" : "s"} are on record for this account.`,
      ],
      actionLabel: "Open strategist",
      href: strategistHref,
    },
    {
      key: "budget-seasonal-rhythm",
      title: "Budget and seasonal rhythm",
      confidence: budgetMonthLabel || seasonalPattern ? "medium" : "low",
      trace: [
        budgetMonthLabel
          ? `Budget cycle month is ${budgetMonthLabel}${monthsToBudget != null ? ` (${monthsToBudget} month${monthsToBudget === 1 ? "" : "s"} away).` : "."}`
          : "No explicit budget-cycle month is recorded.",
        seasonalPattern
          ? `Behavioral seasonality is tagged as ${seasonalPattern}.`
          : "No non-steady seasonal pattern is currently tagged.",
      ],
      actionLabel: "Open strategist",
      href: strategistHref,
    },
  ];

  const cadenceByDeal = new Map(input.cadences.map((row) => [row.dealId, row]));
  const syncGaps: DecisionCycleSyncGapRow[] = input.openDeals
    .map((deal) => {
      const cadence = cadenceByDeal.get(deal.id) ?? null;
      const ageDays = daysBetween(deal.createdAt, new Date(nowTime).toISOString()) ?? 0;
      const expectedLag = deal.expectedCloseOn ? daysBetween(new Date(nowTime).toISOString(), deal.expectedCloseOn) : null;
      const followUpLag = deal.nextFollowUpAt ? daysBetween(deal.nextFollowUpAt, new Date(nowTime).toISOString()) : null;
      const trace: string[] = [
        learnedCycleDays != null
          ? `Deal has been open ${ageDays} days against a learned ${learnedCycleDays}-day cycle.`
          : `Deal has been open ${ageDays} days.`,
        deal.expectedCloseOn
          ? `Expected close is ${deal.expectedCloseOn}.`
          : "No expected close date is recorded.",
        deal.nextFollowUpAt
          ? `Next follow-up is ${deal.nextFollowUpAt}.`
          : "No next follow-up date is recorded.",
      ];
      if (cadence) {
        trace.push(
          `${cadence.overdueTouchpoints} overdue cadence touchpoint${cadence.overdueTouchpoints === 1 ? "" : "s"} and ${cadence.pendingTouchpoints} pending.`,
        );
      } else {
        trace.push("No cadence is currently active on this deal.");
      }

      const isDrifting =
        (learnedCycleDays != null && ageDays > learnedCycleDays * 1.25) ||
        (followUpLag != null && followUpLag > 0) ||
        (cadence?.overdueTouchpoints ?? 0) > 0 ||
        expectedLag == null;

      const confidence: DecisionCycleConfidence = isDrifting
        ? "high"
        : expectedLag != null && expectedLag < 0
          ? "medium"
          : "low";

      return {
        key: deal.id,
        title: deal.name,
        confidence,
        trace,
        actionLabel: "Open deal",
        href: `/qrm/deals/${deal.id}`,
        drifting: isDrifting,
      };
    })
    .sort((a, b) => {
      const weight: Record<DecisionCycleConfidence, number> = { high: 3, medium: 2, low: 1 };
      return weight[b.confidence] - weight[a.confidence];
    })
    .slice(0, 6);

  const driftCount = syncGaps.filter((row) => row.drifting).length;

  const nextWindow: DecisionCycleRow[] = [];

  if (monthsToBudget != null && monthsToBudget <= 2) {
    nextWindow.push({
      key: "budget-window",
      title: "The next budget window is close enough to shape current deal timing",
      confidence: "high",
      trace: [
        `${budgetMonthLabel} is the recorded budget month for this account.`,
        `${monthsToBudget} month${monthsToBudget === 1 ? "" : "s"} remain until that window opens.`,
        `${input.openDeals.length} open deal${input.openDeals.length === 1 ? "" : "s"} need to be aligned to that window now.`,
      ],
      actionLabel: "Open strategist",
      href: strategistHref,
    });
  }

  if (seasonalPattern) {
    nextWindow.push({
      key: "seasonal-window",
      title: "Seasonal timing should synchronize the current pursuit plan",
      confidence: monthsToBudget != null && monthsToBudget <= 2 ? "high" : "medium",
      trace: [
        `Seasonal pattern is tagged as ${seasonalPattern}.`,
        learnedCycleDays != null
          ? `Use the learned ${learnedCycleDays}-day cycle to enter that window on time.`
          : "Historical cycle data is still forming, so use current deal cadence carefully.",
      ],
      actionLabel: "Open strategist",
      href: strategistHref,
    });
  }

  if (nextWindow.length === 0) {
    nextWindow.push({
      key: "default-sync",
      title: "No fixed window dominates, so synchronize to the learned close rhythm",
      confidence: learnedCycleDays != null ? "medium" : "low",
      trace: [
        learnedCycleDays != null
          ? `The best current rhythm anchor is the learned ${learnedCycleDays}-day purchase cycle.`
          : "No strong timing anchor is recorded yet; continue instrumenting close and signature timing.",
        `${driftCount} open deal${driftCount === 1 ? "" : "s"} are already drifting from the visible rhythm.`,
      ],
      actionLabel: "Open account command",
      href: accountCommandHref,
    });
  }

  return {
    summary: {
      learnedCycleDays,
      signatureToCloseDays,
      activeDeals: input.openDeals.length,
      driftCount,
    },
    rhythm,
    syncGaps,
    nextWindow,
  };
}
