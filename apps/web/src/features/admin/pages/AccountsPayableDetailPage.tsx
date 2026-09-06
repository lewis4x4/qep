import { useRetainedDraft } from "@/hooks/useRetainedDraft";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequireAdmin } from "@/components/RequireAdmin";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

const db = supabase as SupabaseClient<Database>;

type ApBillRow = Database["public"]["Tables"]["ap_bills"]["Row"];
type ApBillUpdate = Database["public"]["Tables"]["ap_bills"]["Update"];
type ApBillLineRow = Database["public"]["Tables"]["ap_bill_lines"]["Row"];
type ApBillLineInsert = Database["public"]["Tables"]["ap_bill_lines"]["Insert"];
type ApBillSelectedRow = Pick<
  ApBillRow,
  | "id"
  | "vendor_id"
  | "vendor_name"
  | "invoice_number"
  | "invoice_date"
  | "due_date"
  | "payable_account_code"
  | "payable_account_name"
  | "description"
  | "status"
  | "approval_status"
  | "subtotal_amount"
  | "tax_amount"
  | "total_amount"
  | "amount_paid"
  | "balance_due"
  | "notes"
  | "updated_at"
>;
type ApBillLineSelectedRow = Pick<
  ApBillLineRow,
  "id" | "line_number" | "description" | "quantity" | "unit_cost" | "line_total" | "gl_code" | "gl_name" | "notes"
>;

type BillRow = {
  id: string;
  updated_at: string;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payable_account_code: string | null;
  payable_account_name: string | null;
  description: string | null;
  status: string;
  approval_status: string;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  notes: string | null;
};

type LineRow = {
  id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  gl_code: string | null;
  gl_name: string | null;
  notes: string | null;
};

function toBillRow(row: ApBillSelectedRow): BillRow {
  return {
    id: row.id,
    updated_at: row.updated_at,
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    due_date: row.due_date,
    payable_account_code: row.payable_account_code,
    payable_account_name: row.payable_account_name,
    description: row.description,
    status: row.status,
    approval_status: row.approval_status,
    subtotal_amount: row.subtotal_amount,
    tax_amount: row.tax_amount,
    total_amount: row.total_amount,
    amount_paid: row.amount_paid,
    balance_due: Number(row.balance_due ?? 0),
    notes: row.notes,
  };
}

function toLineRow(row: ApBillLineSelectedRow): LineRow {
  return {
    id: row.id,
    line_number: row.line_number,
    description: row.description,
    quantity: row.quantity,
    unit_cost: row.unit_cost,
    line_total: Number(row.line_total ?? 0),
    gl_code: row.gl_code,
    gl_name: row.gl_name,
    notes: row.notes,
  };
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function AccountsPayableDetailPage() {
  return (
    <RequireAdmin>
      <AccountsPayableDetailPageInner />
    </RequireAdmin>
  );
}

function AccountsPayableDetailPageInner() {
  const { billId = "" } = useParams<{ billId: string }>();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [newLineDescription, setNewLineDescription] = useState("");
  const [newLineQuantity, setNewLineQuantity] = useState("1");
  const [newLineUnitCost, setNewLineUnitCost] = useState("0");
  const [newLineGlCode, setNewLineGlCode] = useState("");
  const [newLineGlName, setNewLineGlName] = useState("");

  const billQuery = useQuery({
    queryKey: ["ap-bill", billId],
    enabled: billId.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("ap_bills")
        .select("id, vendor_id, vendor_name, invoice_number, invoice_date, due_date, payable_account_code, payable_account_name, description, status, approval_status, subtotal_amount, tax_amount, total_amount, amount_paid, balance_due, notes, updated_at")
        .eq("id", billId)
        .maybeSingle();
      if (error) throw error;
      return data ? toBillRow(data) : null;
    },
  });

  const linesQuery = useQuery({
    queryKey: ["ap-bill-lines", billId],
    enabled: billId.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("ap_bill_lines")
        .select("id, line_number, description, quantity, unit_cost, line_total, gl_code, gl_name, notes")
        .eq("bill_id", billId)
        .order("line_number", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(toLineRow);
    },
  });

  const updateBill = useMutation({
    mutationFn: async ({ patch, expectedVersion }: { patch: ApBillUpdate; expectedVersion: string }) => {
      const { data, error } = await db.from("ap_bills").update(patch)
        .eq("id", billId).eq("updated_at", expectedVersion).select("*").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The bill changed or is no longer editable. Reload the saved bill and review your retained draft.");
      return toBillRow(data);
    },
    onSuccess: (saved) => qc.setQueryData(["ap-bill", billId], saved),
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const nextLine = (linesQuery.data?.length ?? 0) + 1;
      const payload: ApBillLineInsert = {
        bill_id: billId,
        line_number: nextLine,
        description: newLineDescription,
        quantity: Number(newLineQuantity || "1"),
        unit_cost: Number(newLineUnitCost || "0"),
        gl_code: newLineGlCode || null,
        gl_name: newLineGlName || null,
      };
      const { data, error } = await db.from("ap_bill_lines").insert(payload).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The voucher line was not saved.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-bill-lines", billId] });
      qc.invalidateQueries({ queryKey: ["ap-bill", billId] });
      setNewLineDescription("");
      setNewLineQuantity("1");
      setNewLineUnitCost("0");
      setNewLineGlCode("");
      setNewLineGlName("");
    },
  });

  const bill = billQuery.data;
  const lines = linesQuery.data ?? [];

  const serverHeader = {
    invoice_date: bill?.invoice_date ?? "",
    due_date: bill?.due_date ?? "",
    payable_account_code: bill?.payable_account_code ?? "",
    payable_account_name: bill?.payable_account_name ?? "",
    notes: bill?.notes ?? "",
  };
  const header = useRetainedDraft(bill && profile?.id
    ? `qep:ap-draft:${profile.id}:${profile.active_workspace_id ?? "none"}:${billId}` : null,
    serverHeader, bill?.updated_at ?? null);
  function changeHeader(field: keyof typeof serverHeader, value: string) {
    header.setValue((current) => ({ ...current, [field]: value }));
  }
  async function saveHeader() {
    if (!header.version || header.conflict) return;
    const submitted = header.value;
    try {
      const saved = await updateBill.mutateAsync({ patch: submitted, expectedVersion: header.version });
      header.markSaved(submitted, saved.updated_at);
    } catch { /* The retained draft and visible mutation error own recovery. */ }
  }
  function updateStatus(patch: ApBillUpdate) {
    if (bill) updateBill.mutate({ patch, expectedVersion: bill.updated_at });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <Link
        to="/admin/accounts-payable"
        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to A/P Outstanding
      </Link>

      {billQuery.isError ? <Card role="alert" className="p-4"><p>Bill could not load: {(billQuery.error as Error).message}</p><Button variant="outline" onClick={() => void billQuery.refetch()}>Retry loading bill</Button></Card> : null}
      {linesQuery.isError ? <Card role="alert" className="p-4"><p>Voucher lines could not load.</p><Button variant="outline" onClick={() => void linesQuery.refetch()}>Retry loading lines</Button></Card> : null}
      {updateBill.isError ? <Card role="alert" className="p-4"><p>Bill not saved: {(updateBill.error as Error).message}</p><p>Your header draft is retained.</p><Button variant="outline" onClick={() => void billQuery.refetch()}>Reload saved bill</Button></Card> : null}
      {addLine.isError ? <Card role="alert" className="p-4"><p>Line not saved: {(addLine.error as Error).message}</p><Button variant="outline" onClick={() => addLine.mutate()}>Retry adding line</Button></Card> : null}
      {!bill ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {billQuery.isLoading ? "Loading bill…" : billQuery.isError ? "Saved bill unavailable." : "Bill not found."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Voucher header
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{bill.invoice_number}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{bill.vendor_name ?? "Vendor"} · {bill.description ?? "A/P bill"}</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <input aria-label="Invoice date" value={header.value.invoice_date} type="date" onChange={(e) => changeHeader("invoice_date", e.target.value)} className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
                <input aria-label="Due date" value={header.value.due_date} type="date" onChange={(e) => changeHeader("due_date", e.target.value)} className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
                <input value={header.value.payable_account_code} onChange={(e) => changeHeader("payable_account_code", e.target.value)} placeholder="Payable account code" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
                <input value={header.value.payable_account_name} onChange={(e) => changeHeader("payable_account_name", e.target.value)} placeholder="Payable account name" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              </div>

              <textarea value={header.value.notes} onChange={(e) => changeHeader("notes", e.target.value)} placeholder="Notes" className="mt-4 min-h-[110px] w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />

              <div className="mt-3 space-y-2">
                <p role="status" className="text-sm">{updateBill.isPending ? "Saving…" : header.dirty ? header.storageError ? "Unsaved draft; local storage unavailable. Keep this page open." : "Unsaved draft retained on this device." : "Saved"}</p>
                {header.conflict ? <div role="alert"><p>The saved bill changed. Review it before saving your draft.</p>
                  <Button variant="outline" onClick={header.acceptServer}>Discard draft and load latest</Button>
                  <Button variant="outline" onClick={header.retainAgainstLatest}>Keep draft against latest version</Button>
                  <details><summary>Latest saved header</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(serverHeader, null, 2)}</pre></details>
                </div> : null}
                <Button disabled={updateBill.isPending || !header.dirty || header.conflict} onClick={() => void saveHeader()}>{updateBill.isError ? "Retry saving header" : "Save header"}</Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" disabled={updateBill.isPending} onClick={() => updateStatus({ approval_status: "approved", status: "approved", approved_at: new Date().toISOString() })}>
                  Approve
                </Button>
                <Button variant="outline" disabled={updateBill.isPending} onClick={() => updateStatus({ approval_status: "rejected", status: "draft" })}>
                  Reject
                </Button>
                <Button variant="outline" disabled={updateBill.isPending} onClick={() => updateStatus({ status: "paid", amount_paid: bill.total_amount, last_payment_at: new Date().toISOString() })}>
                  Mark Paid
                </Button>
              </div>
            </Card>

            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Voucher totals
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-semibold">{currency(bill.subtotal_amount)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Tax</span><span className="font-semibold">{currency(bill.tax_amount)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold">{currency(bill.total_amount)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Paid</span><span className="font-semibold">{currency(bill.amount_paid)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Outstanding</span><span className="font-semibold">{currency(bill.balance_due)}</span></div>
              </div>
              <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 p-4 text-sm">
                Status: <span className="font-semibold">{bill.status}</span><br />
                Approval: <span className="font-semibold">{bill.approval_status}</span>
              </div>
            </Card>
          </div>

          <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Voucher information
            </p>
            <div className="mt-4 space-y-3">
              {lines.map((line) => (
                <div key={line.id} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{line.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {line.gl_code ?? "No GL code"} · {line.gl_name ?? "No GL name"}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p>{line.quantity} × {currency(line.unit_cost)}</p>
                      <p className="font-semibold">{currency(line.line_total)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-[1.4fr_100px_120px_140px_1fr]">
              <input value={newLineDescription} onChange={(e) => setNewLineDescription(e.target.value)} placeholder="Description" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineQuantity} onChange={(e) => setNewLineQuantity(e.target.value)} placeholder="Qty" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineUnitCost} onChange={(e) => setNewLineUnitCost(e.target.value)} placeholder="Unit cost" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineGlCode} onChange={(e) => setNewLineGlCode(e.target.value)} placeholder="GL code" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineGlName} onChange={(e) => setNewLineGlName(e.target.value)} placeholder="GL name" className="min-w-0 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </div>
            <Button className="mt-3" onClick={() => addLine.mutate()} disabled={addLine.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Add voucher line
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
