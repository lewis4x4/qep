import type { QuotePDFData, QuotePDFFinancingScenario, QuoteProposalLine } from "../components/QuotePDFDocument";
import { isDisplayableProposalFinanceScenario } from "./quote-proposal-data";
import type {
  QuotePdfVersionFinanceSnapshot,
  QuotePdfVersionLineSnapshot,
  QuotePdfVersionSnapshot,
} from "../../../../../../shared/qep-moonshot-contracts";

export interface BuildQuotePdfVersionSnapshotOptions {
  quotePackageId?: string | null;
  quotePackageVersionId?: string | null;
}

function money(value: number | null | undefined): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function nullableMoney(value: number | null | undefined): number | null {
  if (value == null) return null;
  return money(value);
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeKeyPart(value: string | number | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function lineDiffKey(line: QuoteProposalLine, occurrence: number): string {
  const rawBaseKey = optionalText(line.diffKey) ?? [
    line.lineType,
    normalizeKeyPart(line.description),
  ].join("|");
  const rawKey = `${rawBaseKey}|${occurrence}`;
  return `line:${stableHash(rawKey)}`;
}

function buildLineSnapshots(lines: QuoteProposalLine[]): QuotePdfVersionLineSnapshot[] {
  const occurrences = new Map<string, number>();
  return lines.map((line) => {
    const explicitKey = optionalText(line.diffKey);
    const base = explicitKey ? `explicit|${explicitKey}` : `${line.lineType}|${normalizeKeyPart(line.description)}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return {
      diffKey: lineDiffKey(line, occurrence),
      lineType: line.lineType,
      description: optionalText(line.description) ?? "Line item",
      quantity: money(line.quantity),
      unitPrice: money(line.unitPrice),
      extendedPrice: money(line.extendedPrice),
      displayAmount: money(line.displayAmount),
      tone: line.tone,
    };
  });
}

function buildFinanceSnapshot(scenario: QuotePDFFinancingScenario): QuotePdfVersionFinanceSnapshot {
  return {
    type: scenario.type,
    kind: scenario.kind ?? null,
    label: optionalText(scenario.label) ?? scenario.kind ?? scenario.type,
    termMonths: nullableMoney(scenario.termMonths),
    rate: nullableMoney(scenario.rate),
    monthlyPayment: nullableMoney(scenario.monthlyPayment),
    totalCost: nullableMoney(scenario.totalCost),
    lender: optionalText(scenario.lender),
    downPayment: nullableMoney(scenario.downPayment),
    residualAmount: nullableMoney(scenario.residualAmount),
    isDefault: scenario.isDefault === true,
  };
}

export function buildQuotePdfVersionSnapshot(
  data: QuotePDFData,
  options: BuildQuotePdfVersionSnapshotOptions = {},
): QuotePdfVersionSnapshot {
  return {
    quotePackageId: options.quotePackageId ?? null,
    quotePackageVersionId: options.quotePackageVersionId ?? null,
    quoteNumber: optionalText(data.quoteNumber),
    customerName: optionalText(data.customerName),
    preparedDate: optionalText(data.preparedDate),
    lineItems: buildLineSnapshots(data.lineItems),
    totals: {
      equipmentTotal: money(data.equipmentTotal),
      attachmentTotal: money(data.attachmentTotal),
      pricingLineTotal: money(data.pricingLineTotal),
      subtotal: money(data.subtotal),
      discountTotal: money(data.discountTotal),
      tradeAllowance: money(data.tradeAllowance),
      taxTotal: money(data.taxTotal),
      customerTotal: money(data.customerTotal),
      cashDown: money(data.cashDown),
      amountFinanced: money(data.amountFinanced),
      netTotal: money(data.netTotal),
    },
    financing: data.financing
      .filter(isDisplayableProposalFinanceScenario)
      .slice(0, 3)
      .map(buildFinanceSnapshot),
    terms: {
      validUntil: optionalText(data.validUntil ?? data.compliance.validUntil),
      deliveryEta: optionalText(data.deliveryEta),
      depositRequiredAmount: nullableMoney(data.depositRequiredAmount),
      specialTerms: optionalText(data.specialTerms) ?? "Standard QEP proposal terms apply; final terms confirmed at signature.",
      taxLabel: optionalText(data.compliance.taxLabel),
      taxDetail: optionalText(data.compliance.taxDetail),
    },
    narrativeText: data.narrative.confirmed ? optionalText(data.narrative.text) : null,
    publicLandingUrl: optionalText(data.publicLandingUrl),
  };
}
