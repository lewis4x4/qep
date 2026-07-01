import { useState } from "react";
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
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { Loader2, ScanSearch, Send, Wallet } from "lucide-react";
import { useVendorInvoices, useApActions } from "../hooks/use-finance-enforcement";
import { AsyncSection, financeErrorMessage } from "./AsyncSection";
import type { ApMatchStatus, VendorInvoiceRow } from "../lib/finance-enforcement-api";

interface ApThreeWayMatchPanelProps {
  workspaceId: string;
  currentUserRole?: string;
}

/** Write actions (match / route / pay) are gated to manager / owner / admin. */
function canWrite(role: string | undefined): boolean {
  return role === "manager" || role === "owner" || role === "admin";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Format a monetary value to USD. The AP adapter returns whole-dollar `number`
 * amounts; this helper accepts a plain number and renders it as currency.
 */
function formatUsd(amount: number): string {
  return usd.format(Number.isFinite(amount) ? amount : 0);
}

const MATCH_STATUS_LABEL: Record<ApMatchStatus, string> = {
  unmatched: "Unmatched",
  matched: "Matched",
  price_mismatch: "Price mismatch",
  quantity_mismatch: "Quantity mismatch",
  partial: "Partial",
};

function matchBadgeVariant(
  status: ApMatchStatus | null,
): "success" | "destructive" | "secondary" | "outline" {
  if (status === "matched") return "success";
  if (status === "price_mismatch" || status === "quantity_mismatch") return "destructive";
  if (status === "partial") return "secondary";
  return "outline";
}

function matchStatusLabel(status: ApMatchStatus | null): string {
  return status ? MATCH_STATUS_LABEL[status] : "Unmatched";
}

function holdBadgeVariant(holdStatus: string): "outline" | "destructive" {
  return holdStatus && holdStatus.toLowerCase() !== "none" ? "destructive" : "outline";
}

const REQUIRES_APPROVAL = "Requires manager approval";

/**
 * AP 3-way-match workbench.
 *
 * Lists vendor invoices with their status, hold, and PO ↔ receipt ↔ invoice
 * match state. Managers can run the 3-way match, route an invoice through the
 * Section 9.3 approval matrix, and record a payment. The double-pay guard lives
 * in `record_ap_payment` server-side; its error is surfaced in the dialog.
 */
export function ApThreeWayMatchPanel({
  workspaceId,
  currentUserRole,
}: ApThreeWayMatchPanelProps) {
  const invoices = useVendorInvoices(workspaceId);
  const { match, route, pay } = useApActions(workspaceId);

  const isManager = canWrite(currentUserRole);

  // Payment dialog state.
  const [payInvoice, setPayInvoice] = useState<VendorInvoiceRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payReference, setPayReference] = useState("");

  function openPayDialog(invoice: VendorInvoiceRow): void {
    setPayInvoice(invoice);
    setPayAmount(String(invoice.balance_due ?? 0));
    setPayMethod("");
    setPayReference("");
    pay.reset();
  }

  function closePayDialog(): void {
    setPayInvoice(null);
    pay.reset();
  }

  function handlePaySubmit(): void {
    if (!payInvoice) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    pay.mutate(
      {
        vendorInvoiceId: payInvoice.id,
        amount,
        method: payMethod.trim() || undefined,
        reference: payReference.trim() || undefined,
      },
      { onSuccess: () => closePayDialog() },
    );
  }

  const parsedPayAmount = Number(payAmount);
  const payAmountValid = Number.isFinite(parsedPayAmount) && parsedPayAmount > 0;

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle>AP 3-way match workbench</CardTitle>
          <CardDescription>
            3-way match reconciles PO ↔ receipt ↔ invoice; approval routing follows the
            Section 9.3 matrix; the double-pay guard blocks paying an invoice twice or beyond
            its balance.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <AsyncSection
            isLoading={invoices.isLoading}
            isError={invoices.isError}
            error={invoices.error}
            data={invoices.data}
            loadingLabel="Loading vendor invoices…"
            emptyLabel="No vendor invoices."
          >
            {(rows) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hold</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((invoice) => {
                    const matchPending =
                      match.isPending && match.variables === invoice.id;
                    const routePending =
                      route.isPending && route.variables === invoice.id;
                    const matchErrored =
                      match.isError && match.variables === invoice.id;
                    const routeErrored =
                      route.isError && route.variables === invoice.id;
                    const matchResult =
                      match.isSuccess && match.variables === invoice.id
                        ? match.data
                        : null;

                    const writeDisabled = !isManager;

                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium tabular-nums">
                          {invoice.vendor_invoice_number}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatUsd(invoice.amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatUsd(invoice.balance_due)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{invoice.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={holdBadgeVariant(invoice.hold_status)}>
                            {invoice.hold_status || "none"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={matchBadgeVariant(invoice.match_status)}
                            aria-label={`Match status: ${matchStatusLabel(invoice.match_status)}`}
                          >
                            {matchStatusLabel(invoice.match_status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <GatedButton
                              disabled={writeDisabled || matchPending}
                              gated={writeDisabled}
                              onClick={() => match.mutate(invoice.id)}
                            >
                              {matchPending ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : (
                                <ScanSearch className="mr-1 h-3.5 w-3.5" aria-hidden />
                              )}
                              Run 3-way match
                            </GatedButton>
                            <GatedButton
                              disabled={writeDisabled || routePending}
                              gated={writeDisabled}
                              onClick={() => route.mutate(invoice.id)}
                            >
                              {routePending ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : (
                                <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
                              )}
                              Route for approval
                            </GatedButton>
                            <GatedButton
                              disabled={writeDisabled}
                              gated={writeDisabled}
                              onClick={() => openPayDialog(invoice)}
                            >
                              <Wallet className="mr-1 h-3.5 w-3.5" aria-hidden />
                              Record payment
                            </GatedButton>
                          </div>
                          {(matchResult || matchErrored || routeErrored) && (
                            <div
                              className="mt-1 flex justify-end text-[11px]"
                              role="status"
                              aria-live="polite"
                            >
                              {matchResult && (
                                <span className="text-muted-foreground">
                                  Match: {matchStatusLabel(matchResult)}
                                </span>
                              )}
                              {matchErrored && (
                                <span className="text-destructive" role="alert">
                                  {financeErrorMessage(match.error)}
                                </span>
                              )}
                              {routeErrored && (
                                <span className="text-destructive" role="alert">
                                  {financeErrorMessage(route.error)}
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </AsyncSection>
        </CardContent>
      </Card>

      <Dialog open={payInvoice !== null} onOpenChange={(open) => (!open ? closePayDialog() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record AP payment</DialogTitle>
            <DialogDescription>
              {payInvoice
                ? `Record a payment against vendor invoice ${payInvoice.vendor_invoice_number}. The double-pay guard blocks paying twice or beyond the balance.`
                : "Record a payment against the selected vendor invoice."}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handlePaySubmit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ap-pay-amount">Amount (USD)</Label>
              <Input
                id="ap-pay-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                aria-invalid={payAmount.length > 0 && !payAmountValid}
                aria-describedby="ap-pay-amount-help"
                autoComplete="off"
              />
              <p id="ap-pay-amount-help" className="text-[11px] text-muted-foreground">
                {payInvoice
                  ? `Balance due: ${formatUsd(payInvoice.balance_due)}. Defaults to full balance.`
                  : "Enter the payment amount."}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-pay-method">Method (optional)</Label>
                <Input
                  id="ap-pay-method"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  placeholder="e.g. ACH, check"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-pay-reference">Reference (optional)</Label>
                <Input
                  id="ap-pay-reference"
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="e.g. CHK-10231"
                  autoComplete="off"
                />
              </div>
            </div>

            {pay.isError && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {financeErrorMessage(pay.error)}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closePayDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={!payAmountValid || pay.isPending}>
                {pay.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Wallet className="mr-1 h-4 w-4" aria-hidden />
                )}
                Confirm payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

interface GatedButtonProps {
  disabled: boolean;
  /** When true, the button is disabled for lack of permission and shows the approval tooltip. */
  gated: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

/**
 * A small write-action button. When `gated`, it renders disabled and wraps the
 * trigger in a tooltip explaining that manager approval is required.
 */
function GatedButton({ disabled, gated, onClick, children }: GatedButtonProps) {
  const button = (
    <Button size="sm" variant="outline" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );

  if (!gated) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span keeps the tooltip interactive while the button is disabled */}
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{REQUIRES_APPROVAL}</TooltipContent>
    </Tooltip>
  );
}
