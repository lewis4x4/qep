import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Save, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { money } from "../lib/money";
import { readinessChipLabel, statusLabel } from "../lib/quote-builder-page-helpers";
import type { AutoSaveState } from "../wizard/wizard-types";
import type { QuotePacketReadiness } from "../../../../../../shared/qep-moonshot-contracts";

export interface QuoteBuilderStickyBarProps {
  quoteTitle: string;
  quoteStatus: string;
  autoSaveState: AutoSaveState;
  displayedSavedLabel: string | null;
  packetReadiness: QuotePacketReadiness;
  customerTotal: number;
  financeMethodLabel: string;
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  primaryActionPending: boolean;
  primaryActionShowsSendIcon: boolean;
  onPrimaryAction: () => void;
}

export function QuoteBuilderStickyBar({
  quoteTitle,
  quoteStatus,
  autoSaveState,
  displayedSavedLabel,
  packetReadiness,
  customerTotal,
  financeMethodLabel,
  primaryActionLabel,
  primaryActionDisabled,
  primaryActionPending,
  primaryActionShowsSendIcon,
  onPrimaryAction,
}: QuoteBuilderStickyBarProps) {
  return (
    <div className="sticky top-0 z-30 rounded-xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
            <Link to="/floor"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to Floor</Link>
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{quoteTitle}</p>
              <span className="rounded-full border border-qep-orange/30 bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-qep-orange">
                {statusLabel(quoteStatus)}
              </span>
              <span className="text-xs text-muted-foreground">
                {autoSaveState === "saving"
                  ? "Saving..."
                  : autoSaveState === "error"
                    ? "Save failed"
                    : displayedSavedLabel
                      ? `Saved ${displayedSavedLabel}`
                      : autoSaveState === "local"
                        ? "Local draft"
                        : "Not saved"}
              </span>
            </div>
            {packetReadiness.draft.ready ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Cmd-S saves. Auto-save runs every 10 seconds when the draft is server-ready.
              </p>
            ) : packetReadiness.draft.missing.length > 0 ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Needs:</span>
                {packetReadiness.draft.missing.map((missing) => (
                  <span
                    key={missing}
                    title={missing}
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300"
                  >
                    {readinessChipLabel(missing)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">Start the quote to enable save.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
          <div className="text-right">
            <p className="font-kpi text-2xl font-extrabold tabular-nums text-qep-orange">
              {money(customerTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground">{financeMethodLabel}</p>
          </div>
          <span className="rounded-lg border border-qep-orange/30 bg-qep-orange/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-qep-orange">
            Guided wizard
          </span>
          <Button onClick={onPrimaryAction} disabled={primaryActionDisabled}>
            {primaryActionPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : primaryActionShowsSendIcon ? (
              <Send className="mr-1 h-4 w-4" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {primaryActionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
