import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, FileWarning } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption,
} from "@/components/ui/table";
import { AsyncSection, financeErrorMessage } from "./AsyncSection";
import { useForm8300Reports } from "../hooks/use-finance-enforcement";
import { evaluateForm8300 } from "../lib/finance-enforcement-api";
import type { Form8300Row } from "../lib/finance-enforcement-api";

interface Form8300PanelProps {
  workspaceId: string;
}

type Form8300Status = Form8300Row["status"];

const STATUS_VARIANT: Record<
  Form8300Status,
  "default" | "secondary" | "destructive" | "outline" | "success"
> = {
  flagged: "secondary",
  filed: "success",
  void: "outline",
  exempt: "default",
};

const STATUS_LABEL: Record<Form8300Status, string> = {
  flagged: "Flagged",
  filed: "Filed",
  void: "Void",
  exempt: "Exempt",
};

/** Format a plain USD number, e.g. 12345 → "$12,345.00". */
function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/**
 * Form 8300 (cash > $10k) reporting surface (mig 660).
 *
 * Lists cash-transaction reports and lets an operator re-evaluate a specific
 * invoice against the $10,000 cash threshold, invalidating the reports read on
 * success so a newly-flagged report appears immediately.
 */
export function Form8300Panel({ workspaceId }: Form8300PanelProps) {
  const reports = useForm8300Reports(workspaceId);
  const qc = useQueryClient();

  const [invoiceId, setInvoiceId] = useState("");

  const reevaluate = useMutation({
    mutationFn: (id: string) => evaluateForm8300(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["fin", "form-8300", workspaceId] }),
  });

  const trimmedId = invoiceId.trim();

  const onReevaluate = () => {
    if (!trimmedId) return;
    reevaluate.mutate(trimmedId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Form 8300 cash reports</CardTitle>
        <CardDescription>Cash transactions flagged for IRS Form 8300 reporting.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AsyncSection<Form8300Row>
          isLoading={reports.isLoading}
          isError={reports.isError}
          error={reports.error}
          data={reports.data}
          loadingLabel="Loading Form 8300 reports…"
          emptyLabel="No Form 8300 cash reports (> $10,000)."
        >
          {(rows) => (
            <Table>
              <TableCaption className="text-left text-[11px] leading-relaxed">
                IRS Form 8300 is required for cash payments over $10,000.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Cash amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Flagged at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.invoice_id ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(row.cash_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDate(row.flagged_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AsyncSection>

        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="form8300-invoice-id">Invoice ID</Label>
              <Input
                id="form8300-invoice-id"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                placeholder="Invoice UUID"
                className="w-72"
              />
            </div>
            <Button onClick={onReevaluate} disabled={reevaluate.isPending || !trimmedId}>
              {reevaluate.isPending
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                : <FileWarning className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
              Re-evaluate Form 8300
            </Button>
          </div>
          <div role="status" aria-live="polite" className="min-h-5 text-sm">
            {reevaluate.isError && (
              <span className="text-destructive">{financeErrorMessage(reevaluate.error)}</span>
            )}
            {!reevaluate.isError && reevaluate.isSuccess && (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Result:</span>
                {reevaluate.data ? (
                  <Badge variant="secondary" className="tabular-nums">{reevaluate.data}</Badge>
                ) : (
                  <Badge variant="outline">no report needed</Badge>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            IRS Form 8300 is required for cash payments over $10,000.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
