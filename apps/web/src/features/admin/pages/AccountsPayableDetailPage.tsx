import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequireAdmin } from "@/components/RequireAdmin";
import { supabase } from "@/lib/supabase";

type BillRow = {
  id: string;
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
  const [newLineDescription, setNewLineDescription] = useState("");
  const [newLineQuantity, setNewLineQuantity] = useState("1");
  const [newLineUnitCost, setNewLineUnitCost] = useState("0");
  const [newLineGlCode, setNewLineGlCode] = useState("");
  const [newLineGlName, setNewLineGlName] = useState("");

  const billQuery = useQuery({
    queryKey: ["ap-bill", billId],
    enabled: billId.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: BillRow | null; error: unknown }> } };
        };
      })
        .from("ap_bills")
        .select("id, vendor_id, vendor_name, invoice_number, invoice_date, due_date, payable_account_code, payable_account_name, description, status, approval_status, subtotal_amount, tax_amount, total_amount, amount_paid, balance_due, notes")
        .eq("id", billId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const linesQuery = useQuery({
    queryKey: ["ap-bill-lines", billId],
    enabled: billId.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: LineRow[] | null; error: unknown }> } };
        };
      })
        .from("ap_bill_lines")
        .select("id, line_number, description, quantity, unit_cost, line_total, gl_code, gl_name, notes")
        .eq("bill_id", billId)
        .order("line_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateBill = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("ap_bills")
        .update(payload)
        .eq("id", billId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ap-bill", billId] }),
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const nextLine = (linesQuery.data?.length ?? 0) + 1;
      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: unknown }> };
      })
        .from("ap_bill_lines")
        .insert({
          bill_id: billId,
          line_number: nextLine,
          description: newLineDescription,
          quantity: Number(newLineQuantity || "1"),
          unit_cost: Number(newLineUnitCost || "0"),
          gl_code: newLineGlCode || null,
          gl_name: newLineGlName || null,
        });
      if (error) throw error;
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <Link
        to="/admin/accounts-payable"
        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to A/P Outstanding
      </Link>

      {!bill ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {billQuery.isLoading ? "Loading bill…" : "Bill not found."}
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
                <input defaultValue={bill.invoice_date} type="date" onBlur={(e) => updateBill.mutate({ invoice_date: e.target.value })} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
                <input defaultValue={bill.due_date} type="date" onBlur={(e) => updateBill.mutate({ due_date: e.target.value })} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
                <input defaultValue={bill.payable_account_code ?? ""} onBlur={(e) => updateBill.mutate({ payable_account_code: e.target.value || null })} placeholder="Payable account code" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
                <input defaultValue={bill.payable_account_name ?? ""} onBlur={(e) => updateBill.mutate({ payable_account_name: e.target.value || null })} placeholder="Payable account name" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              </div>

              <textarea defaultValue={bill.notes ?? ""} onBlur={(e) => updateBill.mutate({ notes: e.target.value || null })} placeholder="Notes" className="mt-4 min-h-[110px] w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => updateBill.mutate({ approval_status: "approved", status: "approved", approved_at: new Date().toISOString() })}>
                  Approve
                </Button>
                <Button variant="outline" onClick={() => updateBill.mutate({ approval_status: "rejected", status: "draft" })}>
                  Reject
                </Button>
                <Button variant="outline" onClick={() => updateBill.mutate({ status: "paid", amount_paid: bill.total_amount, last_payment_at: new Date().toISOString() })}>
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
              <input value={newLineDescription} onChange={(e) => setNewLineDescription(e.target.value)} placeholder="Description" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineQuantity} onChange={(e) => setNewLineQuantity(e.target.value)} placeholder="Qty" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineUnitCost} onChange={(e) => setNewLineUnitCost(e.target.value)} placeholder="Unit cost" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineGlCode} onChange={(e) => setNewLineGlCode(e.target.value)} placeholder="GL code" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={newLineGlName} onChange={(e) => setNewLineGlName(e.target.value)} placeholder="GL name" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
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
