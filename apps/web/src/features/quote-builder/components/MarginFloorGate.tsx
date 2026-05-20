import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  getApplicableThreshold,
  isUnderThreshold,
  estimateMarginGapCents,
  type MarginThresholdRow,
} from "@/features/admin/lib/pricing-discipline-api";
import {
  getReasonIntelligence,
  type ReasonIntelligence,
} from "../lib/deal-intelligence-api";
import { ReasonHint } from "./ReasonHint";
import { MobileBottomSheet } from "@/features/sales/components/MobileBottomSheet";
import { MobileVoiceTextarea } from "@/features/sales/components/MobileVoiceTextarea";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";

/**
 * Slice 15 — Margin Floor Gate.
 *
 * Two UI parts wrapped in one component:
 *   1. Inline banner visible when the current draft margin is under
 *      the applicable threshold. Renders nothing when margin is fine.
 *   2. Reason modal that the parent opens before committing the save.
 *      Returns the reason text to the caller via onConfirm. The caller
 *      is responsible for logging the exception via pricing-discipline
 *      -api.logMarginException once the save succeeds.
 *
 * Threshold resolution runs once on mount or when brandId changes.
 * The component is intentionally decoupled from save — the parent owns
 * the save mutation and composes the reason flow in.
 */

export interface MarginFloorGateProps {
  /** The brand id resolved from the draft's primary equipment (nullable). */
  brandId: string | null;
  /** Current draft margin_pct. */
  marginPct: number;
  /** Current draft net total in cents — used to estimate dollar gap. */
  netTotalCents: number;
  /** Resolved floor from the quote-builder margin resolver. Omit to let this component fetch. */
  marginFloorPct?: number | null;
  /** Human-readable source for copy/debugging (brand/default/fallback). */
  marginFloorSource?: "brand" | "default" | "fallback_default" | "none";
  /** Controlled open state for the reason modal. */
  reasonModalOpen: boolean;
  onReasonModalOpenChange: (next: boolean) => void;
  /** Invoked when the rep submits a valid reason. The caller persists. */
  onReasonConfirm: (payload: {
    reason: string;
    thresholdPct: number;
    estimatedGapCents: number;
  }) => void;
}

export function MarginFloorGate({
  brandId,
  marginPct,
  netTotalCents,
  marginFloorPct,
  marginFloorSource,
  reasonModalOpen,
  onReasonModalOpenChange,
  onReasonConfirm,
}: MarginFloorGateProps) {
  const [threshold, setThreshold] = useState<MarginThresholdRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  // Slice 18 — reason intelligence loaded lazily when the modal opens so
  // we don't pay the query on every quote, only when the rep is about to
  // actually need it.
  const [reasonIntel, setReasonIntel] = useState<ReasonIntelligence>({ stats: [], totalSamples: 0 });

  useEffect(() => {
    if (marginFloorPct !== undefined) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getApplicableThreshold(brandId)
      .then(({ threshold }) => {
        if (cancelled) return;
        setThreshold(threshold);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[MarginFloorGate] threshold fetch failed:", err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [brandId, marginFloorPct]);

  // Reset reason on modal open + lazy-load reason intelligence
  useEffect(() => {
    if (!reasonModalOpen) return;
    setReason("");
    let cancelled = false;
    getReasonIntelligence().then((r) => {
      if (!cancelled) setReasonIntel(r);
    });
    return () => { cancelled = true; };
  }, [reasonModalOpen]);

  // WAVE quote-builder deep reflow (A1): mobile reps see the reason
  // prompt as a MobileBottomSheet so the gate matches the SalesShell
  // chrome instead of a desktop Radix Dialog overlay.
  const isMobile = useIsMobileViewport();

  if (loading) return null;

  const thresholdPct = marginFloorPct !== undefined
    ? marginFloorPct
    : threshold
      ? Number(threshold.min_margin_pct)
      : null;
  if (thresholdPct == null) return null;
  const isUnder = isUnderThreshold(marginPct, thresholdPct);
  if (!isUnder) return null;

  const gapCents = estimateMarginGapCents(netTotalCents, marginPct, thresholdPct);
  const gapDollars = Math.round(gapCents / 100).toLocaleString("en-US");

  const reasonBody = (
    <div className="space-y-2 py-2">
      <Label htmlFor="margin-reason">Your reason</Label>
      <MobileVoiceTextarea
        id="margin-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 500))}
        placeholder="e.g. Customer has signed a 2-year service agreement that offsets margin, or competitive response to retain account."
        rows={4}
        className="w-full rounded-md border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
      />
      <p className="text-[10px] text-muted-foreground">{reason.length}/500</p>

      <ReasonHint reason={reason} intelligence={reasonIntel} />
    </div>
  );

  const floorSourceLabel = marginFloorSource === "brand" || threshold?.brand_id
    ? "brand"
    : marginFloorSource === "fallback_default"
      ? "default workspace"
      : "workspace";
  const subtitle = `This quote is ${(thresholdPct - marginPct).toFixed(1)} pts below the ${floorSourceLabel} floor. A short reason is logged to the margin-exceptions report for management review.`;

  return (
    <>
      {/* Inline banner */}
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1">
          <div className="font-medium">
            Margin is under floor ({marginPct.toFixed(1)}% vs {thresholdPct.toFixed(1)}%)
          </div>
          <div className="text-xs text-muted-foreground">
            Save will require a reason. Estimated gap to floor: ~${gapDollars}.
          </div>
        </div>
      </div>

      {/* Reason modal — desktop Radix Dialog, mobile MobileBottomSheet */}
      {isMobile ? (
        <MobileBottomSheet
          open={reasonModalOpen}
          onOpenChange={onReasonModalOpenChange}
          title="Margin below floor"
          description={subtitle}
          size="tall"
        >
          {reasonBody}
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => onReasonModalOpenChange(false)}>
              Cancel save
            </Button>
            <Button
              disabled={reason.trim().length < 10}
              onClick={() => onReasonConfirm({
                reason: reason.trim(),
                thresholdPct,
                estimatedGapCents: gapCents,
              })}
            >
              {reason.trim().length < 10 ? (
                <span className="text-xs">At least 10 characters…</span>
              ) : (
                <>Confirm save</>
              )}
            </Button>
          </div>
        </MobileBottomSheet>
      ) : (
        <Dialog open={reasonModalOpen} onOpenChange={onReasonModalOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Margin below floor — reason required</DialogTitle>
              <DialogDescription>{subtitle}</DialogDescription>
            </DialogHeader>
            {reasonBody}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onReasonModalOpenChange(false)}>
                Cancel save
              </Button>
              <Button
                disabled={reason.trim().length < 10}
                onClick={() => onReasonConfirm({
                  reason: reason.trim(),
                  thresholdPct,
                  estimatedGapCents: gapCents,
                })}
              >
                {reason.trim().length < 10 ? (
                  <span className="text-xs">At least 10 characters…</span>
                ) : (
                  <>Confirm save</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * Parent-facing helper — used by QuoteBuilderV2Page to decide whether the
 * save mutation should proceed directly or first open the reason modal.
 * Pure; exported for tests.
 */
export function shouldGateSave(input: {
  marginPct: number;
  thresholdPct: number | null;
}): boolean {
  return isUnderThreshold(input.marginPct, input.thresholdPct);
}

