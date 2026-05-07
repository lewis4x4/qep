import type { QuotePDFData } from "../components/QuotePDFDocument";
import type { QuoteWorkspaceComputed } from "./quote-workspace";
import type {
  QuoteFinanceScenario,
  QuoteLineItemDraft,
  QuoteLineItemKind,
  QuoteRecommendation,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

type ProposalLineTone = "charge" | "credit";

const CREDIT_LINE_KINDS = new Set<QuoteLineItemKind>([
  "discount",
  "rebate_mfg",
  "rebate_dealer",
  "loyalty_discount",
  "trade_allowance",
]);

const TAX_PROFILE_LABELS: Record<QuoteTaxProfile, string> = {
  standard: "Standard taxable",
  agriculture_exempt: "Agriculture exempt",
  fire_mitigation_exempt: "Fire mitigation exempt",
  government_exempt: "Government exempt",
  resale_exempt: "Resale exempt",
};

const FINANCING_DISCLOSURE = "Financing and lease payments shown are estimates for proposal discussion only. They are not a credit approval, commitment to lend, or final Truth in Lending Act disclosure. Final APR, payment, term, fees, taxes, and finance charges are subject to lender approval, signed finance documents, and applicable law.";
const PROPOSAL_DISCLOSURE = "This proposal is prepared for the named customer only. Prices, incentives, freight, tax, delivery timing, financing, and availability are subject to final confirmation and prior sale. Dealer cost, margin, and internal approval details are intentionally excluded from customer-facing proposal output.";

function money(value: number | null | undefined): number {
  return Number.isFinite(value ?? NaN) ? Math.round(Math.max(0, Number(value)) * 100) / 100 : 0;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function lineExtendedAmount(line: Pick<QuoteLineItemDraft, "quantity" | "unitPrice">): number {
  const raw = Number(line.quantity) * Number(line.unitPrice);
  return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0;
}

function displayMoney(value: number, tone: ProposalLineTone): number {
  const normalized = tone === "credit" ? Math.abs(value) : Math.max(0, value);
  return Math.round(normalized * 100) / 100;
}

function lineDescription(line: QuoteLineItemDraft): string {
  const machine = [line.year, line.make, line.model].filter(Boolean).join(" ").trim();
  return optionalText(machine) ?? optionalText(line.title) ?? "Line item";
}

function toProposalLine(line: QuoteLineItemDraft, fallbackType?: QuoteLineItemKind): QuotePDFData["lineItems"][number] {
  const lineType = line.kind ?? fallbackType ?? "custom";
  const tone: ProposalLineTone = CREDIT_LINE_KINDS.has(lineType) ? "credit" : "charge";
  const extendedPrice = lineExtendedAmount(line);
  return {
    lineType,
    description: lineDescription(line),
    make: optionalText(line.make),
    model: optionalText(line.model),
    year: line.year ?? null,
    quantity: Number.isFinite(line.quantity) ? line.quantity : 1,
    unitPrice: displayMoney(line.unitPrice, tone),
    extendedPrice: displayMoney(extendedPrice, tone),
    displayAmount: displayMoney(extendedPrice, tone),
    tone,
    reasonCode: optionalText(line.reasonCode ?? null),
  };
}

function buildLineItems(draft: QuoteWorkspaceDraft, computed: Pick<QuoteWorkspaceComputed, "discountTotal">): QuotePDFData["lineItems"] {
  const lines = [
    ...draft.equipment.map((line) => toProposalLine(line, "equipment")),
    ...draft.attachments.map((line) => toProposalLine(line, "attachment")),
    ...(draft.pricingLines ?? []).map((line) => toProposalLine(line)),
  ];

  const explicitCreditTotal = lines
    .filter((line) => line.tone === "credit" && line.lineType !== "trade_allowance")
    .reduce((sum, line) => sum + line.displayAmount, 0);
  const remainingCommercialDiscount = money(computed.discountTotal - explicitCreditTotal);
  if (remainingCommercialDiscount > 0) {
    lines.push({
      lineType: "discount",
      description: "Commercial discount",
      make: null,
      model: null,
      year: null,
      quantity: 1,
      unitPrice: remainingCommercialDiscount,
      extendedPrice: remainingCommercialDiscount,
      displayAmount: remainingCommercialDiscount,
      tone: "credit",
      reasonCode: null,
    });
  }

  if (draft.tradeAllowance > 0) {
    lines.push({
      lineType: "trade_allowance",
      description: "Trade-in allowance",
      make: null,
      model: null,
      year: null,
      quantity: 1,
      unitPrice: money(draft.tradeAllowance),
      extendedPrice: money(draft.tradeAllowance),
      displayAmount: money(draft.tradeAllowance),
      tone: "credit",
      reasonCode: null,
    });
  }

  return lines;
}

function buildNarrative(draft: QuoteWorkspaceDraft): QuotePDFData["narrative"] {
  const recommendation: QuoteRecommendation | null = draft.recommendation ?? null;
  const confirmed = draft.whyThisMachineConfirmed === true;
  const confirmedText = confirmed ? optionalText(draft.whyThisMachine) : null;
  return {
    text: confirmedText,
    confirmed,
    facts: confirmed ? (recommendation?.jobFacts ?? []).filter((fact) => optionalText(fact.label) && optionalText(fact.value)) : [],
    highlights: confirmed
      ? (recommendation?.transcriptHighlights ?? [])
        .flatMap((item) => {
          const supports = optionalText(item.supports);
          return supports ? [{ quote: "", supports }] : [];
        })
      : [],
    considerations: confirmed ? (recommendation?.jobConsiderations ?? []).filter((item): item is string => Boolean(optionalText(item))) : [],
    alternative: confirmed && recommendation?.alternative
      ? {
          machine: optionalText(recommendation.alternative.machine) ?? "Alternative machine",
          attachments: recommendation.alternative.attachments ?? [],
          reasoning: optionalText(recommendation.alternative.reasoning) ?? "",
          whyNotChosen: optionalText(recommendation.alternative.whyNotChosen ?? null),
        }
      : null,
  };
}

function scenarioKind(scenario: QuoteFinanceScenario | null | undefined): QuotePDFData["compliance"]["selectedPaymentKind"] {
  if (!scenario) return "unknown";
  if (scenario.kind === "cash" || scenario.type === "cash") return "cash";
  if (scenario.type === "lease" || scenario.kind === "lease_fmv" || scenario.kind === "lease_fppo") return "lease";
  if (scenario.type === "finance" || scenario.kind === "finance") return "finance";
  return "unknown";
}

export function isDisplayableProposalFinanceScenario(scenario: QuotePDFData["financing"][number]): boolean {
  const kind = scenario.kind ?? scenario.type;
  if (kind === "cash" || scenario.type === "cash") {
    return scenario.monthlyPayment != null || (scenario.termMonths ?? 0) > 0 || (scenario.rate ?? 0) > 0 || (scenario.totalCost ?? 0) > 0;
  }
  return scenario.monthlyPayment != null || (scenario.termMonths ?? 0) > 0 || scenario.totalCost != null;
}

function buildFinancing(scenarios: QuoteFinanceScenario[]): QuotePDFData["financing"] {
  return scenarios.map((scenario) => ({
    type: scenario.type,
    kind: scenario.kind ?? (scenario.type === "cash" ? "cash" : scenario.type === "lease" ? "lease_fmv" : "finance"),
    label: scenario.label,
    termMonths: scenario.termMonths ?? null,
    rate: scenario.rate ?? scenario.apr ?? null,
    monthlyPayment: scenario.monthlyPayment ?? null,
    totalCost: scenario.totalCost ?? null,
    lender: scenario.lender ?? null,
    downPayment: scenario.downPayment ?? null,
    residualAmount: scenario.residualAmount ?? null,
    isDefault: scenario.isDefault ?? false,
  }));
}

function buildTaxDetail(draft: QuoteWorkspaceDraft): Pick<QuotePDFData["compliance"], "taxLabel" | "taxDetail"> {
  const profileLabel = TAX_PROFILE_LABELS[draft.taxProfile] ?? draft.taxProfile;
  if (draft.taxOverrideAmount != null) {
    return {
      taxLabel: "Tax override applied",
      taxDetail: `Manual tax override recorded${draft.taxOverrideReason ? `: ${draft.taxOverrideReason}` : ". Reason pending."}`,
    };
  }
  if (draft.taxProfile !== "standard") {
    return {
      taxLabel: "Tax profile",
      taxDetail: `Tax profile: ${profileLabel}. Exemption documentation may be required before final delivery.`,
    };
  }
  const jurisdiction = [draft.deliveryCounty, draft.deliveryState].filter(Boolean).join(", ");
  return {
    taxLabel: "Estimated tax",
    taxDetail: jurisdiction ? `Estimated tax based on ${jurisdiction}.` : "Estimated tax subject to final jurisdiction confirmation.",
  };
}

function formatDate(value: string | null | undefined): string | null {
  const text = optionalText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString();
}

export function buildQuoteProposalData(input: {
  draft: QuoteWorkspaceDraft;
  computed: Pick<QuoteWorkspaceComputed,
    | "equipmentTotal"
    | "attachmentTotal"
    | "pricingLineTotal"
    | "subtotal"
    | "discountTotal"
    | "netTotal"
    | "taxTotal"
    | "customerTotal"
    | "cashDown"
    | "amountFinanced"
  >;
  financeScenarios: QuoteFinanceScenario[];
  quoteNumber?: string | null;
  preparedBy: string;
  preparedDate: string;
  branch: QuotePDFData["branch"];
}): QuotePDFData {
  const { draft, computed } = input;
  const financing = buildFinancing(input.financeScenarios);
  const selectedScenario = input.financeScenarios.find((scenario) => scenario.label === draft.selectedFinanceScenario) ?? null;
  const selectedPaymentKind = scenarioKind(selectedScenario);
  const hasDisplayedFinanceOrLease = financing.some((scenario) => isDisplayableProposalFinanceScenario(scenario) && scenario.type !== "cash");
  const tax = buildTaxDetail(draft);
  const primaryEquipment = draft.equipment[0] ?? null;

  return {
    dealName: draft.dealId || draft.customerCompany || draft.customerName || "Quote",
    customerName: draft.customerName || draft.customerCompany || "Customer",
    quoteNumber: input.quoteNumber ?? null,
    preparedBy: input.preparedBy,
    preparedDate: input.preparedDate,
    aiRecommendationSummary: null,
    equipment: draft.equipment.map((item) => ({
      make: item.make ?? "",
      model: item.model ?? item.title,
      year: item.year ?? null,
      price: money(item.unitPrice),
      quantity: item.quantity,
      extendedPrice: money(lineExtendedAmount(item)),
    })),
    attachments: draft.attachments.map((item) => ({
      name: item.title,
      price: money(item.unitPrice),
      quantity: item.quantity,
      extendedPrice: money(lineExtendedAmount(item)),
    })),
    lineItems: buildLineItems(draft, computed),
    narrative: buildNarrative(draft),
    equipmentTotal: money(computed.equipmentTotal),
    attachmentTotal: money(computed.attachmentTotal),
    pricingLineTotal: money(computed.pricingLineTotal),
    subtotal: money(computed.subtotal),
    discountTotal: money(computed.discountTotal),
    tradeAllowance: money(draft.tradeAllowance),
    taxTotal: money(computed.taxTotal),
    customerTotal: money(computed.customerTotal),
    cashDown: money(computed.cashDown),
    amountFinanced: money(computed.amountFinanced),
    netTotal: money(computed.netTotal),
    financing,
    selectedFinancingLabel: draft.selectedFinanceScenario,
    primaryMachineTitle: primaryEquipment ? lineDescription(primaryEquipment) : null,
    deliveryEta: formatDate(draft.deliveryEta),
    depositRequiredAmount: draft.depositRequiredAmount ?? null,
    specialTerms: optionalText(draft.specialTerms),
    validUntil: formatDate(draft.expiresAt) ?? input.branch.footerText ?? null,
    compliance: {
      validUntil: formatDate(draft.expiresAt) ?? null,
      specialTerms: optionalText(draft.specialTerms),
      taxLabel: tax.taxLabel,
      taxDetail: tax.taxDetail,
      financingDisclaimer: hasDisplayedFinanceOrLease ? FINANCING_DISCLOSURE : "Payment terms shown are estimates and remain subject to final QEP confirmation.",
      proposalDisclaimer: PROPOSAL_DISCLOSURE,
      selectedPaymentKind,
      primaryTotalLabel: selectedPaymentKind === "finance" || selectedPaymentKind === "lease" ? "Amount financed" : "Customer total",
    },
    branch: input.branch,
  };
}
