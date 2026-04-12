import type {
  QuoteApprovalState,
  QuoteLineItemDraft,
  QuotePacketReadiness,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

export interface QuoteWorkspaceComputed {
  equipmentTotal: number;
  attachmentTotal: number;
  subtotal: number;
  netTotal: number;
  dealerCost: number;
  marginAmount: number;
  marginPct: number;
  approvalState: QuoteApprovalState;
  packetReadiness: QuotePacketReadiness;
}

function sumLineItems(items: QuoteLineItemDraft[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function computeQuoteWorkspace(draft: QuoteWorkspaceDraft): QuoteWorkspaceComputed {
  const equipmentTotal = sumLineItems(draft.equipment);
  const attachmentTotal = sumLineItems(draft.attachments);
  const subtotal = equipmentTotal + attachmentTotal;
  const netTotal = subtotal - draft.tradeAllowance;
  const dealerCost = subtotal * 0.8;
  const marginAmount = netTotal - dealerCost;
  const marginPct = netTotal > 0 ? (marginAmount / netTotal) * 100 : 0;

  const missing: string[] = [];
  if (!draft.branchSlug) missing.push("quoting branch");
  if (draft.equipment.length === 0) missing.push("equipment selection");
  if (!draft.dealId) missing.push("linked deal");

  const approvalState: QuoteApprovalState = {
    requiresManagerApproval: marginPct < 10,
    marginPct,
    reason: marginPct < 10 ? "Margin is below the 10% approval threshold." : null,
  };

  return {
    equipmentTotal,
    attachmentTotal,
    subtotal,
    netTotal,
    dealerCost,
    marginAmount,
    marginPct,
    approvalState,
    packetReadiness: {
      canSave: missing.length === 0,
      canSend: missing.length === 0 && !approvalState.requiresManagerApproval,
      missing,
    },
  };
}
