/**
 * PR 13 — Quote wizard Step 4 (trade-in).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Trade valuation query,
 * point-shoot apply handler, checklist state, and the capture dialog stay
 * page-owned and pass in as props.
 */

import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PointShootTradeCard } from "../components/PointShootTradeCard";
import { TradeInInputCard } from "../components/TradeInInputCard";
import { TradeInSection } from "../components/TradeInSection";
import type { TradeValuationProposalSnapshot } from "../lib/point-shoot-trade-api";
import {
  TRADE_CHECKLIST_ITEMS,
  type TradeCaptureDraft,
  type TradeChecklistKey,
} from "../lib/trade-checklist";
import { useWizard } from "../wizard/useWizard";

export interface TradeInStepProps {
  appliedValuationSnapshot: TradeValuationProposalSnapshot | null;
  onPointShootApply: (allowanceDollars: number, valuationId: string) => void;
  tradeChecklist: Record<TradeChecklistKey, boolean>;
  tradeCapture: TradeCaptureDraft;
  tradeManagerApprovalRequired: boolean;
  onOpenTradeCapture: (key: TradeChecklistKey) => void;
}

export function TradeInStep({
  appliedValuationSnapshot,
  onPointShootApply,
  tradeChecklist,
  tradeCapture,
  tradeManagerApprovalRequired,
  onOpenTradeCapture,
}: TradeInStepProps) {
  const { draft, setDraft, setStep } = useWizard();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 4: Trade-in</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture the trade once. If the provisional checklist is not complete, this screen shows manager-approval-required messaging for the handoff.
        </p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Configure vs pricing.</span>{" "}
          Package lines and per-row internal vs customer visibility are edited in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 3 — Configure the package"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("configure")}
          >
            Configure
          </Button>
          . Freight, PDI, discounts, and the customer waterfall are in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 5 — Pricing build"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("pricing")}
          >
            Pricing
          </Button>
          .
        </p>
      </Card>

      {draft.dealId ? (
        <TradeInSection
          dealId={draft.dealId}
          onTradeValueChange={(value, valId) => {
            setDraft((current) => ({
              ...current,
              tradeAllowance: value || 0,
              tradeValuationId: valId,
            }));
          }}
        />
      ) : null}

      <PointShootTradeCard
        dealId={draft.dealId ?? null}
        appliedAllowanceDollars={draft.tradeAllowance || null}
        appliedValuationSnapshot={appliedValuationSnapshot}
        onApply={onPointShootApply}
        onClear={() => setDraft((cur) => ({
          ...cur,
          tradeAllowance: 0,
          tradeValuationId: null,
        }))}
      />

      <TradeInInputCard
        tradeAllowance={draft.tradeAllowance}
        onChange={(value) => setDraft((current) => ({
          ...current,
          tradeAllowance: value,
          tradeValuationId: null,
        }))}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Trade evidence checklist</p>
            <p className="mt-1 text-xs text-muted-foreground">Click a row, capture the evidence in this quote, and it checks itself off automatically.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => onOpenTradeCapture("hourMeter")}
            data-testid="trade-open-capture"
          >
            Open trade capture
          </Button>
        </div>
        {/* WAVE B3 deep reflow: tiles stack single-column on phone (1-col
            via sm:grid-cols-2 default), each tile lands min-h-[44px]
            for a thumb target. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="trade-evidence-checklist">
          {TRADE_CHECKLIST_ITEMS.map((item) => {
            const complete = tradeChecklist[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onOpenTradeCapture(item.key)}
                aria-pressed={complete}
                data-trade-evidence={item.key}
                className={`flex min-h-[44px] items-start gap-3 rounded border px-3 py-3 text-left text-sm transition ${
                  complete ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/70 bg-card/50 hover:border-qep-orange/60"
                }`}
              >
                {complete ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-muted-foreground/70" />}
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{item.label}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {tradeCapture[item.key] || item.prompt}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {tradeManagerApprovalRequired ? (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-300">Manager approval required for trade allowance.</p>
          <p className="mt-1 text-xs text-amber-200">The trade value stays in the quote; this checklist note is a provisional handoff until the Trade SOP is finalized.</p>
        </Card>
      ) : null}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("configure")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button onClick={() => setStep("pricing")}>
          Pricing <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
