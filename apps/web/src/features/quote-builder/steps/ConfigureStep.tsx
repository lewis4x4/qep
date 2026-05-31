/**
 * PR 12 — Quote wizard Step 3 (configure: attachments / options /
 * accessories / parts / warranty).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Reads `draft` / `setDraft` / `setStep` from `useWizard()`. Page still owns
 * tab + custom-line + available-options state and the catalog search dialog
 * trigger — those flow in as props.
 */

import { ArrowLeft, ArrowRight, PackagePlus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { QuoteWorkspaceLineRow } from "../components/QuoteWorkspaceLineRow";
import { packageKindLabel } from "../lib/package-kind-label";
import { money } from "../lib/money";
import { useWizard } from "../wizard/useWizard";

import type { QuotePackageCatalogKind } from "../lib/quote-api";
import type { QuoteLineCostVisibility } from "../../../../../../shared/qep-moonshot-contracts";

export interface ConfigureStepProps {
  configureTab: QuotePackageCatalogKind;
  setConfigureTab: Dispatch<SetStateAction<QuotePackageCatalogKind>>;

  availableOptions: Array<{ id: string; name: string; price: number }>;
  availableOptionsLabel: string | null;

  setPackageItemSearchOpen: Dispatch<SetStateAction<boolean>>;

  customLineTitle: string;
  setCustomLineTitle: Dispatch<SetStateAction<string>>;
  customLinePrice: number;
  setCustomLinePrice: Dispatch<SetStateAction<number>>;

  addConfigLine: (
    kind: QuotePackageCatalogKind,
    input?: { id?: string; title: string; unitPrice: number },
  ) => void;
}

export function ConfigureStep({
  configureTab,
  setConfigureTab,
  availableOptions,
  availableOptionsLabel,
  setPackageItemSearchOpen,
  customLineTitle,
  setCustomLineTitle,
  customLinePrice,
  setCustomLinePrice,
  addConfigLine,
}: ConfigureStepProps) {
  const { draft, setDraft, setStep } = useWizard();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 3: Configure the package</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Attachments, options, accessories, parts, and warranty stay separated so reps do not scroll through one overloaded list.
          {" "}
          Mark a row <span className="font-medium text-foreground">Internal</span> when it should stay off the customer PDF (still included in dealer margin math).
          {" "}
          Freight, PDI, doc fees, discounts, and the customer total waterfall are built in{" "}
          <span className="font-medium text-foreground">Pricing</span> (step 5) after trade-in.
        </p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Configure vs pricing.</span>{" "}
          This step is catalog package lines and visibility only. Continue to{" "}
          <Button
            type="button"
            variant="link"
            title="Step 4 — Trade-in"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("tradeIn")}
          >
            Trade-in
          </Button>
          , then{" "}
          <Button
            type="button"
            variant="link"
            title="Step 5 — Pricing build"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("pricing")}
          >
            Pricing
          </Button>
          , for trade dollars and the customer waterfall.
        </p>
      </Card>

      <Card className="p-4">
        {/* WAVE B2 deep reflow: tab row reads as a chip rail on mobile —
            each tab is full-thumb height (44pt min) and shows its
            configured-line count badge inline. */}
        <div className="flex flex-wrap gap-2" data-testid="configure-tabs">
          {([
            { id: "attachment", label: "Attachments" },
            { id: "option", label: "Options" },
            { id: "accessory", label: "Accessories" },
            { id: "part", label: "Parts" },
            { id: "warranty", label: "Warranty" },
          ] as Array<{ id: QuotePackageCatalogKind; label: string }>).map((tab) => {
            const count = draft.attachments.filter((item) => item.kind === tab.id).length;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setConfigureTab(tab.id);
                  setPackageItemSearchOpen(true);
                }}
                data-configure-tab={tab.id}
                aria-pressed={configureTab === tab.id}
                className={`min-h-[44px] rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  configureTab === tab.id
                    ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}{count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-qep-orange/25 bg-qep-orange/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Search catalog-backed package items</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add real {packageKindLabel(configureTab)} with saved name, price, source, and compatibility instead of typing manually.
              </p>
            </div>
            <Button size="sm" onClick={() => setPackageItemSearchOpen(true)}>
              <PackagePlus className="mr-1 h-4 w-4" /> Search {packageKindLabel(configureTab)}
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {configureTab === "attachment" && availableOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Compatible for {availableOptionsLabel ?? "selected equipment"}
              </p>
              {availableOptions.map((option) => {
                const selected = draft.attachments.some((attachment) => attachment.id === option.id);
                return (
                  <div key={option.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{option.name}</p>
                      <p className="text-xs text-muted-foreground">{money(option.price)}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={selected ? "outline" : "default"}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        attachments: selected
                          ? current.attachments.filter((attachment) => attachment.id !== option.id)
                          : [...current.attachments, {
                              kind: "attachment",
                              id: option.id,
                              sourceCatalog: "qb_attachments",
                              sourceId: option.id,
                              dealerCost: null,
                              title: option.name,
                              quantity: 1,
                              unitPrice: option.price,
                            }],
                      }))}
                    >
                      {selected ? "Remove" : "Add"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {draft.attachments.filter((item) => item.kind === configureTab).map((item, index) => {
            const realIndex = draft.attachments.findIndex((candidate) => candidate === item);
            return (
              <QuoteWorkspaceLineRow
                key={`${item.kind}-${item.id ?? item.title}-${index}`}
                label={configureTab}
                item={item}
                costVisibilityEditable
                onCostVisibilityChange={(next: QuoteLineCostVisibility) => setDraft((current) => ({
                  ...current,
                  attachments: current.attachments.map((line, rowIndex) => (
                    rowIndex === realIndex ? { ...line, costVisibility: next } : line
                  )),
                }))}
                onPriceChange={(value) => setDraft((current) => ({
                  ...current,
                  attachments: current.attachments.map((line, rowIndex) => (
                    rowIndex === realIndex ? { ...line, unitPrice: value } : line
                  )),
                }))}
                onRemove={() => setDraft((current) => ({
                  ...current,
                  attachments: current.attachments.filter((_, rowIndex) => rowIndex !== realIndex),
                }))}
              />
            );
          })}

          {configureTab !== "attachment" || availableOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              {configureTab === "attachment"
                ? "No compatible attachment list is loaded yet. Use Search attachments for the full catalog or add a manual fallback below."
                : `Use Search ${packageKindLabel(configureTab)} for catalog-backed rows, or add a manual fallback below when a row is missing.`}
            </div>
          ) : null}

          {/* WAVE B2: manual fallback row stacks on mobile (already 1-col by
              default at md:grid-cols-*), but inputs need text-base to keep
              iOS Safari from auto-zooming on focus, and the Add button
              needs a 44pt min height. */}
          <div className="grid gap-2 md:grid-cols-[1fr_140px_auto]">
            <input
              value={customLineTitle}
              onChange={(event) => setCustomLineTitle(event.target.value)}
              placeholder={`Add ${configureTab} name`}
              className="rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
            />
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={100}
              value={customLinePrice}
              onChange={(event) => setCustomLinePrice(Number(event.target.value) || 0)}
              className="rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
            />
            <Button
              size="sm"
              className="min-h-[44px]"
              onClick={() => {
                addConfigLine(configureTab, { title: customLineTitle, unitPrice: customLinePrice });
                setCustomLineTitle("");
                setCustomLinePrice(0);
              }}
            >
              Add {configureTab}
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("equipment")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button onClick={() => setStep("tradeIn")}>
          Trade-in <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
