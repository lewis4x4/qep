import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption,
} from "@/components/ui/table";
import { AsyncSection, financeErrorMessage } from "./AsyncSection";
import {
  useInvoiceSequences, useGenerateInvoiceNumber,
} from "../hooks/use-finance-enforcement";
import type { InvoiceDeptType, InvoiceSequenceRow } from "../lib/finance-enforcement-api";

interface InvoiceNumberingPanelProps {
  workspaceId: string;
}

const INVOICE_TYPES: InvoiceDeptType[] = ["equipment", "parts", "service", "rental", "general"];

/**
 * Branch-prefixed invoice numbering (mig 655).
 *
 * Shows the per-(branch, dept) counters and a generate control that consumes
 * the next company-wide-unique number in the locked `01-E1000` format.
 */
export function InvoiceNumberingPanel({ workspaceId }: InvoiceNumberingPanelProps) {
  const sequences = useInvoiceSequences(workspaceId);
  const generate = useGenerateInvoiceNumber(workspaceId);

  const [branchLegacyCode, setBranchLegacyCode] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceDeptType>("equipment");
  const [lastNumber, setLastNumber] = useState<string | null>(null);

  const branchValid = /^\d{2}$/.test(branchLegacyCode);

  const onGenerate = () => {
    if (!branchValid) return;
    generate.mutate(
      { branchLegacyCode, invoiceType },
      { onSuccess: (num) => setLastNumber(num) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invoice numbering</CardTitle>
        <CardDescription>
          Company-wide-unique, branch-prefixed invoice numbers (format 01-E1000).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AsyncSection<InvoiceSequenceRow>
          isLoading={sequences.isLoading}
          isError={sequences.isError}
          error={sequences.error}
          data={sequences.data}
          loadingLabel="Loading invoice sequences…"
          emptyLabel="No invoice sequences yet."
        >
          {(rows) => (
            <Table>
              <TableCaption>Next value is consumed each time a number is generated.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch code</TableHead>
                  <TableHead>Dept prefix</TableHead>
                  <TableHead className="text-right">Next value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.branch_legacy_code}</TableCell>
                    <TableCell>{row.dept_prefix}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.next_value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AsyncSection>

        <div className="space-y-3 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="branch-legacy-code">Branch legacy code</Label>
              <Input
                id="branch-legacy-code"
                inputMode="numeric"
                maxLength={2}
                placeholder="01"
                value={branchLegacyCode}
                onChange={(e) => setBranchLegacyCode(e.target.value.replace(/\D/g, "").slice(0, 2))}
                aria-describedby="branch-legacy-code-hint"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-type">Invoice type</Label>
              <Select
                value={invoiceType}
                onValueChange={(v) => setInvoiceType(v as InvoiceDeptType)}
              >
                <SelectTrigger id="invoice-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onGenerate} disabled={!branchValid || generate.isPending}>
              {generate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Generate next number
            </Button>
          </div>

          <p id="branch-legacy-code-hint" className="text-xs text-muted-foreground">
            Generating consumes a number — only generate when an invoice is actually being created.
            Branch code must be 2 digits.
          </p>

          <div className="min-h-[1.5rem]" role="status" aria-live="polite">
            {generate.isError && (
              <p className="text-sm text-destructive">{financeErrorMessage(generate.error)}</p>
            )}
            {!generate.isError && lastNumber && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Generated:</span>
                <Badge variant="secondary" className="font-mono tabular-nums">{lastNumber}</Badge>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
