/**
 * Pure allocation math for the AR receipts desk (M3.1). Waterfalls one
 * physical tender across open invoices oldest-due-first, working in integer
 * cents so float drift can never over-apply (the record_ar_payment guard
 * would reject it server-side; this keeps the client honest too).
 */

export type OpenInvoiceForAllocation = {
  id: string;
  due_date: string | null;
  balance_due: number;
};

export type PaymentApplication = {
  invoice_id: string;
  amount: number;
};

export function allocatePaymentOldestFirst(
  amount: number,
  invoices: OpenInvoiceForAllocation[],
): PaymentApplication[] {
  let remainingCents = Math.round(amount * 100);
  if (!Number.isFinite(remainingCents) || remainingCents <= 0) return [];

  const ordered = [...invoices]
    .filter((invoice) => Number.isFinite(invoice.balance_due) && invoice.balance_due > 0)
    .sort((a, b) => {
      const dueA = a.due_date ?? "9999-12-31";
      const dueB = b.due_date ?? "9999-12-31";
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const applications: PaymentApplication[] = [];
  for (const invoice of ordered) {
    if (remainingCents <= 0) break;
    const balanceCents = Math.round(invoice.balance_due * 100);
    const appliedCents = Math.min(remainingCents, balanceCents);
    if (appliedCents <= 0) continue;
    applications.push({ invoice_id: invoice.id, amount: appliedCents / 100 });
    remainingCents -= appliedCents;
  }
  return applications;
}

export function allocationTotal(applications: PaymentApplication[]): number {
  const cents = applications.reduce((sum, app) => sum + Math.round(app.amount * 100), 0);
  return cents / 100;
}
