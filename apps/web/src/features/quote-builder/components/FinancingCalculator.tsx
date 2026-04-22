import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { TaxBreakdown } from "./TaxBreakdown";
import type { QuoteCommercialDiscountType, QuoteFinanceScenario, QuoteTaxProfile } from "../../../../../../shared/qep-moonshot-contracts";
import type { TaxCalculation } from "../lib/tax-api";

interface TaxProfileOption {
  value: QuoteTaxProfile;
  label: string;
  detail: string;
}

interface FinancingCalculatorProps {
  discountType: QuoteCommercialDiscountType;
  discountValue: number;
  cashDown: number;
  tradeAllowance: number;
  taxProfile: QuoteTaxProfile;
  packageSubtotal: number;
  discountTotal: number;
  discountedSubtotal: number;
  netTotal: number;
  taxTotal: number;
  customerTotal: number;
  amountFinanced: number;
  taxBreakdown: TaxCalculation | null | undefined;
  taxLoading?: boolean;
  taxError?: boolean;
  taxEnabled?: boolean;
  financeScenarios: QuoteFinanceScenario[];
  financeLoading?: boolean;
  financeError?: boolean;
  selectedScenario: string | null;
  taxProfiles: TaxProfileOption[];
  onDiscountTypeChange: (value: QuoteCommercialDiscountType) => void;
  onDiscountValueChange: (value: number) => void;
  onCashDownChange: (value: number) => void;
  onTaxProfileChange: (value: QuoteTaxProfile) => void;
  onSelectScenario: (label: string) => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function clampNonNegative(value: string): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function FinancingCalculator({
  discountType,
  discountValue,
  cashDown,
  tradeAllowance,
  taxProfile,
  packageSubtotal,
  discountTotal,
  discountedSubtotal,
  netTotal,
  taxTotal,
  customerTotal,
  amountFinanced,
  taxBreakdown,
  taxLoading = false,
  taxError = false,
  taxEnabled = true,
  financeScenarios,
  financeLoading = false,
  financeError = false,
  selectedScenario,
  taxProfiles,
  onDiscountTypeChange,
  onDiscountValueChange,
  onCashDownChange,
  onTaxProfileChange,
  onSelectScenario,
}: FinancingCalculatorProps) {
  if (packageSubtotal <= 0) return null;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Commercial Terms</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Structure the deal before review: discount, trade, tax, cash down, and the amount financed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Package subtotal</p>
            <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(packageSubtotal)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Equipment + attachments before discount, trade, and tax.</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Trade-in credit</p>
            <p className="mt-2 text-xl font-semibold text-emerald-400">{formatCurrency(tradeAllowance)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Comes directly from the dedicated Trade-In step.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Discount type
            </label>
            <select
              value={discountType}
              onChange={(event) => onDiscountTypeChange(event.target.value as QuoteCommercialDiscountType)}
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="flat">Flat amount</option>
              <option value="percent">Percent</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Commercial discount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {discountType === "percent" ? "%" : "$"}
              </span>
              <Input
                type="number"
                min={0}
                step={discountType === "percent" ? 0.5 : 500}
                value={discountValue || ""}
                onChange={(event) => onDiscountValueChange(clampNonNegative(event.target.value))}
                placeholder={discountType === "percent" ? "Discount percent" : "Discount amount"}
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Applied at the quote level. Current total discount: {formatCurrency(discountTotal)}.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Tax profile
          </label>
          <div className="grid gap-2">
            {taxProfiles.map((profile) => {
              const selected = profile.value === taxProfile;
              return (
                <button
                  key={profile.value}
                  type="button"
                  onClick={() => onTaxProfileChange(profile.value)}
                  className={`rounded-lg border p-3 text-left transition ${
                    selected ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card/40 hover:border-qep-orange/40"
                  }`}
                >
                  <p className="text-sm font-medium text-foreground">{profile.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{profile.detail}</p>
                </button>
              );
            })}
          </div>
        </div>

        <TaxBreakdown
          data={taxBreakdown}
          isLoading={taxLoading}
          isError={taxError}
          enabled={taxEnabled}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Cash down
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                min={0}
                step={500}
                value={cashDown || ""}
                onChange={(event) => onCashDownChange(clampNonNegative(event.target.value))}
                placeholder="Customer cash down"
                className="pl-7"
              />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Amount financed</p>
            <p className="mt-2 text-xl font-semibold text-qep-orange">{formatCurrency(amountFinanced)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Customer total minus cash down.</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Commercial Summary</p>
        <div className="space-y-2 text-sm">
          <SummaryRow label="Package subtotal" value={formatCurrency(packageSubtotal)} />
          <SummaryRow label="Discounted subtotal" value={formatCurrency(discountedSubtotal)} />
          <SummaryRow label="Trade allowance" value={`-${formatCurrency(tradeAllowance)}`} positive />
          <SummaryRow label="Net before tax" value={formatCurrency(netTotal)} />
          <SummaryRow label="Estimated tax" value={formatCurrency(taxTotal)} />
          <SummaryRow label="Customer total" value={formatCurrency(customerTotal)} emphasize />
          <SummaryRow label="Cash down" value={`-${formatCurrency(cashDown)}`} positive />
          <SummaryRow label="Amount financed" value={formatCurrency(amountFinanced)} emphasize />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Financing Scenarios</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Scenario math uses the live amount financed after discount, trade, tax, and cash down.
            </p>
          </div>
          {financeLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Calculating…
            </div>
          )}
        </div>

        {financeError && (
          <p className="text-sm text-red-400">Financing preview failed. Try again.</p>
        )}

        {!financeLoading && financeScenarios.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {amountFinanced > 0 ? "No financing scenarios available." : "No financed balance remaining."}
          </p>
        )}

        {financeScenarios.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {financeScenarios.map((scenario) => {
              const selected = selectedScenario === scenario.label;
              return (
                <button
                  key={scenario.label}
                  type="button"
                  onClick={() => onSelectScenario(scenario.label)}
                  className={`rounded-lg border p-3 text-left transition ${
                    selected ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card/40 hover:border-qep-orange/40"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-qep-orange">{scenario.label}</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">
                    {scenario.monthlyPayment == null
                      ? formatCurrency(scenario.totalCost ?? 0)
                      : `${formatCurrency(scenario.monthlyPayment)}/mo`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {scenario.type === "cash"
                      ? "One-time payment"
                      : `${scenario.termMonths ?? 0} months · ${(scenario.apr ?? scenario.rate ?? 0).toFixed(2)}% APR`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Total: {formatCurrency(scenario.totalCost ?? 0)}
                  </p>
                  {scenario.lender ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{scenario.lender}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasize = false,
  positive = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  positive?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${emphasize ? "border-t border-border pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${emphasize ? "text-qep-orange" : positive ? "text-emerald-400" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
