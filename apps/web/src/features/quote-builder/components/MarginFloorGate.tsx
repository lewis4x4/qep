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
  reasonModalOpen,
  onReasonModalOpenChange,
  onReasonConfirm,
}: MarginFloorGateProps) {
  const [threshold, setThreshold] = useState<MarginThresholdRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getApplicableThreshold(brandId).then(({ threshold }) => {
      if (cancelled) return;
      setThreshold(threshold);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [brandId]);

  // Reset reason on modal open
  useEffect(() => {
    if (reasonModalOpen) setReason("");
  }, [reasonModalOpen]);

  if (loading || !threshold) return null;

  const thresholdPct = Number(threshold.min_margin_pct);
  const isUnder = isUnderThreshold(marginPct, thresholdPct);
  if (!isUnder) return null;

  const gapCents = estimateMarginGapCents(netTotalCents, marginPct, thresholdPct);
  const gapDollars = Math.round(gapCents / 100).toLocaleString("en-US");

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

      {/* Reason modal */}
      <Dialog open={reasonModalOpen} onOpenChange={onReasonModalOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Margin below floor — reason required</DialogTitle>
            <DialogDescription>
              This quote is {(thresholdPct - marginPct).toFixed(1)} pts below the {threshold.brand_id ? "brand" : "workspace"} floor.
              A short reason is logged to the margin-exceptions report for management review.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="margin-reason">Your reason</Label>
            <textarea
              id="margin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="e.g. Customer has signed a 2-year service agreement that offsets margin, or competitive response to retain account."
              rows={4}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <p className="text-[10px] text-muted-foreground">{reason.length}/500</p>
          </div>

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

