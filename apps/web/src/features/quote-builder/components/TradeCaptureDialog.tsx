import type { Dispatch, SetStateAction } from "react";
import { ArrowRight, Camera, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// WAVE polish:
//   Slice 2 — dictation on the active capture note (MobileVoiceTextarea).
//   Slice 3 — render as MobileBottomSheet at <640px so the trade-in
//   capture flow inherits the SalesShell chrome on phones.
import { MobileBottomSheet } from "@/features/sales/components/MobileBottomSheet";
import { MobileVoiceTextarea } from "@/features/sales/components/MobileVoiceTextarea";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";

import {
  TRADE_CHECKLIST_ITEMS,
  type TradeCaptureDraft,
  type TradeChecklistKey,
} from "../lib/trade-checklist";

export interface TradeCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTradeCaptureKey: TradeChecklistKey;
  onActiveTradeCaptureKeyChange: (key: TradeChecklistKey) => void;
  tradeCapture: TradeCaptureDraft;
  setTradeCapture: Dispatch<SetStateAction<TradeCaptureDraft>>;
  tradeChecklist: Record<TradeChecklistKey, boolean>;
}

export function TradeCaptureDialog({
  open,
  onOpenChange,
  activeTradeCaptureKey,
  onActiveTradeCaptureKeyChange,
  tradeCapture,
  setTradeCapture,
  tradeChecklist,
}: TradeCaptureDialogProps) {
  const activeItem = TRADE_CHECKLIST_ITEMS.find((item) => item.key === activeTradeCaptureKey)
    ?? TRADE_CHECKLIST_ITEMS[0]!;
  const activeFieldId = `trade-capture-field-${activeItem.key}`;
  const activeLabelId = `trade-capture-label-${activeItem.key}`;
  // WAVE polish (Slice 3): branch to MobileBottomSheet on phone viewports.
  const isMobile = useIsMobileViewport();

  const body = (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
          {TRADE_CHECKLIST_ITEMS.map((item) => {
            const active = activeTradeCaptureKey === item.key;
            const complete = tradeChecklist[item.key];
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                aria-label={`${item.label}${complete ? ", captured" : ""}`}
                onClick={() => onActiveTradeCaptureKeyChange(item.key)}
                className={`rounded-lg border p-3 text-left text-sm transition ${
                  active
                    ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                    : complete
                      ? "border-emerald-500/30 bg-emerald-500/5 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-2">
                  {complete && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  <span className="font-semibold">{item.label}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs opacity-80">{tradeCapture[item.key] || item.prompt}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p id={activeLabelId} className="text-sm font-semibold text-foreground">{activeItem.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{activeItem.prompt}</p>
            </div>
            {tradeChecklist[activeItem.key] && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                Captured
              </span>
            )}
          </div>
          <MobileVoiceTextarea
            id={activeFieldId}
            aria-labelledby={activeLabelId}
            value={tradeCapture[activeItem.key]}
            onChange={(event) => setTradeCapture((current) => ({ ...current, [activeItem.key]: event.target.value }))}
            placeholder={activeItem.placeholder}
            className="mt-3 min-h-[120px] w-full rounded border border-input bg-background px-3 py-2 text-base sm:text-sm"
          />
          <label className="mt-3 block rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <Camera className="h-4 w-4 text-qep-orange" /> Optional photo evidence
            </div>
            <p className="mt-1 text-xs">
              Attach a local photo during capture. The note above is what drives checklist completion today.
            </p>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-3 block w-full text-xs"
              onChange={(event) => {
                const fileName = event.target.files?.[0]?.name;
                if (!fileName) return;
                setTradeCapture((current) => ({
                  ...current,
                  [activeItem.key]: `${current[activeItem.key]}${current[activeItem.key].trim() ? "\n" : ""}Photo captured: ${fileName}`,
                }));
              }}
            />
          </label>
          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => setTradeCapture((current) => ({ ...current, [activeItem.key]: "" }))}
            >
              Clear this evidence
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
              <Button
                onClick={() => {
                  const currentIndex = TRADE_CHECKLIST_ITEMS.findIndex((item) => item.key === activeItem.key);
                  const next = TRADE_CHECKLIST_ITEMS[currentIndex + 1];
                  if (next) onActiveTradeCaptureKeyChange(next.key);
                  else onOpenChange(false);
                }}
              >
                Save & next <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
    </>
  );

  if (isMobile) {
    return (
      <MobileBottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Trade capture evidence"
        description="Capture the trade facts here without leaving the quote. Rows check off automatically when their evidence field has content."
        size="tall"
      >
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trade capture evidence</DialogTitle>
          <DialogDescription>
            Capture the trade facts here without leaving the quote. Rows check off automatically when their evidence field has content.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
