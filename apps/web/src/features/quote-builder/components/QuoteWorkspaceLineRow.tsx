// Shared workspace line-row primitive — single editable row showing the
// title, qty, unit-price input, optional cost-visibility toggle, and a
// remove button. Used by Configure (PR 12), Pricing (PR 14), Promotions
// (PR 15), and any other surface that lists `QuoteLineItemDraft` items.
//
// Extracted from `QuoteBuilderV2Page.tsx` as part of PR 12 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence. Pure
// presentation — parents own the underlying state and pass callbacks.

import { DollarSign, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { quoteLineCostVisibility } from "../lib/quote-workspace";

import type {
  QuoteLineCostVisibility,
  QuoteLineItemDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

export interface QuoteWorkspaceLineRowProps {
  label: string;
  item: QuoteLineItemDraft;
  onPriceChange: (value: number) => void;
  onRemove: () => void;
  costVisibilityEditable?: boolean;
  onCostVisibilityChange?: (next: QuoteLineCostVisibility) => void;
}

export function QuoteWorkspaceLineRow({
  label,
  item,
  onPriceChange,
  onRemove,
  costVisibilityEditable,
  onCostVisibilityChange,
}: QuoteWorkspaceLineRowProps) {
  const title = item.title || [item.make, item.model].filter(Boolean).join(" ") || "Line item";
  const effectiveVisibility: QuoteLineCostVisibility = quoteLineCostVisibility(item);
  return (
    <div className="space-y-2">
      <div className="grid gap-3 rounded-lg border border-border/70 bg-card/50 p-3 sm:grid-cols-[120px_minmax(0,1fr)_150px_auto] sm:items-center">
        <span className="rounded-full bg-muted px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">Qty {item.quantity}</p>
        </div>
        <label className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="number"
            min={0}
            step={100}
            value={item.unitPrice}
            onChange={(event) => onPriceChange(Number(event.target.value) || 0)}
            className="w-full bg-transparent text-right text-sm font-semibold outline-none"
            aria-label={`Price for ${title}`}
          />
        </label>
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label={`Remove ${title}`}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {costVisibilityEditable && onCostVisibilityChange ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5 sm:pl-[132px]">
          <span className="text-[11px] text-muted-foreground">Customer proposal</span>
          <div className="inline-flex gap-0.5 rounded-md border border-border bg-background p-0.5">
            <Button
              type="button"
              size="sm"
              variant={effectiveVisibility === "customer" ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              onClick={() => onCostVisibilityChange("customer")}
            >
              Show line
            </Button>
            <Button
              type="button"
              size="sm"
              variant={effectiveVisibility === "internal" ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              onClick={() => onCostVisibilityChange("internal")}
            >
              Internal only
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
