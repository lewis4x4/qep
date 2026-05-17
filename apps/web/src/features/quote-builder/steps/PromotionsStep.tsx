/**
 * PR 15 — Quote wizard Step 6 (rebates & promotions).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Saved-quote package id for
 * `IncentiveStack` passes in from the page.
 */

import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid";
import { IncentiveStack } from "../components/IncentiveStack";
import { money } from "../lib/money";
import { PROMOTION_PLACEHOLDERS, type PromotionPlaceholder } from "../lib/promotion-placeholders";
import { quoteLineCostVisibility } from "../lib/quote-workspace";
import { useWizard } from "../wizard/useWizard";
// WAVE quote-builder deep reflow (A3)
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";

export interface PromotionsStepProps {
  activeQuotePackageId: string | null;
}

export function PromotionsStep({ activeQuotePackageId }: PromotionsStepProps) {
  const { draft, setDraft, setStep } = useWizard();
  // WAVE A3 deep reflow: total-savings hero + tap-to-toggle full-width
  // cards on mobile.
  const isMobile = useIsMobileViewport();

  function promotionPlaceholderSelected(promo: PromotionPlaceholder): boolean {
    return draft.pricingLines?.some((line) =>
      line.kind === promo.kind && line.metadata?.promotion_placeholder_id === promo.id) ?? false;
  }

  const selectedPromotions = PROMOTION_PLACEHOLDERS.filter(promotionPlaceholderSelected);
  const totalSavings = selectedPromotions.reduce((sum, promo) => sum + promo.amount, 0);
  const appliedCount = selectedPromotions.length;

  function applyBestStack(): void {
    // WAVE A3: deterministic "best stack" — apply every placeholder.
    // PromotionPlaceholders have no conflict rules in the current model;
    // when a real conflict resolver lands this can swap to a knapsack.
    for (const promo of PROMOTION_PLACEHOLDERS) {
      if (!promotionPlaceholderSelected(promo)) {
        togglePromotion(promo);
      }
    }
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

      {/* WAVE A3: total-savings hero on mobile. Hidden on >= sm because
          the desktop layout already shows savings inside each card. */}
      {isMobile && (
        <Card
          className="border-emerald-500/30 bg-emerald-500/10 p-4 sm:hidden"
          data-testid="promotions-savings-hero"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Total promo savings
          </p>
          <p className="mt-1 text-3xl font-bold text-emerald-300">
            {appliedCount > 0 ? `−${money(totalSavings)}` : "$0"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {appliedCount > 0
              ? `${appliedCount} promo${appliedCount === 1 ? "" : "s"} applied`
              : "Tap a promo below to apply it."}
          </p>
          {appliedCount < PROMOTION_PLACEHOLDERS.length && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 min-h-[44px] w-full border-emerald-400/40 bg-emerald-500/5 text-emerald-200 hover:bg-emerald-500/15"
              onClick={applyBestStack}
              data-testid="promotions-apply-best-stack"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Apply best stack
            </Button>
          )}
        </Card>
      )}

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
        <div className="mt-3 grid gap-3 sm:grid-cols-3" data-testid="promotions-grid">
          {PROMOTION_PLACEHOLDERS.map((promo) => {
            const selected = promotionPlaceholderSelected(promo);
            return (
              <button
                key={promo.id}
                type="button"
                onClick={() => togglePromotion(promo)}
                aria-pressed={selected}
                data-promo-id={promo.id}
                data-promo-selected={selected ? "true" : "false"}
                className={cn(
                  "relative min-h-[44px] rounded-lg border p-3 text-left transition",
                  selected
                    ? "border-qep-orange bg-emerald-500/5 border-l-4 border-l-qep-orange"
                    : "border-border bg-card/40 hover:border-qep-orange/40",
                )}
              >
                {selected && (
                  <span
                    aria-hidden
                    className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-qep-orange text-white"
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-qep-orange">{promo.source}</p>
                <p className={cn("mt-2 text-sm font-semibold text-foreground", selected && "pr-7")}>{promo.title}</p>
                <p className="mt-1 text-lg font-bold text-emerald-400">−{money(promo.amount)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{promo.detail}</p>
                <span
                  className={cn(
                    "mt-3 inline-flex rounded-full border px-2 py-1 text-[11px]",
                    selected
                      ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange font-semibold"
                      : "border-border/70 text-muted-foreground",
                  )}
                >
                  {selected ? "Applied" : "Tap to apply"}
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
