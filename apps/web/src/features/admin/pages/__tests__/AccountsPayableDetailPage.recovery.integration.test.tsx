import { beforeEach, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
let outcome: "fail" | "zero" | "saved" = "fail";
let bill: Record<string, unknown>;
const original = { id: "bill-1", vendor_id: null, vendor_name: "Supplier", invoice_number: "INV-1", invoice_date: "2026-09-01", due_date: "2026-09-10", payable_account_code: "2000", payable_account_name: "AP", description: "Parts", status: "draft", approval_status: "pending", subtotal_amount: 100, tax_amount: 0, total_amount: 100, amount_paid: 0, balance_due: 100, notes: "Saved notes", updated_at: "2026-09-01T00:00:00Z" };
mock.module("@/components/RequireAdmin", () => ({ RequireAdmin: ({ children }: { children: React.ReactNode }) => children }));
mock.module("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: "admin-1", active_workspace_id: "ws-1" } }) }));
mock.module("@/lib/supabase", () => ({ supabase: { from: (table: string) => {
  let patch: Record<string, unknown> | null = null;
  const query = { select: () => query, eq: () => query,
    update: (value: Record<string, unknown>) => { patch = value; return query; },
    order: async () => ({ data: [], error: null }),
    maybeSingle: async () => {
      if (table === "ap_bills" && patch) {
        if (outcome === "fail") return { data: null, error: new Error("database unavailable") };
        if (outcome === "zero") return { data: null, error: null };
        bill = { ...bill, ...patch, updated_at: "2026-09-02T00:00:00Z" };
      }
      return { data: bill, error: null };
    },
  };
  return query;
} } }));
const { AccountsPayableDetailPage } = await import("../AccountsPayableDetailPage");
function View() { return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/admin/accounts-payable/bill-1"]}><Routes><Route path="/admin/accounts-payable/:billId" element={<AccountsPayableDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>; }
beforeEach(() => { bill = { ...original }; outcome = "fail"; localStorage.clear(); });
test("failed AP header save retains edits and explicit retry persists them", async () => {
  render(<View />);
  await waitFor(() => expect(screen.getByDisplayValue("Saved notes")).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText("Notes"), { target: { value: "Retain these notes" } });
  fireEvent.click(screen.getByText("Save header"));
  await waitFor(() => expect(screen.getByText(/Bill not saved: database unavailable/)).toBeTruthy());
  expect(screen.getByDisplayValue("Retain these notes")).toBeTruthy();
  outcome = "saved";
  fireEvent.click(screen.getByText("Retry saving header"));
  await waitFor(() => expect(bill.notes).toBe("Retain these notes"));
  await waitFor(() => expect(screen.getByText("Saved", { exact: true })).toBeTruthy());
});
test("zero-row update is a conflict failure rather than success", async () => {
  outcome = "zero";
  render(<View />);
  await waitFor(() => expect(screen.getByDisplayValue("Saved notes")).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText("Notes"), { target: { value: "Conflicting edit" } });
  fireEvent.click(screen.getByText("Save header"));
  await waitFor(() => expect(screen.getByText(/Bill not saved: The bill changed/)).toBeTruthy());
  expect(screen.getByDisplayValue("Conflicting edit")).toBeTruthy();
});
