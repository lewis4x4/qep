import type {
  QuoteCommercialDiscountType,
  QuoteApprovalState,
  QuoteLineItemDraft,
  QuotePacketReadiness,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

export interface QuoteWorkspaceComputed {
  equipmentTotal: number;
  attachmentTotal: number;
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

export function computeQuoteWorkspace(draft: QuoteWorkspaceDraft): QuoteWorkspaceComputed {
  const equipmentTotal = sumLineItems(draft.equipment);
  const attachmentTotal = sumLineItems(draft.attachments);
  const subtotal = equipmentTotal + attachmentTotal;
  const discountTotal = computeCommercialDiscountTotal({
    subtotal,
    discountType: draft.commercialDiscountType,
    discountValue: draft.commercialDiscountValue,
  });
  const discountedSubtotal = clampMoney(subtotal - discountTotal);
  const netTotal = clampMoney(discountedSubtotal - clampMoney(draft.tradeAllowance));
  const taxTotal = clampMoney(draft.taxTotal);
  const customerTotal = clampMoney(netTotal + taxTotal);
  const cashDown = clampMoney(draft.cashDown);
  const amountFinanced = clampMoney(customerTotal - cashDown);
  const dealerCost = subtotal * 0.8;
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
