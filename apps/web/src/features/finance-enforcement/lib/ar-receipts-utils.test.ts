import { describe, expect, test } from "bun:test";
import { allocatePaymentOldestFirst, allocationTotal } from "./ar-receipts-utils";

const invoices = [
  { id: "b", due_date: "2026-08-07", balance_due: 190.52 },
  { id: "a", due_date: "2026-07-15", balance_due: 74550 },
  { id: "c", due_date: "2026-09-01", balance_due: 6410 },
];

describe("allocatePaymentOldestFirst", () => {
  test("applies oldest due first and fully settles when tender covers all", () => {
    const apps = allocatePaymentOldestFirst(81150.52, invoices);
    expect(apps).toEqual([
      { invoice_id: "a", amount: 74550 },
      { invoice_id: "b", amount: 190.52 },
      { invoice_id: "c", amount: 6410 },
    ]);
    expect(allocationTotal(apps)).toBe(81150.52);
  });

  test("partial tender waterfalls and stops mid-invoice", () => {
    const apps = allocatePaymentOldestFirst(74650, invoices);
    expect(apps).toEqual([
      { invoice_id: "a", amount: 74550 },
      { invoice_id: "b", amount: 100 },
    ]);
  });

  test("cents rounding never over-applies", () => {
    const apps = allocatePaymentOldestFirst(0.1 + 0.2, [
      { id: "x", due_date: null, balance_due: 0.3 },
    ]);
    expect(apps).toEqual([{ invoice_id: "x", amount: 0.3 }]);
  });

  test("zero, negative, and non-finite tenders allocate nothing", () => {
    expect(allocatePaymentOldestFirst(0, invoices)).toEqual([]);
    expect(allocatePaymentOldestFirst(-5, invoices)).toEqual([]);
    expect(allocatePaymentOldestFirst(Number.NaN, invoices)).toEqual([]);
  });

  test("zero-balance invoices are skipped", () => {
    const apps = allocatePaymentOldestFirst(100, [
      { id: "paid", due_date: "2026-01-01", balance_due: 0 },
      { id: "open", due_date: "2026-02-01", balance_due: 50 },
    ]);
    expect(apps).toEqual([{ invoice_id: "open", amount: 50 }]);
  });
});
