/**
 * PR 15 — Quote wizard Step 6 (rebates & promotions).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Saved-quote package id for
 * `IncentiveStack` passes in from the page.
 */

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isUuid } from "@/lib/uuid";
import { IncentiveStack } from "../components/IncentiveStack";
import { money } from "../lib/money";
import { PROMOTION_PLACEHOLDERS, type PromotionPlaceholder } from "../lib/promotion-placeholders";
import { quoteLineCostVisibility } from "../lib/quote-workspace";
import { useWizard } from "../wizard/useWizard";

export interface PromotionsStepProps {
  activeQuotePackageId: string | null;
}

export function PromotionsStep({ activeQuotePackageId }: PromotionsStepProps) {
  const { draft, setDraft, setStep } = useWizard();

  function promotionPlaceholderSelected(promo: PromotionPlaceholder): boolean {
    return draft.pricingLines?.some((line) =>
      line.kind === promo.kind && line.metadata?.promotion_placeholder_id === promo.id) ?? false;
  }

  function togglePromotion(promo: PromotionPlaceholder): void {
    const selected = promotionPlaceholderSelected(promo);
    setDraft((current) => {
      const existing = current.pricingLines ?? [];
      const selectedPromotionIds = (current.selectedPromotionIds ?? []).filter(isUuid);
      if (selected) {
        return {
          ...current,
          selectedPromotionIds,
          pricingLines: existing.filter((line) => line.metadata?.promotion_placeholder_id !== promo.id),
        };
      }
      const currentLine = existing.find((line) => line.metadata?.promotion_placeholder_id === promo.id);
      const promoMetadata = {
        ...(currentLine?.metadata ?? {}),
        promotion_placeholder_id: promo.id,
        promotion_source: promo.source,
      };
      const nextLine: QuoteLineItemDraft = {
        kind: promo.kind,
        costVisibility: quoteLineCostVisibility({ kind: promo.kind, metadata: promoMetadata }),
        id: currentLine?.id ?? `${promo.kind}-${Date.now()}`,
        sourceCatalog: "manual",
        sourceId: null,
        dealerCost: null,
        title: promo.title,
        quantity: 1,
        unitPrice: promo.amount,
        metadata: promoMetadata,
      };
      return {
        ...current,
        selectedPromotionIds,
        pricingLines: currentLine
          ? existing.map((line) => line.metadata?.promotion_placeholder_id === promo.id ? nextLine : line)
          : [...existing, nextLine],
      };
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 6: Rebates & promotions</h2>
        <p className="mt-1 text-sm text-muted-foreground">Use seeded incentives when they exist. If no program data is present, these clear starter rows keep the skeleton moving.</p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Promotions vs pricing.</span>{" "}
          OEM and dealer incentives stack on the sell price from{" "}
          <Button
            type="button"
            variant="link"
            title="Step 5 — Pricing build"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("pricing")}
          >
            Pricing
          </Button>
          . Cash and payment scenarios are modeled in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 7 — Financing scenarios"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("financing")}
          >
            Financing
          </Button>
          .
        </p>
      </Card>

      {activeQuotePackageId ? (
        <IncentiveStack quotePackageId={activeQuotePackageId} />
      ) : (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">Save the draft to run the existing incentive resolver against this quote.</Card>
      )}

      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground">Manual promotion choices</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PROMOTION_PLACEHOLDERS.map((promo) => {
            const selected = promotionPlaceholderSelected(promo);
            return (
              <button
                key={promo.id}
                type="button"
                onClick={() => togglePromotion(promo)}
                className={`rounded-lg border p-3 text-left transition ${
                  selected ? "border-emerald-500/50 bg-emerald-500/10" : "border-border bg-card/40 hover:border-qep-orange/40"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-qep-orange">{promo.source}</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{promo.title}</p>
                <p className="mt-1 text-lg font-bold text-emerald-400">−{money(promo.amount)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{promo.detail}</p>
                <span className="mt-3 inline-flex rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
                  {selected ? "Selected" : "Tap to apply"}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("pricing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <Button onClick={() => setStep("financing")}>Financing <ArrowRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}
