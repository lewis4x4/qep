/**
 * PR 14 — Quote wizard Step 5 (pricing).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Margin totals, tax preview,
 * pricing-line helpers, and misc-line form state stay page-owned and pass in as props.
 */

import { ArrowLeft, ArrowRight, DollarSign } from "lucide-react";
import type { QuoteLineItemDraft, QuoteTaxProfile } from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { TaxBreakdown } from "../components/TaxBreakdown";
import {
  applyEquipmentOverridePrice,
  equipmentSystemBasePrice,
} from "../lib/equipment-override-price";
import { money } from "../lib/money";
import {
  DISCOUNT_REASON_OPTIONS,
  PRICING_ADDER_FIELDS,
  type CostVisibility,
  type PricingAdderField,
  type PricingLineKind,
} from "../lib/pricing-adder-fields";
import type { TaxCalculation } from "../lib/tax-api";
import { PricingAdderBuckets } from "../components/PricingAdderBuckets";
import { miscPricingLineKey } from "../lib/misc-pricing-line";
import { SummaryRow } from "../components/SummaryRow";
import { useWizard } from "../wizard/useWizard";

export interface PricingStepProps {
  equipmentTotal: number;
  attachmentTotal: number;
  internalCostLoadTotal: number;
  pricingLineTotal: number;
  subtotal: number;
  discountTotal: number;
  taxableBasis: number;
  taxTotal: number;
  customerTotal: number;
  marginPct: number;
  dealerCost: number;
  netTotal: number;
  marginAmount: number;
  inboundFreightEligible: boolean;
  pricingLine: (fieldOrKind: PricingAdderField | PricingLineKind) => QuoteLineItemDraft | undefined;
  upsertPricingLine: (
    fieldOrKind: PricingAdderField | PricingLineKind,
    amount: number,
    patch?: Partial<QuoteLineItemDraft>,
    legacyTitle?: string,
    legacyCostVisibility?: CostVisibility,
  ) => void;
  discountLine: QuoteLineItemDraft | undefined;
  miscChargeTitle: string;
  setMiscChargeTitle: (value: string) => void;
  miscChargeAmount: number;
  setMiscChargeAmount: (value: number) => void;
  miscCreditTitle: string;
  setMiscCreditTitle: (value: string) => void;
  miscCreditAmount: number;
  setMiscCreditAmount: (value: number) => void;
  onAddMiscPricingLine: (kind: "charge" | "credit") => void;
  taxProfiles: Array<{ value: QuoteTaxProfile; label: string; detail: string }>;
  taxPreviewData: TaxCalculation | null | undefined;
  taxPreviewLoading: boolean;
  taxPreviewError: boolean;
  branchStateProvince?: string | null;
}

export function PricingStep({
  equipmentTotal,
  attachmentTotal,
  internalCostLoadTotal,
  pricingLineTotal,
  subtotal,
  discountTotal,
  taxableBasis,
  taxTotal,
  customerTotal,
  marginPct,
  dealerCost,
  netTotal,
  marginAmount,
  inboundFreightEligible,
  pricingLine,
  upsertPricingLine,
  discountLine,
  miscChargeTitle,
  setMiscChargeTitle,
  miscChargeAmount,
  setMiscChargeAmount,
  miscCreditTitle,
  setMiscCreditTitle,
  miscCreditAmount,
  setMiscCreditAmount,
  onAddMiscPricingLine,
  taxProfiles,
  taxPreviewData,
  taxPreviewLoading,
  taxPreviewError,
  branchStateProvince,
}: PricingStepProps) {
  const { draft, setDraft, setStep } = useWizard();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 5: Build the price</h2>
        <p className="mt-1 text-sm text-muted-foreground">A simple waterfall: machine, configuration, adders, discount, trade, tax, and customer total.</p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Configure vs pricing.</span>{" "}
          Catalog package lines (attachments, options, parts, warranty) and per-row{" "}
          <span className="font-medium text-foreground">Internal</span> / customer visibility are edited in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 3 — Configure the package"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("configure")}
          >
            Configure
          </Button>
          . This step covers sell-price overrides, standard adders, discounts, and totals.
        </p>
      </Card>

      <Card className="overflow-hidden border-qep-orange/20">
        <div className="bg-qep-orange/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pricing waterfall</p>
          <div className="mt-3 space-y-2 text-sm">
            <SummaryRow label="Equipment" value={money(equipmentTotal)} />
            <SummaryRow label="Configuration (customer)" value={money(attachmentTotal)} />
            {internalCostLoadTotal > 0 ? (
              <SummaryRow
                label="Internal cost load (not on customer quote)"
                value={money(internalCostLoadTotal)}
              />
            ) : null}
            <SummaryRow label="Customer-facing adders" value={money(pricingLineTotal)} />
            <SummaryRow label="Subtotal" value={money(subtotal)} emphasize />
            <SummaryRow label="Discounts + promos" value={`-${money(discountTotal)}`} positive />
            <SummaryRow label="Trade allowance" value={`-${money(draft.tradeAllowance)}`} positive />
            <SummaryRow label="Taxable basis" value={money(taxableBasis)} emphasize />
            <SummaryRow label="Estimated tax" value={money(taxTotal)} />
            <SummaryRow label="Customer total" value={money(customerTotal)} emphasize />
          </div>
        </div>
      </Card>
      <MarginCheckBanner
        marginPct={marginPct}
        waterfall={{
          equipmentTotal: subtotal,
          dealerCost,
          tradeAllowance: draft.tradeAllowance,
          netTotal,
          marginAmount,
        }}
      />

      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground">Equipment base-price overrides</p>
        <p className="mt-1 text-xs text-muted-foreground">Override price here without changing the machine&apos;s source/base price record.</p>
        <div className="mt-3 space-y-2">
          {draft.equipment.length === 0 ? (
            <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Add equipment first to set an override.
            </p>
          ) : draft.equipment.map((equipment, index) => {
            const systemBase = equipmentSystemBasePrice(equipment);
            const hasOverride = Math.abs(equipment.unitPrice - systemBase) > 0.01;
            return (
              <div key={`pricing-override-${equipment.id ?? equipment.title}-${index}`} className="rounded-lg border border-border/70 bg-card/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{equipment.title || `${equipment.make ?? ""} ${equipment.model ?? ""}`.trim() || "Equipment"}</p>
                  <span className="text-xs text-muted-foreground">System base {money(systemBase)}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-1 rounded border border-input bg-background px-2 py-1 text-sm font-semibold text-foreground">
                    <span className="text-muted-foreground">$</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={equipment.unitPrice}
                      onChange={(event) => {
                        const parsed = event.target.value === "" ? 0 : Number(event.target.value);
                        if (!Number.isFinite(parsed) || parsed < 0) return;
                        setDraft((current) => ({
                          ...current,
                          equipment: current.equipment.map((item, rowIndex) => (
                            rowIndex === index ? applyEquipmentOverridePrice(item, parsed) : item
                          )),
                        }));
                      }}
                      className="w-full bg-transparent text-right outline-none"
                      aria-label={`Override price for ${equipment.title}`}
                    />
                  </label>
                  {hasOverride && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        equipment: current.equipment.map((item, rowIndex) => (
                          rowIndex === index ? applyEquipmentOverridePrice(item, systemBase) : item
                        )),
                      }))}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Price adders</p>
            <p className="mt-1 text-xs text-muted-foreground">Only fill what applies. Empty rows stay out of the quote payload.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const goodFaithField = PRICING_ADDER_FIELDS.find((field) => field.id === "good_faith");
              if (!goodFaithField) return;
              upsertPricingLine(goodFaithField, Math.round(subtotal * 0.01));
            }}
          >
            Set 1% good faith
          </Button>
        </div>
        <PricingAdderBuckets
          draftPricingLines={draft.pricingLines ?? []}
          internalCostLoadTotal={internalCostLoadTotal}
          pricingLineTotal={pricingLineTotal}
          inboundFreightEligible={inboundFreightEligible}
          pricingLine={pricingLine}
          upsertPricingLine={upsertPricingLine}
          miscChargeTitle={miscChargeTitle}
          setMiscChargeTitle={setMiscChargeTitle}
          miscChargeAmount={miscChargeAmount}
          setMiscChargeAmount={setMiscChargeAmount}
          miscCreditTitle={miscCreditTitle}
          setMiscCreditTitle={setMiscCreditTitle}
          miscCreditAmount={miscCreditAmount}
          setMiscCreditAmount={setMiscCreditAmount}
          onAddMiscPricingLine={onAddMiscPricingLine}
          onRemoveMiscLine={(line) => {
            const key = miscPricingLineKey(line);
            setDraft((current) => ({
              ...current,
              pricingLines: (current.pricingLines ?? []).filter(
                (item) => miscPricingLineKey(item) !== key,
              ),
            }));
          }}
        />

      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground">Discount with reason code</p>
        <p className="mt-1 text-xs text-muted-foreground">A manual discount requires a reason so approval and future review do not guess why margin changed.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Legacy type</span>
            <select
              value={draft.commercialDiscountType}
              onChange={(event) => setDraft((current) => ({ ...current, commercialDiscountType: event.target.value as typeof current.commercialDiscountType }))}
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="flat">Flat</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Existing quote discount</span>
            <div className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
              <span className="text-sm text-muted-foreground">{draft.commercialDiscountType === "percent" ? "%" : "$"}</span>
              <input
                type="number"
                min={0}
                step={draft.commercialDiscountType === "percent" ? 0.5 : 100}
                value={draft.commercialDiscountValue || ""}
                onChange={(event) => setDraft((current) => ({ ...current, commercialDiscountValue: Number(event.target.value) || 0 }))}
                placeholder="0"
                className="w-full bg-transparent text-right text-sm font-semibold outline-none"
              />
            </div>
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft((current) => ({ ...current, commercialDiscountValue: 0 }))}
            >
              Clear
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Saved legacy quote-level discounts remain editable here so older drafts do not hide a margin change. New manual discounts below carry a reason code.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Discount amount</span>
            <div className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="number"
                min={0}
                step={100}
                value={discountLine?.unitPrice ?? ""}
                onChange={(event) => upsertPricingLine("discount", Number(event.target.value) || 0, {
                  reasonCode: discountLine?.reasonCode ?? "competitive_match",
                }, "Manual discount", "customer")}
                placeholder="0"
                className="w-full bg-transparent text-right text-sm font-semibold outline-none"
              />
            </div>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Reason code</span>
            <select
              value={discountLine?.reasonCode ?? "competitive_match"}
              onChange={(event) => upsertPricingLine("discount", discountLine?.unitPrice ?? 0, {
                reasonCode: event.target.value,
              }, "Manual discount", "customer")}
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            >
              {DISCOUNT_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground">Tax preview</p>
        <p className="mt-1 text-xs text-muted-foreground">Florida delivery uses delivery county/state when provided. Override only with a clear reason.</p>
        <div className="mt-3 grid gap-2">
          {taxProfiles.map((profile) => {
            const selected = profile.value === draft.taxProfile;
            return (
              <button
                key={profile.value}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, taxProfile: profile.value }))}
                className={`rounded-lg border p-3 text-left transition ${selected ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card/40 hover:border-qep-orange/40"}`}
              >
                <p className="text-sm font-medium text-foreground">{profile.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{profile.detail}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Delivery state</span>
            <input
              value={draft.deliveryState ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, deliveryState: event.target.value.toUpperCase() || null }))}
              placeholder={branchStateProvince ?? "FL"}
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Delivery county</span>
            <input
              value={draft.deliveryCounty ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, deliveryCounty: event.target.value || null }))}
              placeholder="County for FL surtax preview"
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Tax override amount</span>
            <input
              type="number"
              min={0}
              step={25}
              value={draft.taxOverrideAmount ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, taxOverrideAmount: event.target.value === "" ? null : Number(event.target.value) || 0 }))}
              placeholder="Leave blank for calculated tax"
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Override reason</span>
            <input
              value={draft.taxOverrideReason ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, taxOverrideReason: event.target.value || null }))}
              placeholder="Required when overriding tax"
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4">
          <TaxBreakdown
            data={taxPreviewData}
            isLoading={taxPreviewLoading}
            isError={taxPreviewError}
            enabled={Boolean(draft.branchSlug || draft.deliveryState)}
          />
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("tradeIn")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <Button onClick={() => setStep("promotions")}>Promotions <ArrowRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}
