import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, FileStack, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequireAdmin } from "@/components/RequireAdmin";
import { supabase } from "@/lib/supabase";
import { labelAgeBucket, sumApAmounts, type ApAgingBucket } from "../lib/ap-aging-utils";

type AgingRow = {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payable_account_code: string | null;
  payable_account_name: string | null;
  description: string | null;
  status: string;
  approval_status: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  due_age_bucket: ApAgingBucket;
  invoice_age_bucket: ApAgingBucket;
  days_overdue: number;
  days_from_invoice: number;
};

type VendorRow = {
  id: string;
  name: string;
};

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function AccountsPayablePage() {
  return (
    <RequireAdmin>
      <AccountsPayablePageInner />
    </RequireAdmin>
  );
}

function AccountsPayablePageInner() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [agingMethod, setAgingMethod] = useState<"due" | "invoice">("due");
  const [bucketFilter, setBucketFilter] = useState<ApAgingBucket | "all">("all");
  const [vendorId, setVendorId] = useState("");
  const [payableAccount, setPayableAccount] = useState("");

  const [newVendorId, setNewVendorId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [payableAccountCode, setPayableAccountCode] = useState("");
  const [payableAccountName, setPayableAccountName] = useState("");
  const [description, setDescription] = useState("");

  const vendorsQuery = useQuery({
    queryKey: ["ap-vendors"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: VendorRow[] | null; error: unknown }> };
        };
      })
        .from("vendor_profiles")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const agingQuery = useQuery({
    queryKey: ["accounts-payable-aging"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: AgingRow[] | null; error: unknown }> };
        };
      })
        .from("ap_aging_view")
        .select("*")
        .order("balance_due", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createBill = useMutation({
    mutationFn: async () => {
      const vendor = (vendorsQuery.data ?? []).find((row) => row.id === newVendorId);
      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: unknown }> };
      })
        .from("ap_bills")
        .insert({
          vendor_id: newVendorId || null,
          vendor_name: vendor?.name ?? null,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate,
          due_date: dueDate,
          payable_account_code: payableAccountCode.trim() || null,
          payable_account_name: payableAccountName.trim() || null,
          description: description.trim() || null,
          status: "pending_approval",
          approval_status: "pending",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts-payable-aging"] });
      setNewVendorId("");
      setInvoiceNumber("");
      setInvoiceDate("");
      setDueDate("");
      setPayableAccountCode("");
      setPayableAccountName("");
      setDescription("");
    },
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (agingQuery.data ?? []).filter((row) => {
      const bucket = agingMethod === "due" ? row.due_age_bucket : row.invoice_age_bucket;
      if (bucketFilter !== "all" && bucket !== bucketFilter) return false;
      if (vendorId && row.vendor_id !== vendorId) return false;
      if (payableAccount && row.payable_account_code !== payableAccount) return false;
      if (!needle) return true;
      return [
        row.vendor_name,
        row.invoice_number,
        row.payable_account_code,
        row.payable_account_name,
        row.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [agingMethod, agingQuery.data, bucketFilter, payableAccount, search, vendorId]);

  const bucketTotals = useMemo(() => {
    const source = filtered;
    return (["current", "31_60", "61_90", "91_120", "over_120"] as ApAgingBucket[]).map((bucket) => {
      const rows = source.filter((row) => (agingMethod === "due" ? row.due_age_bucket : row.invoice_age_bucket) === bucket);
      return {
        bucket,
        count: rows.length,
        amount: sumApAmounts(rows),
      };
    });
  }, [agingMethod, filtered]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Phase 8 · Accounts Payable
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                A/P Outstanding
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Vendor bills, approval state, aging buckets by due or invoice date, and voucher drilldown.
              </p>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <FileStack className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor, invoice, payable account" className="min-w-[260px] rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            <select value={agingMethod} onChange={(e) => setAgingMethod(e.target.value as "due" | "invoice")} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <option value="due">Age by Due Date</option>
              <option value="invoice">Age by Invoice Date</option>
            </select>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <option value="">All vendors</option>
              {(vendorsQuery.data ?? []).map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
            <input value={payableAccount} onChange={(e) => setPayableAccount(e.target.value)} placeholder="Payable account code" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {bucketTotals.map((bucket) => (
              <button
                key={bucket.bucket}
                type="button"
                onClick={() => setBucketFilter(bucket.bucket)}
                className={`rounded-2xl border p-4 text-left transition ${
                  bucketFilter === bucket.bucket
                    ? "border-primary/30 bg-primary/[0.08] shadow-sm"
                    : "border-border/50 bg-background/70"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {labelAgeBucket(bucket.bucket)}
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{bucket.count}</p>
                <p className="mt-1 text-sm text-muted-foreground">{currency(bucket.amount)}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                New bill
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Create vendor bill</h2>
            </div>
            <Button onClick={() => createBill.mutate()} disabled={createBill.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Add bill
            </Button>
          </div>

          <div className="mt-4 grid gap-3">
            <select value={newVendorId} onChange={(e) => setNewVendorId(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <option value="">Select vendor</option>
              {(vendorsQuery.data ?? []).map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Invoice number" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={payableAccountCode} onChange={(e) => setPayableAccountCode(e.target.value)} placeholder="Payable account code" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
              <input value={payableAccountName} onChange={(e) => setPayableAccountName(e.target.value)} placeholder="Payable account name" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </div>
            {createBill.isError ? (
              <p className="text-sm text-destructive">{(createBill.error as Error).message}</p>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Outstanding details
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Vendor bills</h2>
          </div>
          {bucketFilter !== "all" ? (
            <Button variant="outline" size="sm" onClick={() => setBucketFilter("all")}>Clear bucket</Button>
          ) : null}
        </div>

        <div className="mt-4 space-y-3">
          {agingQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading A/P outstanding…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills match the current AP filters.</p>
          ) : (
            filtered.map((bill) => (
              <Link
                key={bill.id}
                to={`/admin/accounts-payable/${bill.id}`}
                className="block rounded-2xl border border-border/60 bg-background/70 p-4 transition hover:border-primary/25 hover:bg-background"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        setVendorId(bill.vendor_id ?? "");
                      }}
                      className="text-sm font-semibold text-foreground hover:text-primary"
                    >
                      {bill.vendor_name}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {bill.invoice_number} · {bill.payable_account_code ?? "No account"} · {bill.approval_status}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {bill.description ?? "Vendor invoice"} · due {bill.due_date}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">{currency(bill.balance_due)}</p>
                    <p className="mt-1">{agingMethod === "due" ? labelAgeBucket(bill.due_age_bucket) : labelAgeBucket(bill.invoice_age_bucket)}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-primary">
                      Voucher detail
                      <ArrowRight className="h-3.5 w-3.5" />
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
