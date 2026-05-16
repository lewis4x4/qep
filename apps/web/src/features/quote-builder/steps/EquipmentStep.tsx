/**
 * PR 11 — Quote wizard Step 2 (equipment + availability).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Catalog metadata helpers,
 * availability line helpers, and mutations stay page-owned and pass in as props.
 */

import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EquipmentSelector } from "../components/EquipmentSelector";
import { WinProbabilityStrip } from "../components/WinProbabilityStrip";
import { applyEquipmentOverridePrice } from "../lib/equipment-override-price";
import type { QuoteAvailabilityRequest } from "../lib/quote-api";
import { useWizard } from "../wizard/useWizard";

import type { FactorVerdict } from "../lib/factor-verdict";
import type { ShadowAgreementSummary } from "../lib/retrospective-shadow";
import type { ShadowHistoricalSnapshot } from "../lib/shadow-score";
import type { WinProbabilityContext } from "../lib/win-probability-scorer";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

type EquipmentSelectorOnSelect = NonNullable<ComponentProps<typeof EquipmentSelector>["onSelect"]>;
type EquipmentSelectorOnRecommendation = NonNullable<ComponentProps<typeof EquipmentSelector>["onRecommendation"]>;

export type EquipmentAvailabilityStatus = "in_stock" | "in_transit" | "source_required";

export interface EquipmentStepProps {
  winProbContext: WinProbabilityContext;
  factorVerdicts: Map<string, FactorVerdict> | null;
  shadowHistory: ShadowHistoricalSnapshot[] | null;
  shadowCalibration: ShadowAgreementSummary | null;
  intelligencePanel: ReactNode;

  onEquipmentCatalogSelect: EquipmentSelectorOnSelect;
  onEquipmentRecommendation: EquipmentSelectorOnRecommendation;

  setAvailableOptions: Dispatch<SetStateAction<Array<{ id: string; name: string; price: number }>>>;
  setAvailableOptionsLabel: Dispatch<SetStateAction<string | null>>;
  availableOptionsLabel: string | null;

  equipmentKeyForLine: (item: Pick<QuoteLineItemDraft, "id" | "title" | "make" | "model" | "year">) => string;

  availabilityStatusForLine: (item: QuoteLineItemDraft) => EquipmentAvailabilityStatus;
  availabilityRequestIdForLine: (item: QuoteLineItemDraft) => string | null;
  availabilityRequestCreatedAtForLine: (item: QuoteLineItemDraft) => string | null;
  availabilityRequestLabel: (status: string | null) => string;
  availabilityLabel: (status: EquipmentAvailabilityStatus) => string;
  liveAvailabilityRequestForLine: (item: QuoteLineItemDraft) => QuoteAvailabilityRequest | null;
  liveAvailabilityStatusForLine: (item: QuoteLineItemDraft) => string | null;

  markAvailabilityConfirmationRequested: (index: number) => void;
  markAllAvailabilityConfirmationRequested: () => void;
  availabilityRequestMutationPending: boolean;

  sourceRequiredAwaitingConfirmation: QuoteLineItemDraft[];
  sourceRequiredUnavailable: QuoteLineItemDraft[];
  equipmentCanContinue: boolean;
}

export function EquipmentStep({
  winProbContext,
  factorVerdicts,
  shadowHistory,
  shadowCalibration,
  intelligencePanel,
  onEquipmentCatalogSelect,
  onEquipmentRecommendation,
  setAvailableOptions,
  setAvailableOptionsLabel,
  availableOptionsLabel,
  equipmentKeyForLine,
  availabilityStatusForLine,
  availabilityRequestIdForLine,
  availabilityRequestCreatedAtForLine,
  availabilityRequestLabel,
  availabilityLabel,
  liveAvailabilityRequestForLine,
  liveAvailabilityStatusForLine,
  markAvailabilityConfirmationRequested,
  markAllAvailabilityConfirmationRequested,
  availabilityRequestMutationPending,
  sourceRequiredAwaitingConfirmation,
  sourceRequiredUnavailable,
  equipmentCanContinue,
}: EquipmentStepProps) {
  const { draft, setDraft, setStep } = useWizard();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 2: Pick the machine</h2>
        <p className="mt-1 text-sm text-muted-foreground">Search first. Add one machine, confirm whether it is ready to sell, then move on.</p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Equipment vs configure.</span>{" "}
          This step is the primary machine and availability only. Package lines and internal vs customer visibility live in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 3 — Configure the package"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("configure")}
          >
            Configure
          </Button>
          . The customer waterfall is built in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 5 — Pricing build"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("pricing")}
          >
            Pricing
          </Button>
          {" "}after trade-in.
        </p>
      </Card>

      <WinProbabilityStrip
        draft={draft}
        context={winProbContext}
        verdicts={factorVerdicts}
        closedHistory={shadowHistory}
        shadowCalibration={shadowCalibration}
      />

      {draft.recommendation?.machine ? (
        <div className="lg:hidden">
          {intelligencePanel}
        </div>
      ) : null}

      <EquipmentSelector
        onSelect={onEquipmentCatalogSelect}
        onRecommendation={onEquipmentRecommendation}
      />

      {draft.equipment.length > 0 ? (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Selected equipment</p>
              <p className="mt-1 text-sm text-muted-foreground">Source-required machines create a backend sourcing request before the quote can move forward.</p>
            </div>
            {sourceRequiredAwaitingConfirmation.length > 0 && (
              <Button size="sm" variant="outline" onClick={markAllAvailabilityConfirmationRequested} disabled={availabilityRequestMutationPending}>
                {availabilityRequestMutationPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Request availability check
              </Button>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {draft.equipment.map((equipment, index) => {
              const status = availabilityStatusForLine(equipment);
              const availabilityRequestId = availabilityRequestIdForLine(equipment);
              const availabilityRequest = liveAvailabilityRequestForLine(equipment);
              const requestStatus = liveAvailabilityStatusForLine(equipment);
              const confirmationRequested = Boolean(availabilityRequestId);
              const requestCreatedAt = availabilityRequestCreatedAtForLine(equipment);
              const latestAvailabilityNote = availabilityRequest?.repVisibilityNote ?? availabilityRequest?.decisionNote ?? availabilityRequest?.customerSafeSummary;
              return (
                <div key={`${equipment.title}-${index}`} className="rounded-lg border border-border/70 bg-card/50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {equipment.title || `${equipment.make ?? ""} ${equipment.model ?? ""}`.trim() || "Equipment"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {equipment.year ? `${equipment.year} · ` : ""}{equipment.metadata?.stock_number ? `Stock #${equipment.metadata.stock_number}` : "No stock number on file"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                        status === "source_required"
                          ? "bg-amber-500/10 text-amber-300"
                          : "bg-emerald-500/10 text-emerald-400"
                      }`}>
                        {confirmationRequested ? availabilityRequestLabel(requestStatus) : availabilityLabel(status)}
                      </span>
                      {status === "source_required" && !confirmationRequested && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markAvailabilityConfirmationRequested(index)}
                          disabled={availabilityRequestMutationPending}
                        >
                          {availabilityRequestMutationPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                          Request availability check
                        </Button>
                      )}
                      {confirmationRequested && (
                        <span className="text-[11px] text-muted-foreground">
                          {requestCreatedAt ? `Requested ${new Date(requestCreatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Backend request recorded"}
                        </span>
                      )}
                      <label className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 font-semibold text-foreground">
                        <span className="text-muted-foreground">$</span>
                        <input
                          type="number"
                          inputMode="decimal"
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
                          className="w-24 bg-transparent text-right text-sm outline-none"
                          aria-label={`Unit price for ${equipment.title}`}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const removedLabel = `${equipment.make ?? ""} ${equipment.model ?? ""}`.trim();
                          if (removedLabel.length > 0 && availableOptionsLabel === removedLabel) {
                            setAvailableOptions([]);
                            setAvailableOptionsLabel(null);
                          }
                          setDraft((current) => ({
                            ...current,
                            equipment: current.equipment.filter((_, rowIndex) => rowIndex !== index),
                          }));
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  {availabilityRequest && (
                    <div className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Ops owner: <b className="text-foreground">{availabilityRequest.assignedToName ?? "Unassigned"}</b></span>
                        <span>SLA: <b className="text-foreground">{availabilityRequest.slaDueAt ? new Date(availabilityRequest.slaDueAt).toLocaleString() : "Pending"}</b></span>
                        {availabilityRequest.managerOverrideAt && <span className="text-red-300">Manager override recorded</span>}
                      </div>
                      {latestAvailabilityNote ? <p className="mt-2 text-foreground">{latestAvailabilityNote}</p> : null}
                      {availabilityRequest.candidates.length > 0 && (
                        <p className="mt-2">{availabilityRequest.candidates.length} candidate path{availabilityRequest.candidates.length === 1 ? "" : "s"} attached in the ops queue.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">Select equipment to unlock configuration.</Card>
      )}

      {sourceRequiredAwaitingConfirmation.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-300">Availability needs one click.</p>
          <p className="mt-1 text-xs text-amber-200">This machine must be sourced. The button now creates a backend availability request with candidate alternatives and an audit trail.</p>
        </Card>
      )}

      {sourceRequiredUnavailable.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-red-300">Availability is unresolved.</p>
          <p className="mt-1 text-xs text-red-200">At least one selected machine is marked unavailable. Pick an alternative or get manager override before continuing.</p>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("customer")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <Button onClick={() => setStep("configure")} disabled={!equipmentCanContinue}>
          Configure <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      {!equipmentCanContinue && (
        <p className="text-right text-[11px] text-muted-foreground">Select equipment and resolve any source-required availability note.</p>
      )}
    </div>
  );
}
