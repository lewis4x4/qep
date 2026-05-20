import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { computeWinProbability } from "./win-probability-scorer";
import { computeWinProbabilityRisks } from "./win-probability-risks";

export type DealIqTone = "positive" | "warning" | "danger" | "muted";
export type DealIqRiskSeverity = "critical" | "warning" | "info";

export interface DealIqPolicyInput {
  standardMarginFloorPct: number | null;
  tradeCreditMax: number | null;
  repDiscountMaxPct: number | null;
}

export interface DealIqComputedInput {
  subtotal: number;
  discountTotal: number;
  netTotal: number;
  marginAmount: number;
  marginPct: number;
}

export type DealIqGovernanceRiskId =
  | "margin_below_floor"
  | "trade_above_max"
  | "discount_above_cap";

export interface DealIqRisk {
  id: DealIqGovernanceRiskId | `win_probability:${string}`;
  severity: DealIqRiskSeverity;
  label: string;
  detail: string;
  source: "governance" | "win_probability";
}

export interface DealIqCommissionStatus {
  status: "ready" | "review_required" | "blocked" | "not_ready";
  label: string;
  detail: string;
  tone: DealIqTone;
}

export interface DealIqSummary {
  marginPctLabel: string;
  marginAmountLabel: string;
  winProbabilityScore: number;
  winProbabilityBand: "strong" | "healthy" | "mixed" | "at_risk";
  winProbabilityHeadline: string;
  commissionStatus: DealIqCommissionStatus;
  floorPct: number;
  policyCapsAvailable: boolean;
  risks: DealIqRisk[];
}

export interface ComputeDealIqSummaryInput {
  draft: Partial<QuoteWorkspaceDraft> & Pick<QuoteWorkspaceDraft, "tradeAllowance">;
  computed: DealIqComputedInput;
  policy: DealIqPolicyInput | null;
  marginBaselineMedianPct?: number | null;
  maxRisks?: number;
}

const DEFAULT_MARGIN_FLOOR_PCT = 10;
const DEFAULT_MAX_RISKS = 5;

function finiteNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value ?? NaN) ? Number(value) : null;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function marginFloor(policy: DealIqPolicyInput | null): number {
  const floor = finiteNumber(policy?.standardMarginFloorPct);
  return floor != null && floor > 0 ? floor : DEFAULT_MARGIN_FLOOR_PCT;
}

function riskGap(value: number): string {
  return Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function computeCommissionStatus(input: {
  subtotal: number;
  marginAmount: number;
  hasMarginFloorRisk: boolean;
}): DealIqCommissionStatus {
  if (input.subtotal <= 0) {
    return {
      status: "not_ready",
      label: "Not ready",
      detail: "Select customer-facing equipment before projecting commission status.",
      tone: "muted",
    };
  }
  if (input.marginAmount <= 0) {
    return {
      status: "blocked",
      label: "Blocked",
      detail: "Margin is at or below zero; commission eligibility needs manager review.",
      tone: "danger",
    };
  }
  if (input.hasMarginFloorRisk) {
    return {
      status: "review_required",
      label: "Review required",
      detail: "Margin is below the floor, so commission projection stays status-only until approval.",
      tone: "warning",
    };
  }
  return {
    status: "ready",
    label: "Status only",
    detail: "Margin is positive and above floor. No commission-dollar plan feed is connected yet.",
    tone: "positive",
  };
}

export function computeDealIqSummary(input: ComputeDealIqSummaryInput): DealIqSummary {
  const { draft, computed, policy } = input;
  const policyFloorPct = finiteNumber(policy?.standardMarginFloorPct);
  const floorPct = marginFloor(policy);
  const risks: DealIqRisk[] = [];
  const marginDelta = computed.marginPct - floorPct;
  const hasPricedQuote = computed.subtotal > 0;

  if (hasPricedQuote && computed.marginPct < floorPct) {
    risks.push({
      id: "margin_below_floor",
      severity: "critical",
      label: "Margin below floor",
      detail: `${formatPct(computed.marginPct)} is ${riskGap(marginDelta)} pts below the ${formatPct(floorPct)} floor.`,
      source: "governance",
    });
  }

  const tradeCreditMax = finiteNumber(policy?.tradeCreditMax);
  const tradeAllowance = finiteNumber(draft.tradeAllowance) ?? 0;
  if (hasPricedQuote && tradeCreditMax != null && tradeAllowance > tradeCreditMax) {
    risks.push({
      id: "trade_above_max",
      severity: "warning",
      label: "Trade above max",
      detail: `${formatMoney(tradeAllowance)} trade credit exceeds the ${formatMoney(tradeCreditMax)} cap.`,
      source: "governance",
    });
  }

  const repDiscountMaxPct = finiteNumber(policy?.repDiscountMaxPct);
  const discountPct = computed.subtotal > 0 ? (computed.discountTotal / computed.subtotal) * 100 : 0;
  if (repDiscountMaxPct != null && computed.subtotal > 0 && discountPct > repDiscountMaxPct) {
    risks.push({
      id: "discount_above_cap",
      severity: "warning",
      label: "Discount above cap",
      detail: `${formatPct(discountPct)} discount exceeds the ${formatPct(repDiscountMaxPct)} rep cap.`,
      source: "governance",
    });
  }

  const winProbability = computeWinProbability(draft, {
    marginPct: computed.marginPct,
    marginBaselineMedianPct: input.marginBaselineMedianPct ?? null,
  });
  const winRisks = computeWinProbabilityRisks(winProbability).map((risk): DealIqRisk => ({
    id: `win_probability:${risk.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    severity: "info",
    label: `Win probability: ${risk.label}`,
    detail: risk.rationale,
    source: "win_probability",
  }));

  const maxRisks = Math.max(0, input.maxRisks ?? DEFAULT_MAX_RISKS);
  const cappedRisks = [...risks, ...winRisks].slice(0, maxRisks);

  return {
    marginPctLabel: formatPct(computed.marginPct),
    marginAmountLabel: formatMoney(computed.marginAmount),
    winProbabilityScore: winProbability.score,
    winProbabilityBand: winProbability.band,
    winProbabilityHeadline: winProbability.headline,
    commissionStatus: computeCommissionStatus({
      subtotal: computed.subtotal,
      marginAmount: computed.marginAmount,
      hasMarginFloorRisk: risks.some((risk) => risk.id === "margin_below_floor"),
    }),
    floorPct,
    policyCapsAvailable: policy !== null && policyFloorPct != null && policyFloorPct > 0,
    risks: cappedRisks,
  };
}
