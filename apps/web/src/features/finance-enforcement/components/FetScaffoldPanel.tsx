import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Calculator } from "lucide-react";
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
import { useFetCategories } from "../hooks/use-finance-enforcement";
import { computeFet } from "../lib/finance-enforcement-api";
import type { FetCategoryRow } from "../lib/finance-enforcement-api";

interface FetScaffoldPanelProps {
  workspaceId: string;
}

/** Format a plain USD number, e.g. 12345 → "$12,345.00". */
function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format a decimal rate as a percent, e.g. 0.12 → "12.00%". */
function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * Federal Excise Tax (12%, Form 720) scaffold (mig 660).
 *
 * Lists the FET-taxable unit categories and provides a calculator that runs the
 * compute_fet RPC, honoring exemption certificates that zero the liability.
 */
export function FetScaffoldPanel({ workspaceId }: FetScaffoldPanelProps) {
  const categories = useFetCategories(workspaceId);

  const [taxableAmount, setTaxableAmount] = useState("");
  const [isExempt, setIsExempt] = useState(false);

  const compute = useMutation({
    mutationFn: async (params: { taxableAmount: number; isExempt: boolean }) => {
      const fet = await computeFet(params);
      return { fet, isExempt: params.isExempt };
    },
  });

  const parsedAmount = Number(taxableAmount);
  const amountValid = taxableAmount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount >= 0;

  const onCompute = () => {
    if (!amountValid) return;
    compute.mutate({ taxableAmount: parsedAmount, isExempt });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Federal Excise Tax (FET)</CardTitle>
        <CardDescription>FET-taxable unit categories and 12% liability calculator.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AsyncSection<FetCategoryRow>
          isLoading={categories.isLoading}
          isError={categories.isError}
          error={categories.error}
          data={categories.data}
          loadingLabel="Loading FET categories…"
          emptyLabel="No FET categories configured."
        >
          {(rows) => (
            <Table>
              <TableCaption className="text-left text-[11px] leading-relaxed">
                Federal Excise Tax (12%, Form 720) applies to grapple trucks / bodies;
                exemption certificates zero the liability.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Category code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.category_code}</TableCell>
                    <TableCell className="text-muted-foreground">{row.description ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.fet_rate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "success" : "outline"}>
                        {row.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AsyncSection>

        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fet-taxable-amount">Taxable amount</Label>
              <Input
                id="fet-taxable-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={taxableAmount}
                onChange={(e) => setTaxableAmount(e.target.value)}
                placeholder="0.00"
                className="w-48"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fet-exempt">Exempt</Label>
              <Select
                value={isExempt ? "yes" : "no"}
                onValueChange={(v) => setIsExempt(v === "yes")}
              >
                <SelectTrigger id="fet-exempt" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onCompute} disabled={compute.isPending || !amountValid}>
              {compute.isPending
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                : <Calculator className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
              Compute FET
            </Button>
          </div>
          <div role="status" aria-live="polite" className="min-h-5 text-sm">
            {compute.isError && (
              <span className="text-destructive">{financeErrorMessage(compute.error)}</span>
            )}
            {!compute.isError && compute.isSuccess && (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">FET (12%):</span>
                {compute.data.isExempt ? (
                  <Badge variant="outline">$0.00 (exemption applied)</Badge>
                ) : (
                  <Badge variant="secondary" className="tabular-nums">
                    {formatUsd(compute.data.fet)}
                  </Badge>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Federal Excise Tax (12%, Form 720) applies to grapple trucks / bodies;
            exemption certificates zero the liability.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
