/**
 * PR 16 — Quote wizard Step 7 (financing scenarios).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Scenario list and preview
 * query status pass in from the page (shared with workspace rail).
 */

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { QuoteFinanceScenario } from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { money } from "../lib/money";
import { useWizard } from "../wizard/useWizard";

type FinanceStepTab = "cash" | "finance" | "lease";

export interface FinancingStepProps {
  allFinanceScenarios: QuoteFinanceScenario[];
  customerTotal: number;
  cashDown: number;
  amountFinanced: number;
  financingPreviewLoading: boolean;
  financingPreviewError: boolean;
  leaseQuotingEnabled: boolean;
}

export function FinancingStep({
  allFinanceScenarios,
  customerTotal,
  cashDown,
  amountFinanced,
  financingPreviewLoading,
  financingPreviewError,
  leaseQuotingEnabled,
}: FinancingStepProps) {
  const { draft, setDraft, setStep } = useWizard();
  const [financeStepTab, setFinanceStepTab] = useState<FinanceStepTab>("cash");

  const financeTabScenarios = useMemo(
    () => allFinanceScenarios.filter((scenario) => (
      financeStepTab === "cash"
        ? scenario.type === "cash" || scenario.kind === "cash"
        : financeStepTab === "lease"
          ? scenario.type === "lease" || scenario.kind === "lease_fmv" || scenario.kind === "lease_fppo"
          : scenario.type === "finance" || scenario.kind === "finance"
    )),
    [allFinanceScenarios, financeStepTab],
  );

  function saveSelectedFinanceScenario(scenario: QuoteFinanceScenario): void {
    setDraft((current) => {
      const saved = current.savedFinanceScenarios ?? [];
      const nextScenario = {
        ...scenario,
        kind: scenario.kind ?? (scenario.type === "lease" ? "lease_fmv" : scenario.type),
        isDefault: scenario.label === current.selectedFinanceScenario,
      } satisfies QuoteFinanceScenario;
      return {
        ...current,
        savedFinanceScenarios: saved.some((item) => item.label === nextScenario.label)
          ? saved.map((item) => item.label === nextScenario.label
            ? { ...item, ...nextScenario, isDefault: true }
            : { ...item, isDefault: false })
          : [...saved.map((item) => ({ ...item, isDefault: false })), { ...nextScenario, isDefault: true }],
      };
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 7: Financing scenarios</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick cash, finance, or view the disabled lease path. Payment math is an estimate and includes TILA guidance.</p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Financing vs promos & details.</span>{" "}
          Incentive stacks live in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 6 — Rebates & promotions"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("promotions")}
          >
            Promos
          </Button>
          . Expiry, follow-up, and rep-confirmed narrative move forward in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 8 — Quote details"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("details")}
          >
            Details
          </Button>
          .
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {([
            ["cash", "Cash"],
            ["finance", "Finance"],
            ["lease", "Lease"],
          ] as Array<[FinanceStepTab, string]>).map(([tab, label]) => {
            const disabled = tab === "lease" && !leaseQuotingEnabled;
            return (
              <button
                key={tab}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setFinanceStepTab(tab);
                  if (tab === "cash") {
                    const cashScenario = allFinanceScenarios.find((scenario) => scenario.type === "cash" || scenario.kind === "cash");
                    setDraft((current) => ({ ...current, selectedFinanceScenario: cashScenario?.label ?? null }));
                  }
                }}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                  financeStepTab === tab
                    ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                    : disabled
                      ? "border-border/60 bg-muted/30 text-muted-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}{disabled ? " — unavailable" : ""}
              </button>
            );
          })}
        </div>

        {financeStepTab === "cash" && (
          <div className="mt-4 rounded-lg border border-border/70 bg-card/50 p-4">
            <p className="text-sm font-semibold text-foreground">Cash quote</p>
            <p className="mt-1 text-xs text-muted-foreground">Customer total due at delivery: {money(customerTotal)}. Down payment remains optional for internal tracking.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SummaryRow label="Customer total" value={money(customerTotal)} emphasize />
              <SummaryRow label="Deposit / cash down" value={money(cashDown)} />
            </div>
          </div>
        )}

        {financeStepTab === "finance" && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Cash down</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={draft.cashDown || ""}
                  onChange={(event) => setDraft((current) => ({ ...current, cashDown: Number(event.target.value) || 0 }))}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Amount financed</p>
                <p className="mt-1 text-xl font-semibold text-qep-orange">{money(amountFinanced)}</p>
              </div>
            </div>

            {financingPreviewLoading && <p className="text-xs text-muted-foreground">Calculating scenarios…</p>}
            {financingPreviewError && <p className="text-xs text-red-400">Financing preview failed. Continue with cash or try again.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {financeTabScenarios.length > 0 ? financeTabScenarios.map((scenario) => {
                const selected = draft.selectedFinanceScenario === scenario.label;
                return (
                  <button
                    key={scenario.label}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, selectedFinanceScenario: scenario.label }))}
                    className={`rounded-lg border p-3 text-left transition ${selected ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card/40 hover:border-qep-orange/40"}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-qep-orange">{scenario.label}</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">
                      {scenario.monthlyPayment == null ? money(scenario.totalCost ?? customerTotal) : `${money(scenario.monthlyPayment)}/mo`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {scenario.termMonths ?? 0} months · {(scenario.apr ?? scenario.rate ?? 0).toFixed(2)}% APR · {scenario.lender ?? "Preferred lender"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveSelectedFinanceScenario(scenario);
                      }}
                    >
                      Save scenario
                    </Button>
                  </button>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No finance scenario seed is available yet. The quote can still proceed as cash/TBD.</div>
              )}
            </div>
          </div>
        )}

        {financeStepTab === "lease" && (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-4">
            <p className="text-sm font-semibold text-foreground">Lease quoting is not enabled yet</p>
            <p className="mt-1 text-xs text-muted-foreground">FMV and FPPO lease cards stay disabled until feature flag, OEM list, lease rate sheets, and residual tables are seeded.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-card/40 p-3 opacity-70">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">FMV lease</p>
                <p className="mt-2 text-sm text-muted-foreground">Awaiting residual table.</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/40 p-3 opacity-70">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">FPPO lease</p>
                <p className="mt-2 text-sm text-muted-foreground">Awaiting purchase option rules.</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5 p-4">
        <p className="text-sm font-semibold text-blue-200">TILA estimate disclaimer</p>
        <p className="mt-1 text-xs text-blue-100/90">Payment examples are estimates for discussion only, not a commitment to lend. Final APR, fees, approval, and disclosures come from the lender.</p>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("promotions")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <Button onClick={() => setStep("details")}>Quote details <ArrowRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${emphasize ? "border-t border-border pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${emphasize ? "text-qep-orange" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
