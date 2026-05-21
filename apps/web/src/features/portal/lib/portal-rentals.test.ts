import { describe, expect, test } from "bun:test";
import {
  canEditPortalRentalBooking,
  canEditPortalRentalExtension,
  canRequestPortalRentalExtension,
  getPortalRentalContractStage,
  validatePortalRentalBookingDraft,
} from "./portal-rentals";
import type { PortalRentalBookingDraft, PortalRentalContractView, PortalRentalExtensionRequest } from "../../../../../../shared/qep-moonshot-contracts";

const baseDraft: PortalRentalBookingDraft = {
  mode: "exact_unit",
  equipmentId: "unit-1",
  requestedCategory: null,
  requestedMake: null,
  requestedModel: null,
  requestedStartDate: "2026-04-15",
  requestedEndDate: "2026-04-18",
  deliveryMode: "pickup",
  branchId: null,
  deliveryLocation: null,
  customerNotes: null,
};

const baseContract: PortalRentalContractView = {
  id: "contract-1",
  requestType: "booking",
  status: "submitted",
  assignmentStatus: "assigned",
  deliveryMode: "pickup",
  branchId: null,
  branchLabel: null,
  requestedCategory: "Skid steer",
  requestedMake: null,
  requestedModel: null,
  requestedStartDate: "2026-04-15",
  requestedEndDate: "2026-04-18",
  approvedStartDate: null,
  approvedEndDate: null,
  depositRequired: false,
  depositAmount: null,
  depositStatus: "not_required",
  depositInvoiceId: null,
  companyId: "company-1",
  dealerResponse: null,
  customerNotes: null,
  signedTermsUrl: null,
  nativeSignature: null,
  pricingEstimate: null,
  agreedRates: null,
  paymentStatusView: null,
  equipment: null,
};

const baseExtension: PortalRentalExtensionRequest = {
  id: "extension-1",
  rentalContractId: "contract-1",
  status: "submitted",
  requestedEndDate: "2026-04-20",
  approvedEndDate: null,
  customerReason: "Need one more day",
  dealerResponse: null,
  additionalCharge: null,
  paymentInvoiceId: null,
  paymentStatus: "not_required",
  paymentStatusView: null,
  createdAt: "2026-04-12T10:00:00.000Z",
};

describe("portal rental helpers", () => {
  test("validates exact-unit booking requirements", () => {
    expect(validatePortalRentalBookingDraft(baseDraft)).toEqual({ valid: true, reason: null });
    expect(validatePortalRentalBookingDraft({ ...baseDraft, equipmentId: null })).toEqual({
      valid: false,
      reason: "Choose a rentable unit for exact-unit booking.",
    });
  });

  test("validates category-first booking requirements", () => {
    expect(validatePortalRentalBookingDraft({
      ...baseDraft,
      mode: "category_first",
      equipmentId: null,
      requestedCategory: "Mini excavator",
    })).toEqual({ valid: true, reason: null });
    expect(validatePortalRentalBookingDraft({
      ...baseDraft,
      mode: "category_first",
      equipmentId: null,
      requestedCategory: null,
    })).toEqual({
      valid: false,
      reason: "Choose an equipment category for category-first booking.",
    });
  });

  test("exposes edit and cancel windows only before approval", () => {
    expect(canEditPortalRentalBooking(baseContract)).toBe(true);
    expect(canEditPortalRentalBooking({ ...baseContract, status: "awaiting_payment" })).toBe(false);
    expect(canEditPortalRentalExtension(baseExtension)).toBe(true);
    expect(canEditPortalRentalExtension({ ...baseExtension, status: "approved" })).toBe(false);
  });

  test("marks category-first contracts as pending assignment until a unit is assigned", () => {
    expect(getPortalRentalContractStage({
      ...baseContract,
      assignmentStatus: "pending_assignment",
      status: "reviewing",
    })).toBe("pending_assignment");
  });

  test("keeps activation payment-gated until deposit is settled and terms are signed", () => {
    expect(getPortalRentalContractStage({
      ...baseContract,
      status: "awaiting_payment",
      paymentStatusView: {
        kind: "deposit",
        status: "pending",
        amount: 500,
        invoiceId: "invoice-1",
        companyId: "company-1",
        headline: "Deposit ready for checkout",
        detail: "Complete checkout first.",
        canPayNow: true,
        canFinalize: true,
      },
    })).toBe("awaiting_payment");

    const paidContract: PortalRentalContractView = {
      ...baseContract,
      status: "awaiting_payment",
      paymentStatusView: {
        kind: "deposit",
        status: "paid",
        amount: 500,
        invoiceId: "invoice-1",
        companyId: "company-1",
        headline: "Deposit received",
        detail: "Finalize the rental.",
        canPayNow: false,
        canFinalize: true,
      },
    };

    expect(getPortalRentalContractStage(paidContract)).toBe("awaiting_signature");
    expect(getPortalRentalContractStage({
      ...paidContract,
      nativeSignature: {
        id: "sig-1",
        signerName: "Jane Customer",
        signedAt: "2026-04-13T12:00:00.000Z",
        signedVia: "portal",
        documentHash: "abc123",
        source: "native_qep",
      },
    })).toBe("ready_to_finalize");
  });

  test("treats no-deposit rentals as settled before applying signature gate", () => {
    const noDepositContract: PortalRentalContractView = {
      ...baseContract,
      status: "awaiting_payment",
      depositRequired: false,
      depositAmount: null,
      depositStatus: "not_required",
      paymentStatusView: {
        kind: "deposit",
        status: "not_required",
        amount: null,
        invoiceId: null,
        companyId: "company-1",
        headline: "No deposit required",
        detail: "Terms can be finalized after signature.",
        canPayNow: false,
        canFinalize: true,
      },
    };

    expect(getPortalRentalContractStage(noDepositContract)).toBe("awaiting_signature");
    expect(getPortalRentalContractStage({
      ...noDepositContract,
      nativeSignature: {
        id: "sig-no-deposit",
        signerName: "Jane Customer",
        signedAt: "2026-04-13T12:00:00.000Z",
        signedVia: "portal",
        documentHash: "def456",
        source: "native_qep",
      },
    })).toBe("ready_to_finalize");
  });

  test("only allows extension requests for active contracts without a pending extension", () => {
    expect(canRequestPortalRentalExtension({ ...baseContract, status: "active" }, false)).toBe(true);
    expect(canRequestPortalRentalExtension({ ...baseContract, status: "awaiting_payment" }, false)).toBe(false);
    expect(canRequestPortalRentalExtension({ ...baseContract, status: "active" }, true)).toBe(false);
  });
});
