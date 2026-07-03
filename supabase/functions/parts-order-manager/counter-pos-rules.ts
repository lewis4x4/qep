export type PaymentClassification = "cash" | "charge";
export type PaymentStatus = "unpaid" | "paid" | "charge_account";
export type ChargeAuthorizationStatus =
  | "not_applicable"
  | "approved_credit"
  | "exec_approved"
  | "pending_ar_approval"
  | "denied";

export type CounterTenderState = {
  order_source?: string | null;
  status?: string | null;
  payment_classification?: string | null;
  payment_status?: string | null;
  charge_authorization_status?: string | null;
};

export type CounterTenderPatch = {
  payment_classification: PaymentClassification;
  payment_status: PaymentStatus;
  payment_reference: string | null;
  charge_authorization_status: ChargeAuthorizationStatus;
  charge_authorization_note: string | null;
};

const releaseStatuses = new Set([
  "submitted",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
]);

const terminalNoReleaseStatuses = new Set(["draft", "cancelled", "canceled"]);

export class CounterPosRuleError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CounterPosRuleError";
    this.status = status;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function classificationValue(value: unknown): PaymentClassification | null {
  const raw = stringValue(value);
  if (raw === "cash" || raw === "charge") return raw;
  return null;
}

function paymentStatusValue(value: unknown): PaymentStatus | null {
  const raw = stringValue(value);
  if (raw === "unpaid" || raw === "paid" || raw === "charge_account") return raw;
  return null;
}

function chargeStatusValue(value: unknown): ChargeAuthorizationStatus | null {
  const raw = stringValue(value);
  if (
    raw === "not_applicable" ||
    raw === "approved_credit" ||
    raw === "exec_approved" ||
    raw === "pending_ar_approval" ||
    raw === "denied"
  ) {
    return raw;
  }
  return null;
}

export function normalizeCounterTenderInput(
  raw: Record<string, unknown>,
  current?: CounterTenderState | null,
): CounterTenderPatch {
  const requestedClassification = classificationValue(raw.payment_classification);
  const currentClassification = classificationValue(current?.payment_classification) ?? "cash";
  const paymentClassification = requestedClassification ?? currentClassification;

  if (stringValue(raw.payment_classification) && !requestedClassification) {
    throw new CounterPosRuleError("payment_classification must be cash or charge");
  }
  if (current && currentClassification === "cash" && requestedClassification === "charge") {
    throw new CounterPosRuleError(
      "Cash-to-charge conversion requires AR approval and cannot be handled at the counter",
      409,
    );
  }

  const requestedPaymentStatus = paymentStatusValue(raw.payment_status);
  if (stringValue(raw.payment_status) && !requestedPaymentStatus) {
    throw new CounterPosRuleError("payment_status is not valid for counter POS");
  }

  const requestedChargeStatus = chargeStatusValue(raw.charge_authorization_status);
  if (stringValue(raw.charge_authorization_status) && !requestedChargeStatus) {
    throw new CounterPosRuleError("charge_authorization_status is not valid for counter POS");
  }

  const paymentReference = stringValue(raw.payment_reference)?.slice(0, 160) ?? null;
  const chargeAuthorizationNote =
    stringValue(raw.charge_authorization_note)?.slice(0, 500) ?? null;

  if (paymentClassification === "cash") {
    const paymentStatus = requestedPaymentStatus ??
      paymentStatusValue(current?.payment_status) ??
      "unpaid";
    if (paymentStatus === "charge_account") {
      throw new CounterPosRuleError("Cash-class tickets must be unpaid or paid");
    }
    return {
      payment_classification: "cash",
      payment_status: paymentStatus,
      payment_reference: paymentReference,
      charge_authorization_status: "not_applicable",
      charge_authorization_note: null,
    };
  }

  const chargeAuthorizationStatus = requestedChargeStatus ??
    chargeStatusValue(current?.charge_authorization_status) ??
    "pending_ar_approval";
  return {
    payment_classification: "charge",
    payment_status: "charge_account",
    payment_reference: paymentReference,
    charge_authorization_status: chargeAuthorizationStatus,
    charge_authorization_note: chargeAuthorizationNote,
  };
}

export function assertCounterReleaseAllowed(order: CounterTenderState): void {
  const orderSource = stringValue(order.order_source) ?? "portal";
  const status = stringValue(order.status) ?? "draft";
  if (orderSource === "portal" || terminalNoReleaseStatuses.has(status)) return;
  if (!releaseStatuses.has(status)) return;

  const paymentClassification = classificationValue(order.payment_classification) ?? "cash";
  const paymentStatus = paymentStatusValue(order.payment_status) ?? "unpaid";
  const chargeAuthorizationStatus =
    chargeStatusValue(order.charge_authorization_status) ?? "not_applicable";

  if (paymentClassification === "cash") {
    if (paymentStatus !== "paid") {
      throw new CounterPosRuleError(
        "Cash-class counter tickets must be paid in full before parts are released",
        409,
      );
    }
    return;
  }

  if (
    chargeAuthorizationStatus !== "approved_credit" &&
    chargeAuthorizationStatus !== "exec_approved"
  ) {
    throw new CounterPosRuleError(
      "Charge-class counter tickets require approved credit or AR-recorded executive approval before release",
      409,
    );
  }
}
