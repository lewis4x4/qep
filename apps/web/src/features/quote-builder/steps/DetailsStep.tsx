/**
 * PR 17 — Quote wizard Step 8 (quote details).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Expiration/follow-up defaults
 * are applied on the page when this step opens.
 */

import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
// WAVE polish (Slice 2): voice dictation on Special terms + Why this machine.
import { MobileVoiceTextarea } from "@/features/sales/components/MobileVoiceTextarea";
import {
  dateInputValue,
  dateTimeInputValue,
  isoFromDateInput,
  isoFromDateTimeInput,
} from "../lib/quote-date-input";
import { useWizard } from "../wizard/useWizard";

export function DetailsStep() {
  const { draft, setDraft, setStep } = useWizard();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 8: Quote details</h2>
        <p className="mt-1 text-sm text-muted-foreground">Set the handoff details the customer will ask about before anyone sends a document.</p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Details vs finance & review.</span>{" "}
          Cash and payment scenarios sit in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 7 — Financing scenarios"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("financing")}
          >
            Financing
          </Button>
          . The approval-ready snapshot is{" "}
          <Button
            type="button"
            variant="link"
            title="Step 9 — Review + approval"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("review")}
          >
            Review
          </Button>
          .
        </p>
      </Card>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Expiration date</span>
            <input
              type="date"
              value={dateInputValue(draft.expiresAt)}
              onChange={(event) => setDraft((current) => ({ ...current, expiresAt: isoFromDateInput(event.target.value) }))}
              className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm min-h-[44px]"
            />
            <span className="text-[11px] text-muted-foreground">Defaults to 30 days when this step opens.</span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Follow-up reminder</span>
            <input
              type="datetime-local"
              value={dateTimeInputValue(draft.followUpAt)}
              onChange={(event) => setDraft((current) => ({ ...current, followUpAt: isoFromDateTimeInput(event.target.value) }))}
              className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm min-h-[44px]"
            />
            <span className="text-[11px] text-muted-foreground">Defaults to 3 days. Final send/log will require it.</span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Delivery ETA</span>
            <input
              type="date"
              value={dateInputValue(draft.deliveryEta)}
              onChange={(event) => setDraft((current) => ({ ...current, deliveryEta: isoFromDateInput(event.target.value) }))}
              className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm min-h-[44px]"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Deposit placeholder</span>
            <input
              type="number"
              min={0}
              step={250}
              value={draft.depositRequiredAmount ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, depositRequiredAmount: event.target.value === "" ? null : Number(event.target.value) || 0 }))}
              placeholder="Awaiting deposit SOP"
              className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm min-h-[44px]"
            />
          </label>
        </div>

        <label className="mt-4 block space-y-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Special terms</span>
          <MobileVoiceTextarea
            value={draft.specialTerms ?? ""}
            onChange={(event) => setDraft((current) => ({ ...current, specialTerms: event.target.value || null }))}
            placeholder="Subject to availability, freight confirmation, manager approval, or customer-specific terms."
            className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
            data-testid="details-special-terms"
          />
        </label>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground">Why this machine</p>
        <p className="mt-1 text-xs text-muted-foreground">Use the pre-suggest as a starting point. Edit it until it sounds like your conversation, then confirm it before customer-facing send.</p>
        <MobileVoiceTextarea
          value={draft.whyThisMachine ?? ""}
          onChange={(event) => setDraft((current) => ({ ...current, whyThisMachine: event.target.value, whyThisMachineConfirmed: false }))}
          placeholder="Explain, in your own words, why this unit fits the customer’s job, terrain, timeline, and budget."
          className="mt-3 min-h-[120px] w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
          data-testid="details-why-this-machine"
        />
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={draft.whyThisMachineConfirmed === true}
            onChange={(event) => setDraft((current) => ({ ...current, whyThisMachineConfirmed: event.target.checked }))}
            className="h-5 w-5"
          />
          I reviewed this language and confirm it is rep-approved.
        </label>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("financing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <Button onClick={() => setStep("review")}>Review <ArrowRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}
