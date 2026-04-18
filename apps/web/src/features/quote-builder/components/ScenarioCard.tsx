/**
 * ScenarioCard — displays one AI-generated deal scenario (Slice 05)
 *
 * Renders the scenario label, deal economics, monthly payment (if financing),
 * dealer margin indicator, and pros/cons accordion. Compact by default;
 * expands to show full detail on click.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Check, TrendingUp, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { QuoteScenario } from "@/features/quote-builder/lib/programs-types";

interface ScenarioCardProps {
  scenario: QuoteScenario;
  index: number;
  onSelect: (scenario: QuoteScenario) => void;
  selected?: boolean;
  /** Whether the rep is allowed to see margin (rep vs admin/manager) */
  showMargin?: boolean;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function marginColor(pct: number): string {
  if (pct >= 0.14) return "text-emerald-400";
  if (pct >= 0.10) return "text-yellow-400";
  return "text-red-400";
}

function marginLabel(pct: number): string {
  const pctStr = `${(pct * 100).toFixed(1)}%`;
  if (pct >= 0.14) return `${pctStr} margin — solid`;
  if (pct >= 0.10) return `${pctStr} margin — acceptable`;
  return `${pctStr} margin — needs approval`;
}

/** Accent colors for scenario index (0–3) */
const ACCENT_CLASSES = [
  "border-qep-orange/40 bg-qep-orange/5",
  "border-blue-500/40 bg-blue-500/5",
  "border-emerald-500/40 bg-emerald-500/5",
  "border-purple-500/40 bg-purple-500/5",
];

const ACCENT_BADGE = [
  "bg-qep-orange/10 text-qep-orange",
  "bg-blue-500/10 text-blue-400",
  "bg-emerald-500/10 text-emerald-400",
  "bg-purple-500/10 text-purple-400",
];

export function ScenarioCard({
  scenario,
  index,
  onSelect,
  selected = false,
  showMargin = true,
}: ScenarioCardProps) {
  const [expanded, setExpanded] = useState(false);

  const accent = ACCENT_CLASSES[index % ACCENT_CLASSES.length];
  const badge  = ACCENT_BADGE[index % ACCENT_BADGE.length];

  const isFinancing = typeof scenario.monthlyPaymentCents === "number";

  return (
    <Card
      className={`border transition-all duration-200 ${accent} ${
        selected ? "ring-2 ring-qep-orange" : ""
      }`}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${badge}`}>
              Option {index + 1}
            </span>
            <p className="mt-1 text-sm font-bold text-foreground leading-tight">{scenario.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{scenario.description}</p>
          </div>

          {selected && (
            <div className="shrink-0 rounded-full bg-qep-orange p-1">
              <Check className="h-3 w-3 text-white" />
            </div>
          )}
        </div>

        {/* Key economics */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {isFinancing ? (
            <>
              <div className="rounded-md border border-border/60 bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Monthly</p>
                <p className="mt-0.5 text-base font-bold text-foreground">
                  {formatDollars(scenario.monthlyPaymentCents!)}<span className="text-xs font-normal text-muted-foreground">/mo</span>
                </p>
                {scenario.termMonths && (
                  <p className="text-[10px] text-muted-foreground">{scenario.termMonths} months</p>
                )}
              </div>
              <div className="rounded-md border border-border/60 bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Total paid</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {formatDollars(scenario.totalPaidByCustomerCents)}
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border/60 bg-background/60 p-2 col-span-2 sm:col-span-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Customer pays</p>
              <p className="mt-0.5 text-base font-bold text-foreground">
                {formatDollars(scenario.customerOutOfPocketCents)}
              </p>
            </div>
          )}

          {showMargin && (
            <div className="rounded-md border border-border/60 bg-background/60 p-2">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Margin</p>
              </div>
              <p className={`mt-0.5 text-sm font-semibold ${marginColor(scenario.dealerMarginPct)}`}>
                {marginLabel(scenario.dealerMarginPct)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatDollars(scenario.commissionCents)} commission
              </p>
            </div>
          )}
        </div>

        {/* Approval warning */}
        {scenario.dealerMarginPct < 0.10 && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5">
            <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />
            <p className="text-[11px] text-red-400">Margin below floor — manager approval required before closing.</p>
          </div>
        )}

        {/* Pros/Cons accordion */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>
            {expanded ? "Hide" : "Show"} pros &amp; cons ({scenario.pros.length + scenario.cons.length})
          </span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="mt-2 space-y-2 text-xs">
            {scenario.pros.length > 0 && (
              <div>
                <p className="font-semibold text-emerald-400 uppercase tracking-[0.12em]">Pros</p>
                <ul className="mt-1 space-y-0.5">
                  {scenario.pros.map((p) => (
                    <li key={p} className="flex items-start gap-1.5 text-muted-foreground">
                      <span className="mt-0.5 shrink-0 text-emerald-400">+</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {scenario.cons.length > 0 && (
              <div>
                <p className="font-semibold text-red-400 uppercase tracking-[0.12em]">Tradeoffs</p>
                <ul className="mt-1 space-y-0.5">
                  {scenario.cons.map((c) => (
                    <li key={c} className="flex items-start gap-1.5 text-muted-foreground">
                      <span className="mt-0.5 shrink-0 text-red-400">−</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Select button */}
        <div className="mt-3 pt-3 border-t border-border/40">
          <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            onClick={() => onSelect(scenario)}
            className="w-full text-xs"
          >
            {selected ? "Selected — review the quote above" : "Use this scenario →"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
