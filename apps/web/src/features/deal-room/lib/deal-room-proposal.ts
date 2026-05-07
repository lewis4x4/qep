import type {
  DealRoomBranch,
  DealRoomLineItem,
  DealRoomQuote,
  DealRoomRecommendation,
} from "./deal-room-api";

const CREDIT_LINE_TYPES = new Set([
  "discount",
  "trade_allowance",
  "rebate_mfg",
  "rebate_dealer",
  "loyalty_discount",
]);

const TAX_PROFILE_LABELS: Record<string, string> = {
  standard: "Standard taxable sale",
  agriculture_exempt: "Agriculture exempt",
  fire_mitigation_exempt: "Fire mitigation exempt",
  government_exempt: "Government exempt",
  resale_exempt: "Resale exempt",
};

export interface DealRoomProposalLine {
  source: "public" | "legacy";
  lineType: string | null;
  label: string;
  detail: string | null;
  quantity: number;
  unitPrice: number | null;
  extendedPrice: number | null;
  displayAmount: number;
  tone: "charge" | "credit";
  isPrimaryEquipment: boolean;
}

export interface DealRoomCommercialDetail {
  label: string;
  value: string;
  detail?: string | null;
  tone?: "base" | "caution" | "success";
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lineLabel(row: DealRoomLineItem): string {
  const machine = [row.make, row.model].map(cleanText).filter(Boolean).join(" ").trim();
  return cleanText(row.description) ?? (machine || "Line item");
}

function lineDetail(row: DealRoomLineItem): string | null {
  const parts = [
    cleanText(row.make),
    cleanText(row.model),
    row.year ? `Model year ${row.year}` : null,
    row.reason_code ? `Reason: ${row.reason_code.replace(/_/g, " ")}` : null,
  ].filter((part): part is string => Boolean(part));
  const label = cleanText(row.description);
  const unique = parts.filter((part) => part !== label);
  return unique.length > 0 ? unique.join(" · ") : null;
}

function amountForPublicLine(row: DealRoomLineItem): number {
  const quantity = numberOrNull(row.quantity) ?? 1;
  const extended = numberOrNull(row.extended_price);
  if (extended != null) return extended;
  const unit = numberOrNull(row.unit_price) ?? 0;
  return unit * quantity;
}

function toPublicProposalLine(row: DealRoomLineItem, index: number): DealRoomProposalLine {
  const lineType = cleanText(row.line_type);
  const tone = lineType && CREDIT_LINE_TYPES.has(lineType) ? "credit" : "charge";
  const amount = Math.abs(amountForPublicLine(row));
  return {
    source: "public",
    lineType,
    label: lineLabel(row),
    detail: lineDetail(row),
    quantity: numberOrNull(row.quantity) ?? 1,
    unitPrice: numberOrNull(row.unit_price),
    extendedPrice: numberOrNull(row.extended_price),
    displayAmount: amount,
    tone,
    isPrimaryEquipment: lineType === "equipment" && index === 0,
  };
}

function legacyEquipmentLines(quote: DealRoomQuote): DealRoomProposalLine[] {
  return (quote.equipment ?? []).map((item, index) => ({
    source: "legacy" as const,
    lineType: "equipment",
    label: [item.make, item.model].map(cleanText).filter(Boolean).join(" ") || cleanText(item.title) || "Equipment",
    detail: item.year ? `Model year ${item.year}` : null,
    quantity: 1,
    unitPrice: numberOrNull(item.price),
    extendedPrice: numberOrNull(item.price),
    displayAmount: Math.abs(numberOrNull(item.price) ?? 0),
    tone: "charge" as const,
    isPrimaryEquipment: index === 0,
  }));
}

function legacyAttachmentLines(quote: DealRoomQuote): DealRoomProposalLine[] {
  return (quote.attachments_included ?? []).map((item) => ({
    source: "legacy" as const,
    lineType: "attachment",
    label: cleanText(item.name) ?? "Attachment",
    detail: "Attachment",
    quantity: 1,
    unitPrice: numberOrNull(item.price),
    extendedPrice: numberOrNull(item.price),
    displayAmount: Math.abs(numberOrNull(item.price) ?? 0),
    tone: "charge" as const,
    isPrimaryEquipment: false,
  }));
}

export function getConfirmedWhyThisMachine(quote: DealRoomQuote): string | null {
  return quote.why_this_machine_confirmed === true ? cleanText(quote.why_this_machine) : null;
}

export function getDealRoomRecommendationContext(quote: DealRoomQuote): DealRoomRecommendation | null {
  if (!getConfirmedWhyThisMachine(quote) || !quote.ai_recommendation) return null;
  return {
    ...quote.ai_recommendation,
    transcriptHighlights: (quote.ai_recommendation.transcriptHighlights ?? []).map((item) => ({
      quote: "",
      supports: item.supports,
    })),
  };
}

export function getProposalLineItems(quote: DealRoomQuote): DealRoomProposalLine[] {
  const publicRows = [...(quote.quote_package_line_items ?? [])]
    .sort((a, b) => (numberOrNull(a.display_order) ?? 9999) - (numberOrNull(b.display_order) ?? 9999));
  if (publicRows.length > 0) {
    return publicRows.map(toPublicProposalLine);
  }
  return [...legacyEquipmentLines(quote), ...legacyAttachmentLines(quote)];
}

export function getPrimaryProposalLine(quote: DealRoomQuote): DealRoomProposalLine | null {
  const lines = getProposalLineItems(quote);
  return lines.find((line) => line.lineType === "equipment") ?? lines[0] ?? null;
}

export function getAdditionalProposalLineItems(quote: DealRoomQuote): DealRoomProposalLine[] {
  const lines = getProposalLineItems(quote);
  let skippedPrimary = false;
  return lines.filter((line) => {
    if (!skippedPrimary && line.lineType === "equipment") {
      skippedPrimary = true;
      return false;
    }
    return true;
  });
}

export function taxProfileLabel(profile: string | null | undefined): string {
  const key = cleanText(profile) ?? "standard";
  return TAX_PROFILE_LABELS[key] ?? key.replace(/_/g, " ");
}

export function getTaxDetail(quote: DealRoomQuote): string | null {
  const profile = cleanText(quote.tax_profile) ?? "standard";
  const label = taxProfileLabel(profile);
  const overrideReason = cleanText(quote.tax_override_reason);
  if (overrideReason) return `Tax override applied; reason recorded: ${overrideReason}`;
  if (profile !== "standard") return `Tax profile: ${label}`;
  return null;
}

export function formatProposalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function getCommercialDetails(
  quote: DealRoomQuote,
  branch: DealRoomBranch | null,
): DealRoomCommercialDetail[] {
  const details: DealRoomCommercialDetail[] = [];
  const expires = formatProposalDate(quote.expires_at);
  if (expires) {
    details.push({ label: "Proposal valid until", value: expires });
  } else {
    const footerText = cleanText(branch?.doc_footer_text);
    if (footerText) details.push({ label: "Proposal validity", value: footerText });
  }

  const deposit = numberOrNull(quote.deposit_required_amount);
  if (deposit != null && deposit > 0) {
    details.push({ label: "Deposit required", value: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(deposit) });
  }

  const deliveryEta = cleanText(quote.delivery_eta);
  if (deliveryEta) details.push({ label: "Delivery ETA", value: deliveryEta });

  const followUp = formatProposalDate(quote.follow_up_at);
  if (followUp) details.push({ label: "Rep follow-up", value: followUp });

  const taxDetail = getTaxDetail(quote);
  if (taxDetail) {
    details.push({ label: "Tax treatment", value: taxProfileLabel(quote.tax_profile), detail: taxDetail });
  }

  const terms = cleanText(quote.special_terms);
  if (terms) details.push({ label: "Special terms", value: terms });

  return details;
}

export function getProposalComplianceNotes(quote: DealRoomQuote): string[] {
  const hasFinance = (quote.financing_scenarios ?? []).some((scenario) => {
    const type = cleanText(scenario.type)?.toLowerCase();
    return type === "finance" || type === "lease" || type === "lease_fmv" || type === "lease_fppo";
  });
  return [
    hasFinance
      ? "Financing and payment figures are estimates until final lender approval, tax, title, registration, documentation, and delivery details are confirmed."
      : "Customer total is an estimate until tax, title, registration, documentation, and delivery details are finalized.",
    "Equipment availability and final configuration are confirmed by your QEP representative before closing.",
  ];
}
