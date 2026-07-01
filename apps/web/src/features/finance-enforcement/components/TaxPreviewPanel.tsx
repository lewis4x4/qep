import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { financeErrorMessage } from "./AsyncSection";
import { usePreviewTax } from "../hooks/use-finance-enforcement";
import type { TaxLineItemInput } from "../lib/finance-enforcement-api";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/**
 * County sales tax + Ship-To sourcing + per-item surtax cap (mig 656, edge fn).
 *
 * Previews FL tax for a subtotal sourced by Ship-To county, applying the
 * discretionary surtax $5,000-per-single-item cap across the supplied line items.
 */
export function TaxPreviewPanel() {
  const preview = usePreviewTax();

  const [subtotal, setSubtotal] = useState("");
  const [shipToCounty, setShipToCounty] = useState("Columbia");
  const [lineItems, setLineItems] = useState<TaxLineItemInput[]>([
    { description: "", taxable_amount: 0 },
  ]);

  const addLineItem = () =>
    setLineItems((items) => [...items, { description: "", taxable_amount: 0 }]);

  const removeLineItem = (index: number) =>
    setLineItems((items) => items.filter((_, i) => i !== index));

  const updateLineItem = (index: number, patch: Partial<TaxLineItemInput>) =>
    setLineItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const subtotalNum = Number(subtotal);
  const canPreview = subtotal.trim() !== "" && Number.isFinite(subtotalNum) && subtotalNum >= 0;

  const onPreview = () => {
    if (!canPreview) return;
    preview.mutate({
      subtotal: subtotalNum,
      shipToCounty: shipToCounty.trim() || null,
      deliveryState: "FL",
      lineItems: lineItems.filter((li) => Number.isFinite(li.taxable_amount)),
    });
  };

  const result = preview.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tax preview</CardTitle>
        <CardDescription>Florida sales tax, sourced by Ship-To county.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tax-subtotal">Subtotal</Label>
            <Input
              id="tax-subtotal"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-ship-to-county">Ship-To county</Label>
            <Input
              id="tax-ship-to-county"
              placeholder="Columbia"
              value={shipToCounty}
              onChange={(e) => setShipToCounty(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Line items</Label>
            <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add item
            </Button>
          </div>
          <div className="space-y-2">
            {lineItems.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor={`tax-li-desc-${index}`} className="sr-only">
                    Line item {index + 1} description
                  </Label>
                  <Input
                    id={`tax-li-desc-${index}`}
                    placeholder="Description"
                    value={item.description ?? ""}
                    onChange={(e) => updateLineItem(index, { description: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`tax-li-amount-${index}`} className="sr-only">
                    Line item {index + 1} taxable amount
                  </Label>
                  <Input
                    id={`tax-li-amount-${index}`}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Taxable amount"
                    value={Number.isFinite(item.taxable_amount) ? item.taxable_amount : ""}
                    onChange={(e) =>
                      updateLineItem(index, { taxable_amount: Number(e.target.value) })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLineItem(index)}
                  disabled={lineItems.length <= 1}
                  aria-label={`Remove line item ${index + 1}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onPreview} disabled={!canPreview || preview.isPending}>
            {preview.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            Preview tax
          </Button>
        </div>

        <div role="status" aria-live="polite">
          {preview.isError && (
            <p className="text-sm text-destructive">{financeErrorMessage(preview.error)}</p>
          )}
        </div>

        {result && !preview.isError && (
          <div className="space-y-4">
            <Separator />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="State tax" value={usd(result.state_tax)} />
              <Metric label="County tax" value={usd(result.county_tax)} />
              <Metric label="Total tax" value={usd(result.total_tax)} />
              <Metric label="Taxable basis" value={usd(result.taxable_basis)} />
            </div>

            {result.tax_lines.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.tax_lines.map((line, i) => (
                    <TableRow key={`${line.label}-${i}`}>
                      <TableCell className="font-medium">{line.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(line.rate * 100).toFixed(3)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{usd(line.amount)}</TableCell>
                      <TableCell>
                        {line.cap_applied != null && (
                          <Badge variant="secondary">per-item $5k cap</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          FL discretionary surtax is capped at $5,000 per single item; tax sourced by Ship-To county.
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
