/**
 * Command Center morning brief — risk copy and next-move navigation derived from
 * live command-strip / chief-of-staff payloads (never product manifesto strings).
 */

import type {
  CommandStripPayload,
  RecommendationCardPayload,
} from "../api/commandCenter.types";

export const MANIFESTO_RISK_STRINGS = [
  "dashboard instead of a command lane",
  "hide in plain sight",
  "top brief",
] as const;

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function accountLabel(bestMove: RecommendationCardPayload): string | null {
  return bestMove.companyName ?? bestMove.contactName ?? null;
}

function riskLineFromRationale(
  bestMove: RecommendationCardPayload,
  skipLine: string | null,
): string | null {
  const isRiskFact = (line: string): boolean => {
    const lower = line.toLowerCase();
    return (
      lower.includes("deposit") ||
      lower.includes("margin") ||
      lower.includes("anomaly") ||
      lower.includes("overdue") ||
      lower.includes("no activity") ||
      lower.includes("sentiment") ||
      lower.includes("competitor")
    );
  };

  for (const line of bestMove.rationale) {
    if (!line || line === skipLine) continue;
    if (isRiskFact(line)) {
      return line.replace(/\.$/, "");
    }
  }

  if (skipLine && isRiskFact(skipLine)) {
    return skipLine.replace(/\.$/, "");
  }

  return null;
}

function deriveRiskFromBestMove(bestMove: RecommendationCardPayload, skipLine: string | null): string {
  const fromRationale = riskLineFromRationale(bestMove, skipLine);
  const name = accountLabel(bestMove);
  const dealRef = name ? `${name}'s deal` : "This deal";

  if (fromRationale) {
    if (fromRationale.toLowerCase().includes("deposit")) {
      return `${dealRef} can't fund until the deposit clears — ${fromRationale}.`;
    }
    if (fromRationale.toLowerCase().includes("margin")) {
      return `${dealRef} is blocked at close & funding — ${fromRationale}.`;
    }
    if (fromRationale.toLowerCase().includes("anomaly")) {
      return `${dealRef} has a critical scan flag — ${fromRationale}.`;
    }
    if (fromRationale.toLowerCase().includes("overdue")) {
      if (name && bestMove.amount && bestMove.amount > 0) {
        return `${name}: follow-up is overdue — skip today and ${formatCurrency(bestMove.amount)} slips off the month.`;
      }
      return "This follow-up is already past the stall line. Call today or the deal goes cold.";
    }
    if (fromRationale.toLowerCase().includes("no activity")) {
      const cold =
        bestMove.amount && bestMove.amount > 0
          ? `${formatCurrency(bestMove.amount)} on ${name ?? "this deal"} goes cold`
          : `${dealRef} goes cold`;
      return `${fromRationale} — act today or ${cold}.`;
    }
    return `${dealRef}: ${fromRationale} — ignore it today and close timing slips.`;
  }

  if (bestMove.lane === "blockers") {
    return `${dealRef} can't advance until the blocker clears — close and funding stay frozen.`;
  }

  if (bestMove.lane === "revenue_at_risk") {
    if (name && bestMove.amount && bestMove.amount > 0) {
      return `${formatCurrency(bestMove.amount)} at ${name} walks if you don't touch it today.`;
    }
    return "This follow-up is already past the stall line. Call today or the deal goes cold.";
  }

  if (bestMove.amount && bestMove.amount > 0) {
    return `${formatCurrency(bestMove.amount)} is closable — delay the touch and stall risk pulls it off the month.`;
  }

  return name
    ? `${name} is ready to close — wait and the window narrows.`
    : "The top closable deal needs a touch today before the window narrows.";
}

function deriveRiskFromStrip(strip: CommandStripPayload): string {
  const { blockedDeals, overdueFollowUps, atRiskRevenue } = strip;

  if (blockedDeals > 0) {
    return `${blockedDeals} blocked deal${blockedDeals === 1 ? "" : "s"} can't fund or deliver until cleared — revenue sits frozen.`;
  }

  if (overdueFollowUps > 0 && atRiskRevenue > 0) {
    return `${formatCurrency(atRiskRevenue)} exposed across ${overdueFollowUps} overdue follow-up${overdueFollowUps === 1 ? "" : "s"} — each missed day raises stall risk.`;
  }

  if (overdueFollowUps > 0) {
    return `${overdueFollowUps} follow-up${overdueFollowUps === 1 ? "" : "s"} overdue — call today or deals go cold.`;
  }

  if (atRiskRevenue > 0) {
    return `${formatCurrency(atRiskRevenue)} flagged at risk — without action today that exposure grows.`;
  }

  return "Keep the next touch scheduled so open deals don't drift into stall.";
}

export function deriveCommandCenterRiskIfIgnored(input: {
  commandStrip: CommandStripPayload | null | undefined;
  bestMove: RecommendationCardPayload | null | undefined;
  nextMoveDetailLine: string | null;
}): string {
  const { commandStrip, bestMove, nextMoveDetailLine } = input;

  if (bestMove) {
    return deriveRiskFromBestMove(bestMove, nextMoveDetailLine);
  }

  if (commandStrip) {
    return deriveRiskFromStrip(commandStrip);
  }

  return "Keep the next touch scheduled so open deals don't drift into stall.";
}

export function containsManifestoRiskCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return MANIFESTO_RISK_STRINGS.some((snippet) => lower.includes(snippet));
}

/** One-tap target when the chief-of-staff card carries a real entity + href. */
export function getNextMoveTargetHref(
  bestMove: RecommendationCardPayload | null | undefined,
): string | null {
  if (!bestMove?.entityId?.trim()) return null;
  const href = bestMove.primaryAction?.href?.trim();
  return href || null;
}

export function getNextMoveActionLabel(
  bestMove: RecommendationCardPayload | null | undefined,
): string | null {
  if (!bestMove) return null;
  const label = bestMove.primaryAction?.label?.trim();
  return label || "Open";
}
