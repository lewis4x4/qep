import type {
  QuoteCommercialDiscountType,
  QuoteApprovalState,
  QuoteLineItemDraft,
  QuotePacketReadiness,
  QuoteReadinessState,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

export interface QuoteWorkspaceComputed {
  equipmentTotal: number;
  attachmentTotal: number;
  pricingLineTotal: number;
  taxableBasis: number;
  subtotal: number;
  discountTotal: number;
  discountedSubtotal: number;
  netTotal: number;
  taxTotal: number;
  customerTotal: number;
  cashDown: number;
  amountFinanced: number;
  dealerCost: number;
  marginAmount: number;
  marginPct: number;
  approvalState: QuoteApprovalState;
  packetReadiness: QuotePacketReadiness;
}

function sumLineItems(items: QuoteLineItemDraft[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

const ZERO_DEALER_COST_LINE_KINDS = new Set<QuoteLineItemDraft["kind"]>([
  "discount",
  "trade_allowance",
  "rebate_mfg",
  "rebate_dealer",
  "loyalty_discount",
  "tax_state",
  "tax_county",
]);

const CONFIG_LINE_KINDS = new Set<QuoteLineItemDraft["kind"]>([
  "attachment",
  "option",
  "accessory",
  "warranty",
]);

const PRICING_ADDER_KINDS = new Set<QuoteLineItemDraft["kind"]>([
  "pdi",
  "freight",
  "good_faith",
  "doc_fee",
  "title",
  "tag",
  "registration",
  "financing",
  "custom",
]);

const PRICING_DISCOUNT_KINDS = new Set<QuoteLineItemDraft["kind"]>([
  "discount",
  "rebate_mfg",
  "rebate_dealer",
  "loyalty_discount",
]);

function lineExtendedAmount(item: QuoteLineItemDraft): number {
  return item.unitPrice * item.quantity;
}

function sumLinesByKind(items: QuoteLineItemDraft[], kinds: Set<QuoteLineItemDraft["kind"]>): number {
  return items.reduce((sum, item) => kinds.has(item.kind) ? sum + lineExtendedAmount(item) : sum, 0);
}

function sumDiscountLines(items: QuoteLineItemDraft[]): number {
  return items.reduce((sum, item) => {
    if (!PRICING_DISCOUNT_KINDS.has(item.kind)) return sum;
    return sum + Math.abs(lineExtendedAmount(item));
  }, 0);
}

function sumDealerCost(items: QuoteLineItemDraft[]): number {
  return items.reduce((sum, item) => {
    const unitCost = Number.isFinite(item.dealerCost ?? NaN)
      ? Number(item.dealerCost)
      : ZERO_DEALER_COST_LINE_KINDS.has(item.kind)
        ? 0
      : item.unitPrice * 0.8;
    return sum + Math.max(0, unitCost) * item.quantity;
  }, 0);
}

export function hasQuoteCustomerIdentity(draft: Pick<
  QuoteWorkspaceDraft,
  "customerName" | "customerCompany" | "contactId" | "companyId"
>): boolean {
  return Boolean(
    draft.customerName?.trim() ||
    draft.customerCompany?.trim() ||
    draft.contactId ||
    draft.companyId,
  );
}

function clampMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * 100) / 100;
}

export function computeCommercialDiscountTotal(input: {
  subtotal: number;
  discountType: QuoteCommercialDiscountType;
  discountValue: number;
}): number {
  const subtotal = clampMoney(input.subtotal);
  const rawValue = clampMoney(input.discountValue);
  if (subtotal <= 0 || rawValue <= 0) return 0;
  if (input.discountType === "percent") {
    const pct = Math.min(rawValue, 100);
    return clampMoney(subtotal * (pct / 100));
  }
  return clampMoney(Math.min(rawValue, subtotal));
}

export function isTaxProfileExempt(profile: QuoteTaxProfile): boolean {
  return profile !== "standard";
}

export type QuoteSendActionChannel = "preview" | "email" | "text";

export interface QuoteSendActionReadinessInput {
  channel: QuoteSendActionChannel;
  quotePackageId: string | null;
  approvalCaseCanSend: boolean;
  followUpAt?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  documentReady?: boolean;
  taxResolved?: boolean;
  whyThisMachineRequired?: boolean;
  whyThisMachineConfirmed?: boolean;
}

export function isQuoteWhyThisMachineConfirmationRequired(draft: Pick<
  QuoteWorkspaceDraft,
  "whyThisMachine" | "recommendation"
>): boolean {
  return Boolean(
    draft.whyThisMachine?.trim()
    || draft.recommendation?.reasoning?.trim(),
  );
}

export function computeQuoteSendActionReadiness(input: QuoteSendActionReadinessInput): QuoteReadinessState {
  const missing: string[] = [];
  if (!input.quotePackageId) missing.push("saved quote package");
  if (!input.approvalCaseCanSend) missing.push("clean owner approval");
  if (input.taxResolved === false) missing.push("resolved tax preview or override reason");
  if (input.whyThisMachineRequired && !input.whyThisMachineConfirmed) {
    missing.push("rep-confirmed Why this machine narrative");
  }
  if (!input.documentReady) missing.push("document preview/generation");
  if ((input.channel === "email" || input.channel === "text") && !input.followUpAt) {
    missing.push("follow-up date");
  }
  if (input.channel === "email" && !input.customerEmail?.trim()) missing.push("customer email");
  if (input.channel === "text" && !input.customerPhone?.trim()) missing.push("customer phone");
  return {
    ready: missing.length === 0,
    missing,
  };
}

export function computeQuoteWorkspace(draft: QuoteWorkspaceDraft): QuoteWorkspaceComputed {
  const pricingLines = draft.pricingLines ?? [];
  const equipmentTotal = sumLineItems(draft.equipment);
  const attachmentTotal = sumLinesByKind(draft.attachments, CONFIG_LINE_KINDS);
  const legacyAttachmentPricingTotal = sumLinesByKind(draft.attachments, PRICING_ADDER_KINDS);
  const pricingLineTotal = sumLinesByKind(pricingLines, PRICING_ADDER_KINDS) + legacyAttachmentPricingTotal;
  const subtotal = equipmentTotal + attachmentTotal + pricingLineTotal;
  const discountTotal = computeCommercialDiscountTotal({
    subtotal,
    discountType: draft.commercialDiscountType,
    discountValue: draft.commercialDiscountValue,
  }) + clampMoney(sumDiscountLines(pricingLines));
  const discountedSubtotal = clampMoney(subtotal - discountTotal);
  const taxableBasis = clampMoney(discountedSubtotal - clampMoney(draft.tradeAllowance));
  const netTotal = taxableBasis;
  const taxTotal = clampMoney(draft.taxTotal);
  const customerTotal = clampMoney(netTotal + taxTotal);
  const cashDown = clampMoney(draft.cashDown);
  const amountFinanced = clampMoney(customerTotal - cashDown);
  const dealerCost = sumDealerCost([...draft.equipment, ...draft.attachments, ...pricingLines]);
  const marginAmount = netTotal - dealerCost;
  const marginPct = netTotal > 0 ? (marginAmount / netTotal) * 100 : 0;

  const draftMissing: string[] = [];
  if (draft.equipment.length === 0) draftMissing.push("equipment selection");
  if (!hasQuoteCustomerIdentity(draft)) draftMissing.push("customer or prospect");

  const sendMissing = [...draftMissing];
  if (!draft.branchSlug) sendMissing.push("quoting branch");
  if (!draft.customerEmail) sendMissing.push("customer email");

  const approvalState: QuoteApprovalState = {
    requiresManagerApproval: marginPct < 10,
    marginPct,
    reason: marginPct < 10 ? "Margin is below the 10% approval threshold." : null,
  };
  const approvalSatisfied = !approvalState.requiresManagerApproval
    ? true
    : draft.quoteStatus === "approved"
      || draft.quoteStatus === "approved_with_conditions"
      || draft.quoteStatus === "sent"
      || draft.quoteStatus === "accepted";
  let approvalMissingLabel = "manager approval (margin below 10%)";
  if (draft.quoteStatus === "pending_approval") {
    approvalMissingLabel = "manager approval pending";
  } else if (draft.quoteStatus === "changes_requested") {
    approvalMissingLabel = "manager requested revision";
  } else if (draft.quoteStatus === "rejected") {
    approvalMissingLabel = "quote was rejected and must be revised before resubmission";
  }

  return {
    equipmentTotal,
    attachmentTotal,
    pricingLineTotal,
    taxableBasis,
    subtotal,
    discountTotal,
    discountedSubtotal,
    netTotal,
    taxTotal,
    customerTotal,
    cashDown,
    amountFinanced,
    dealerCost,
    marginAmount,
    marginPct,
    approvalState,
    packetReadiness: {
      draft: {
        ready: draftMissing.length === 0,
        missing: draftMissing,
      },
      send: {
        ready: sendMissing.length === 0 && approvalSatisfied,
        missing: approvalSatisfied
          ? sendMissing
          : [...sendMissing, approvalMissingLabel]
      },
      canSave: draftMissing.length === 0,
      canSend: sendMissing.length === 0 && approvalSatisfied,
      missing: approvalSatisfied
        ? sendMissing
        : [...sendMissing, approvalMissingLabel],
    },
  };
}
