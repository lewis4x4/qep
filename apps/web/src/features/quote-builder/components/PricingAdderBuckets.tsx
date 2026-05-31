/**
 * Cluster B — collapsible internal vs customer-facing pricing adder buckets.
 * IRON_QUOTE_DELTA_2026-05-14 item 5.
 */

import { DollarSign } from "lucide-react";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { money } from "../lib/money";
import {
  PRICING_ADDER_FIELDS,
  type CostVisibility,
  type PricingAdderField,
  type PricingLineKind,
} from "../lib/pricing-adder-fields";

export interface PricingAdderBucketsProps {
  draftPricingLines: QuoteLineItemDraft[];
  internalCostLoadTotal: number;
  pricingLineTotal: number;
  inboundFreightEligible: boolean;
  pricingLine: (fieldOrKind: PricingAdderField | PricingLineKind) => QuoteLineItemDraft | undefined;
  upsertPricingLine: (
    fieldOrKind: PricingAdderField | PricingLineKind,
    amount: number,
    patch?: Partial<QuoteLineItemDraft>,
    legacyTitle?: string,
    legacyCostVisibility?: CostVisibility,
  ) => void;
  miscChargeTitle: string;
  setMiscChargeTitle: (value: string) => void;
  miscChargeAmount: number;
  setMiscChargeAmount: (value: number) => void;
  miscCreditTitle: string;
  setMiscCreditTitle: (value: string) => void;
  miscCreditAmount: number;
  setMiscCreditAmount: (value: number) => void;
  onAddMiscPricingLine: (kind: "charge" | "credit") => void;
  onRemoveMiscLine: (line: QuoteLineItemDraft) => void;
  /** 1% of subtotal — drives the inline "Apply 1%" affordance on the good_faith card. */
  goodFaithSuggestion?: number;
}

export function PricingAdderBuckets({
  draftPricingLines,
  internalCostLoadTotal,
  pricingLineTotal,
  inboundFreightEligible,
  pricingLine,
  upsertPricingLine,
  miscChargeTitle,
  setMiscChargeTitle,
  miscChargeAmount,
  setMiscChargeAmount,
  miscCreditTitle,
  setMiscCreditTitle,
  miscCreditAmount,
  setMiscCreditAmount,
  onAddMiscPricingLine,
  onRemoveMiscLine,
  goodFaithSuggestion,
}: PricingAdderBucketsProps) {
  return (
    <div className="mt-4 space-y-3">
      <details
        className="rounded-lg border border-border/70 bg-background/20"
        open={internalCostLoadTotal > 0 ? true : undefined}
      >
        <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            <span>Internal cost adders (not shown to customer)</span>
            {internalCostLoadTotal > 0 ? (
              <span className="text-[11px] font-medium normal-case tracking-normal text-foreground">
                {money(internalCostLoadTotal)}
              </span>
            ) : null}
          </span>
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {PRICING_ADDER_FIELDS.filter((field) =>
              field.costVisibility === "internal"
              && (field.id !== "inbound_freight" || inboundFreightEligible))
              .map((field) => {
              const line = pricingLine(field);
              const isGoodFaith = field.id === "good_faith";
              const goodFaithApplyAmount = goodFaithSuggestion ?? 0;
              const showGoodFaithButton =
                isGoodFaith && goodFaithApplyAmount > 0 && line?.unitPrice !== goodFaithApplyAmount;
              return (
                <label key={field.id} className="rounded-lg border border-border/70 bg-card/50 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-foreground">{field.title}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{field.helper}</span>
                    </div>
                    {showGoodFaithButton && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-[11px] font-semibold"
                        onClick={(event) => {
                          event.preventDefault();
                          upsertPricingLine(field, goodFaithApplyAmount);
                        }}
                      >
                        Apply 1% ({money(goodFaithApplyAmount)})
                      </Button>
                    )}
                  </div>
                  {field.kind === "pdi" && line?.metadata?.pdi_source === "rolling_average_by_model" && (
                    <span className="mt-0.5 block text-[11px] text-qep-orange">
                      Prefilled from model history ({Number(line.metadata?.pdi_sample_count ?? 0)} sample{Number(line.metadata?.pdi_sample_count ?? 0) === 1 ? "" : "s"})
                    </span>
                  )}
                  <div className="mt-2 flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="number"
                      min={0}
                      step={field.step}
                      value={line?.unitPrice ?? ""}
                      onChange={(event) => upsertPricingLine(field, Number(event.target.value) || 0)}
                      placeholder="0"
                      className="w-full bg-transparent text-right text-sm font-semibold outline-none"
                    />
                  </div>
                </label>
              );
            })}
          </div>
          {!inboundFreightEligible && (
            <p className="text-[11px] text-muted-foreground">
              Inbound freight is hidden while all selected equipment is in stock because inbound cost is already baked into loaded machine cost.
            </p>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-border/70 bg-background/20">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            <span>Customer-facing charges (printed on quote)</span>
            {pricingLineTotal > 0 ? (
              <span className="text-[11px] font-medium normal-case tracking-normal text-foreground">
                {money(pricingLineTotal)}
              </span>
            ) : null}
          </span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {PRICING_ADDER_FIELDS.filter((field) => field.costVisibility === "customer").map((field) => {
              const line = pricingLine(field);
              return (
                <label key={field.id} className="rounded-lg border border-border/70 bg-card/50 p-3 text-sm">
                  <span className="font-medium text-foreground">{field.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{field.helper}</span>
                  <div className="mt-2 flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="number"
                      min={0}
                      step={field.step}
                      value={line?.unitPrice ?? ""}
                      onChange={(event) => upsertPricingLine(field, Number(event.target.value) || 0)}
                      placeholder="0"
                      className="w-full bg-transparent text-right text-sm font-semibold outline-none"
                    />
                  </div>
                  </label>
                );
              })}
          </div>
          <div className="rounded-lg border border-border/70 bg-background/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Misc charges / credits</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Use for wrap, down payment received, one-off charges, or customer-visible credits not covered above.</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-card/50 p-3">
                <p className="text-sm font-medium text-foreground">Misc charge</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
                  <input
                    value={miscChargeTitle}
                    onChange={(event) => setMiscChargeTitle(event.target.value)}
                    placeholder="e.g. Wrap, setup, special handling"
                    className="rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    step={25}
                    value={miscChargeAmount || ""}
                    onChange={(event) => setMiscChargeAmount(Number(event.target.value) || 0)}
                    placeholder="0"
                    className="rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                  <Button type="button" size="sm" onClick={() => onAddMiscPricingLine("charge")}>
                    Add
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/50 p-3">
                <p className="text-sm font-medium text-foreground">Misc credit</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
                  <input
                    value={miscCreditTitle}
                    onChange={(event) => setMiscCreditTitle(event.target.value)}
                    placeholder="e.g. Down payment received"
                    className="rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    step={25}
                    value={miscCreditAmount || ""}
                    onChange={(event) => setMiscCreditAmount(Number(event.target.value) || 0)}
                    placeholder="0"
                    className="rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => onAddMiscPricingLine("credit")}>
                    Add
                  </Button>
                </div>
              </div>
            </div>
            {draftPricingLines.some((line) => line.metadata?.misc_line_kind === "charge" || line.metadata?.misc_line_kind === "credit") && (
              <div className="mt-3 space-y-2">
                {draftPricingLines
                  .filter((line) => line.metadata?.misc_line_kind === "charge" || line.metadata?.misc_line_kind === "credit")
                  .map((line) => (
                    <div key={line.id ?? line.title} className="flex items-center justify-between gap-3 rounded border border-border/60 bg-card/50 px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-foreground">{line.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {line.metadata?.misc_line_kind === "credit" ? "Credit" : "Charge"} · printed on customer quote
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={line.metadata?.misc_line_kind === "credit" ? "font-semibold text-emerald-400" : "font-semibold text-foreground"}>
                          {line.metadata?.misc_line_kind === "credit" ? "-" : ""}{money(line.unitPrice)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onRemoveMiscLine(line)}
                          aria-label={`Remove ${line.title}`}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
