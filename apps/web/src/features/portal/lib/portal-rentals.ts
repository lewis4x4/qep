import type {
  PortalRentalBookingDraft,
  PortalRentalContractView,
  PortalRentalExtensionRequest,
} from "../../../../../../shared/qep-moonshot-contracts";

export function validatePortalRentalBookingDraft(draft: PortalRentalBookingDraft): { valid: boolean; reason: string | null } {
  if (!draft.requestedStartDate || !draft.requestedEndDate) {
    return { valid: false, reason: "Rental dates are required." };
  }
  if (draft.mode === "exact_unit" && !draft.equipmentId) {
    return { valid: false, reason: "Choose a rentable unit for exact-unit booking." };
  }
  if (draft.mode === "category_first" && !draft.requestedCategory) {
    return { valid: false, reason: "Choose an equipment category for category-first booking." };
  }
  return { valid: true, reason: null };
}

export function canEditPortalRentalBooking(contract: Pick<PortalRentalContractView, "status">): boolean {
  return ["submitted", "reviewing", "quoted"].includes(contract.status);
}

export function canEditPortalRentalExtension(extension: Pick<PortalRentalExtensionRequest, "status">): boolean {
  return ["submitted", "reviewing"].includes(extension.status);
}

export function getPortalRentalContractStage(contract: Pick<PortalRentalContractView, "status" | "assignmentStatus" | "paymentStatusView">):
  "pending_assignment" | "awaiting_payment" | "ready_to_finalize" | "active" | "inactive" {
  if (contract.assignmentStatus === "pending_assignment") return "pending_assignment";
  if (contract.status === "active") return "active";
  if (contract.status === "awaiting_payment") {
    return contract.paymentStatusView?.status === "paid" ? "ready_to_finalize" : "awaiting_payment";
  }
  return "inactive";
}

export function canRequestPortalRentalExtension(
  contract: Pick<PortalRentalContractView, "status">,
  hasPendingExtension: boolean,
): boolean {
  return contract.status === "active" && !hasPendingExtension;
}
