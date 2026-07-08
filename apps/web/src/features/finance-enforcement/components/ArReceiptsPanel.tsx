import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, HandCoins } from "lucide-react";
import { useOpenCustomerInvoices, useArActions } from "../hooks/use-finance-enforcement";
import { AsyncSection, financeErrorMessage } from "./AsyncSection";
import type { ArTenderType, OpenCustomerInvoiceRow } from "../lib/finance-enforcement-api";
import { allocatePaymentOldestFirst, allocationTotal } from "../lib/ar-receipts-utils";

interface ArReceiptsPanelProps {
  workspaceId: string;
  currentUserRole?: string;
}

/** Cash application is finance work; branch managers also take walk-in checks. */
function canWrite(role: string | undefined): boolean {
  return role === "manager" || role === "owner" || role === "admin" || role === "finance_admin";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatUsd(amount: number): string {
  return usd.format(Number.isFinite(amount) ? amount : 0);
}

const TENDER_TYPES: Array<{ value: ArTenderType; label: string }> = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "wire", label: "Wire" },
  { value: "other", label: "Other" },
];

type CompanyGroup = {
  companyId: string;
  companyName: string;
  invoices: OpenCustomerInvoiceRow[];
  totalDue: number;
};

/**
 * AR receipts desk (M3.1, blueprint §6): apply one physical tender —
 * check/ACH/cash/card/wire — across a customer's open invoices. The
 * record_ar_payment RPC enforces the double-pay guard server-side; this
 * surface waterfalls the tender oldest-due-first and shows the allocation
 * before posting.
 */
export function ArReceiptsPanel({ workspaceId, currentUserRole }: ArReceiptsPanelProps) {
  const invoicesQuery = useOpenCustomerInvoices(workspaceId);
  const { pay } = useArActions(workspaceId);
  const writable = canWrite(currentUserRole);

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [tenderType, setTenderType] = useState<ArTenderType>("check");
  const [amountInput, setAmountInput] = useState("");
  const [reference, setReference] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const groups = useMemo<CompanyGroup[]>(() => {
    const byCompany = new Map<string, CompanyGroup>();
    for (const invoice of invoicesQuery.data ?? []) {
      if (!invoice.crm_company_id) continue;
      const group = byCompany.get(invoice.crm_company_id) ?? {
        companyId: invoice.crm_company_id,
        companyName: invoice.company_name ?? "Unknown customer",
        invoices: [],
        totalDue: 0,
      };
      group.invoices.push(invoice);
      group.totalDue = Math.round((group.totalDue + invoice.balance_due) * 100) / 100;
      byCompany.set(invoice.crm_company_id, group);
    }
    return [...byCompany.values()].sort((a, b) => b.totalDue - a.totalDue);
  }, [invoicesQuery.data]);

  const selectedGroup = groups.find((group) => group.companyId === selectedCompanyId) ?? null;
  const amount = Number(amountInput);
  const allocation = useMemo(() => {
    if (!selectedGroup || !Number.isFinite(amount) || amount <= 0) return [];
    return allocatePaymentOldestFirst(amount, selectedGroup.invoices);
  }, [selectedGroup, amount]);
  const appliedTotal = allocationTotal(allocation);
  const unapplied = Math.round((amount - appliedTotal) * 100) / 100;

  function closeDialog() {
    setSelectedCompanyId(null);
    setAmountInput("");
    setReference("");
    setFormError(null);
    pay.reset();
  }

  async function submit() {
    setFormError(null);
    if (!selectedGroup) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter a positive tender amount.");
      return;
    }
    if (allocation.length === 0) {
      setFormError("Nothing to apply — the customer has no open balance.");
      return;
    }
    try {
      await pay.mutateAsync({
        crmCompanyId: selectedGroup.companyId,
        tenderType,
        amount,
        applications: allocation,
        reference: reference.trim() || null,
      });
      closeDialog();
    } catch {
      // pay.error renders below; keep the dialog open for correction.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoins className="h-4 w-4" aria-hidden="true" />
          Receive payments
        </CardTitle>
        <CardDescription>
          Apply checks, ACH, cash, and card payments across a customer's open invoices.
          Applied balances stop AR dunning and release automatic credit holds on the next sweep.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AsyncSection
          isLoading={invoicesQuery.isLoading}
          isError={invoicesQuery.isError}
          error={invoicesQuery.error}
          data={invoicesQuery.data ? groups : undefined}
          emptyLabel="No open receivables — every company-anchored invoice is settled."
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Open invoices</TableHead>
                    <TableHead className="text-right">Balance due</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rows as CompanyGroup[]).map((group) => (
                    <TableRow key={group.companyId}>
                      <TableCell className="font-medium">{group.companyName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{group.invoices.length}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatUsd(group.totalDue)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!writable}
                          title={writable ? undefined : "Requires manager or finance access"}
                          onClick={() => {
                            setSelectedCompanyId(group.companyId);
                            setAmountInput(String(group.totalDue));
                          }}
                        >
                          Receive payment
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AsyncSection>
      </CardContent>

      <Dialog open={selectedGroup != null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Receive payment — {selectedGroup?.companyName}</DialogTitle>
            <DialogDescription>
              One physical tender applied oldest-due-first across {selectedGroup?.invoices.length ?? 0} open
              invoice{(selectedGroup?.invoices.length ?? 0) === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ar-tender-type">Tender type</Label>
              <select
                id="ar-tender-type"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={tenderType}
                onChange={(e) => setTenderType(e.target.value as ArTenderType)}
              >
                {TENDER_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ar-tender-amount">Amount</Label>
              <Input
                id="ar-tender-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ar-tender-reference">Reference (check #, ACH id)</Label>
              <Input
                id="ar-tender-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. check 4471"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-1 text-sm">
            <p className="font-medium">Allocation preview</p>
            {allocation.length === 0 ? (
              <p className="text-muted-foreground">Enter an amount to preview the application.</p>
            ) : (
              <ul className="space-y-0.5">
                {allocation.map((app) => {
                  const invoice = selectedGroup?.invoices.find((row) => row.id === app.invoice_id);
                  return (
                    <li key={app.invoice_id} className="flex justify-between">
                      <span className="font-mono">{invoice?.invoice_number ?? app.invoice_id}</span>
                      <span className="font-mono">{formatUsd(app.amount)}</span>
                    </li>
                  );
                })}
                {unapplied > 0 && (
                  <li className="flex justify-between text-muted-foreground">
                    <span>Unapplied (on account)</span>
                    <span className="font-mono">{formatUsd(unapplied)}</span>
                  </li>
                )}
              </ul>
            )}
          </div>

          {(formError || pay.isError) && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError ?? financeErrorMessage(pay.error)}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
            <Button onClick={submit} disabled={pay.isPending || allocation.length === 0}>
              {pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Post payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
