/** Provider capture and ledger application are separate facts. */
export function paymentReconciliationPending(intent: {
  webhook_signature_verified?: boolean;
  metadata?: Record<string, unknown> | null;
}): { label: string; detail: string; tone: "amber"; status: "processing" } | null {
  const metadata = intent.metadata ?? {};
  if (metadata.reconciliation_status !== "blocked" &&
      typeof metadata.invoice_payment_blocked_reason !== "string" &&
      typeof metadata.deposit_payment_blocked_reason !== "string") return null;
  return {
    label: "Payment captured; finance reconciliation pending",
    detail: "The card payment was received, but it has not been applied to your invoice or deposit. Do not pay again. The dealership finance team is reviewing it.",
    tone: "amber", status: "processing",
  };
}
