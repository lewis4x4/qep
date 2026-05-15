import type { QuotePDFData, QuoteProposalAsset } from "../components/QuotePDFDocument";
import type { TradeValuationProposalSnapshot } from "./point-shoot-trade-api";
import { quoteLineCostVisibility, type QuoteWorkspaceComputed } from "./quote-workspace";
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

/**
 * Customer-safe quote media metadata contract.
 *
 * Quote line metadata may carry URL snapshots from source records using these
 * public keys only: photo_url, photo_urls, vendor_logo_url, media_source,
 * media_source_id, media_kind, stock_number, serial_number, condition,
 * warranty_text, long_description, and spec_bullets. The proposal projection
 * below is whitelist-only: raw metadata, source IDs, margin/cost fields, AI
 * excerpts, and local/private URLs are never copied into customer output.
 */
const BRAND_ASSET_ROOT = "/brand/qep/quote/";
const QEP_BRAND_ASSETS = {
  qepLogo: { src: `${BRAND_ASSET_ROOT}qep-its-in-the-name-logo.png`, alt: "Quality Equipment & Parts logo" },
  vendorLogos: [
    { src: `${BRAND_ASSET_ROOT}vendor-asv.png`, alt: "ASV" },
    { src: `${BRAND_ASSET_ROOT}vendor-cmi.png`, alt: "CMI" },
    { src: `${BRAND_ASSET_ROOT}vendor-develon.png`, alt: "Develon" },
    { src: `${BRAND_ASSET_ROOT}vendor-bandit-authorized.png`, alt: "Bandit authorized dealer" },
    { src: `${BRAND_ASSET_ROOT}vendor-stacked.png`, alt: "QEP vendor partners" },
  ],
  qrCode: { src: `${BRAND_ASSET_ROOT}qep-qr.png`, alt: "QEP website QR code" },
} satisfies QuotePDFData["brandAssets"];

function money(value: number | null | undefined): number {
  return Number.isFinite(value ?? NaN) ? Math.round(Math.max(0, Number(value)) * 100) / 100 : 0;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function metadataRecord(value: QuoteLineItemDraft["metadata"]): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function metadataText(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string") {
      const text = optionalText(value);
      if (text) return text;
    }
  }
  return null;
}

function metadataTextArray(metadata: Record<string, unknown>, ...keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = metadata[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          const text = optionalText(item);
          if (text) values.push(text);
        }
      }
    } else if (typeof value === "string") {
      const text = optionalText(value);
      if (text) values.push(text);
    }
  }
  return values;
}

function isPrivateProposalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b != null && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

export function isSafeProposalMediaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith("//")) return false;
  if (text.startsWith("/")) return true;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return !isPrivateProposalHost(url.hostname);
  } catch {
    return false;
  }
}

function safeProposalMediaUrl(value: unknown): string | null {
  return isSafeProposalMediaUrl(value) ? value.trim() : null;
}

function proposalAsset(src: unknown, alt: string, options?: Pick<QuoteProposalAsset, "caption" | "mediaKind">): QuoteProposalAsset | null {
  const safeSrc = safeProposalMediaUrl(src);
  return safeSrc ? { src: safeSrc, alt, caption: options?.caption ?? null, mediaKind: options?.mediaKind ?? null } : null;
}

function proposalMediaKind(metadata: Record<string, unknown>): QuoteProposalAsset["mediaKind"] {
  const kind = metadataText(metadata, "media_kind", "mediaKind");
  return kind ?? null;
}

function specBullets(metadata: Record<string, unknown>): string[] {
  const raw = metadata.spec_bullets ?? metadata.specBullets;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item !== "string") return [];
    const text = optionalText(item);
    return text ? [text] : [];
  }).slice(0, 8);
}

function buildLineMedia(metadata: Record<string, unknown>, description: string): QuotePDFData["lineItems"][number]["media"] {
  const mediaKind = proposalMediaKind(metadata);
  const galleryUrls = metadataTextArray(metadata, "photo_urls", "photoUrls", "trade_photo_urls", "tradePhotoUrls")
    .flatMap((url) => {
      const safe = safeProposalMediaUrl(url);
      return safe ? [safe] : [];
    });
  const primaryUrl = safeProposalMediaUrl(metadataText(metadata, "photo_url", "photoUrl", "primary_photo_url", "primaryPhotoUrl", "trade_photo_url", "tradePhotoUrl")) ?? galleryUrls[0] ?? null;
  const primaryPhoto = proposalAsset(primaryUrl, `${description} photo`, { mediaKind });
  if (!primaryPhoto) return undefined;
  const gallery = galleryUrls
    .filter((url) => url !== primaryPhoto.src)
    .slice(0, 6)
    .flatMap((url, index) => {
      const asset = proposalAsset(url, `${description} photo ${index + 2}`, { mediaKind });
      return asset ? [asset] : [];
    });
  return { primaryPhoto, gallery };
}

function buildVendorLogo(metadata: Record<string, unknown>, description: string): QuoteProposalAsset | null {
  return proposalAsset(metadataText(metadata, "vendor_logo_url", "vendorLogoUrl"), `${description} manufacturer logo`);
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
  const metadata = metadataRecord(line.metadata);
  const tone: ProposalLineTone = CREDIT_LINE_KINDS.has(lineType) || metadata.misc_line_kind === "credit" ? "credit" : "charge";
  const extendedPrice = lineExtendedAmount(line);
  const description = lineDescription(line);
  return {
    lineType,
    description,
    make: optionalText(line.make),
    model: optionalText(line.model),
    year: line.year ?? null,
    quantity: Number.isFinite(line.quantity) ? line.quantity : 1,
    unitPrice: displayMoney(line.unitPrice, tone),
    extendedPrice: displayMoney(extendedPrice, tone),
    displayAmount: displayMoney(extendedPrice, tone),
    tone,
    reasonCode: optionalText(line.reasonCode ?? null),
    stockNumber: metadataText(metadata, "stock_number", "stockNumber"),
    serialNumber: metadataText(metadata, "serial_number", "serialNumber"),
    condition: metadataText(metadata, "condition"),
    warrantyText: metadataText(metadata, "warranty_text", "warrantyText"),
    longDescription: metadataText(metadata, "long_description", "longDescription"),
    specBullets: specBullets(metadata),
    media: buildLineMedia(metadata, description),
    vendorLogo: buildVendorLogo(metadata, description),
  };
}

function isCustomerVisibleLine(line: QuoteLineItemDraft): boolean {
  return quoteLineCostVisibility(line) === "customer";
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCompactMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function tradeConditionLabel(status: string | null): string | null {
  if (!status) return null;
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildTradeAllowanceLine(
  draft: QuoteWorkspaceDraft,
  tradeValuation: TradeValuationProposalSnapshot | null | undefined,
): QuotePDFData["lineItems"][number] {
  const tradeTitle = [tradeValuation?.year, tradeValuation?.make, tradeValuation?.model].filter(Boolean).join(" ").trim();
  const photoUrls = tradeValuation?.photos.map((photo) => photo.url) ?? [];
  const metadata = {
    trade_photo_url: photoUrls[0] ?? null,
    trade_photo_urls: photoUrls,
    media_kind: "trade_in",
  };
  const condition = tradeConditionLabel(tradeValuation?.operationalStatus ?? null);
  const specs = [
    tradeValuation?.hours != null ? `Hours: ${formatInteger(tradeValuation.hours)}` : null,
    tradeValuation?.conditionalLanguage ? `Condition note: ${tradeValuation.conditionalLanguage}` : null,
  ].flatMap((item) => {
    const text = optionalText(item ?? null);
    return text ? [text] : [];
  });

  return {
    lineType: "trade_allowance",
    description: "Trade-in allowance",
    make: tradeValuation?.make ?? null,
    model: tradeValuation?.model ?? null,
    year: tradeValuation?.year ?? null,
    quantity: 1,
    unitPrice: money(draft.tradeAllowance),
    extendedPrice: money(draft.tradeAllowance),
    displayAmount: money(draft.tradeAllowance),
    tone: "credit",
    reasonCode: null,
    serialNumber: tradeValuation?.serialNumber ?? null,
    condition,
    longDescription: tradeTitle
      ? `Trade evidence captured for ${tradeTitle}${tradeValuation?.aiConditionNotes ? ` — ${tradeValuation.aiConditionNotes}` : ""}`
      : tradeValuation?.aiConditionNotes ?? null,
    specBullets: specs.slice(0, 8),
    media: buildLineMedia(metadata, tradeTitle || "Trade-in equipment"),
    vendorLogo: null,
  };
}

function buildLineItems(
  draft: QuoteWorkspaceDraft,
  computed: Pick<QuoteWorkspaceComputed, "discountTotal">,
  tradeValuation?: TradeValuationProposalSnapshot | null,
): QuotePDFData["lineItems"] {
  const lines = [
    ...draft.equipment.filter(isCustomerVisibleLine).map((line) => toProposalLine(line, "equipment")),
    ...draft.attachments.filter(isCustomerVisibleLine).map((line) => toProposalLine(line, "attachment")),
    ...(draft.pricingLines ?? []).filter(isCustomerVisibleLine).map((line) => toProposalLine(line)),
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
    lines.push(buildTradeAllowanceLine(draft, tradeValuation));
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
  tradeValuation?: TradeValuationProposalSnapshot | null;
}): QuotePDFData {
  const { draft, computed } = input;
  const financing = buildFinancing(input.financeScenarios);
  const selectedScenario = input.financeScenarios.find((scenario) => scenario.label === draft.selectedFinanceScenario) ?? null;
  const selectedPaymentKind = scenarioKind(selectedScenario);
  const hasDisplayedFinanceOrLease = financing.some((scenario) => isDisplayableProposalFinanceScenario(scenario) && scenario.type !== "cash");
  const tax = buildTaxDetail(draft);
  const customerEquipment = draft.equipment.filter(isCustomerVisibleLine);
  const primaryEquipment = customerEquipment[0] ?? null;

  return {
    dealName: draft.dealId || draft.customerCompany || draft.customerName || "Quote",
    customerName: draft.customerName || draft.customerCompany || "Customer",
    quoteNumber: input.quoteNumber ?? null,
    preparedBy: input.preparedBy,
    preparedDate: input.preparedDate,
    aiRecommendationSummary: null,
    equipment: customerEquipment.map((item) => ({
      make: item.make ?? "",
      model: item.model ?? item.title,
      year: item.year ?? null,
      price: money(item.unitPrice),
      quantity: item.quantity,
      extendedPrice: money(lineExtendedAmount(item)),
    })),
    attachments: draft.attachments.filter(isCustomerVisibleLine).map((item) => ({
      name: item.title,
      price: money(item.unitPrice),
      quantity: item.quantity,
      extendedPrice: money(lineExtendedAmount(item)),
    })),
    lineItems: buildLineItems(draft, computed, input.tradeValuation),
    brandAssets: QEP_BRAND_ASSETS,
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
