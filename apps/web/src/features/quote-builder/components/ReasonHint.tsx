/**
 * ReasonHint — Slice 18 inline intelligence inside MarginFloorGate.
 *
 * As the rep types their margin-exception reason, we classify it into
 * one of the canonical buckets (same regex-based categorizer the coach
 * uses) and show the historical win rate for that bucket:
 *
 *   ▸ Your reason looks like **Competitive response** — historically
 *     wins 36% (4 of 11 closed). Customer relationship reasons win 73%.
 *
 * Purpose: gentle nudge, not a block. The rep still ships whatever
 * reason they want; we're just giving them the historical signal in
 * the moment of decision.
 *
 * Guards:
 *  - Renders nothing when no reason typed (< 3 chars of non-whitespace)
 *  - Renders nothing when reasonIntelligence has no stats loaded yet
 *  - Renders nothing when the typed reason classifies as 'other' AND
 *    'other' bucket isn't represented in the top intelligence stats
 */

import { useMemo } from "react";
import { Lightbulb } from "lucide-react";
import {
  bucketReason,
  type ReasonIntelligence,
  type ReasonBucket,
} from "../lib/deal-intelligence-api";
import { BUCKET_LABELS } from "../lib/coach-rules/reason-intelligence";

export interface ReasonHintProps {
  /** Text the rep has typed into the reason textarea (live value). */
  reason: string;
  /** Snapshot loaded by the caller (DealCoachSidebar already has it). */
  intelligence: ReasonIntelligence;
}

export function ReasonHint({ reason, intelligence }: ReasonHintProps) {
  const trimmed = reason.trim();

  const body = useMemo(() => {
    if (trimmed.length < 3) return null;
    if (intelligence.stats.length === 0) return null;

    const classified: ReasonBucket = bucketReason(trimmed);

    const matched = intelligence.stats.find((s) => s.bucket === classified);
    const topDifferent = intelligence.stats.find((s) => s.bucket !== classified);

    // If the classifier lands on "other" AND it's not in the stats, we
    // don't have a comparable signal to show — bail.
    if (!matched && classified === "other") return null;

    return { classified, matched, topDifferent };
  }, [trimmed, intelligence.stats]);

  if (!body) return null;

  const { classified, matched, topDifferent } = body;
  const label = BUCKET_LABELS[classified] ?? classified;

  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="flex-1">
        <div>
          Your reason looks like{" "}
          <span className="font-semibold">{label}</span>
          {matched && matched.winRatePct != null ? (
            <>
              {" "}— historically wins{" "}
              <span className="font-semibold">{matched.winRatePct.toFixed(0)}%</span>{" "}
              ({matched.wins} of {matched.wins + matched.losses} closed).
            </>
          ) : (
            <> — not enough historical samples in this bucket yet.</>
          )}
        </div>
        {topDifferent && topDifferent.winRatePct != null
          && matched?.winRatePct != null
          && topDifferent.winRatePct > matched.winRatePct + 10
          ? (
            <div className="mt-1 text-muted-foreground">
              {BUCKET_LABELS[topDifferent.bucket] ?? topDifferent.bucket}{" "}
              reasons close at{" "}
              <span className="font-semibold">{topDifferent.winRatePct.toFixed(0)}%</span>
              . Pick the category that best matches the truth of the deal.
            </div>
          ) : null}
      </div>
    </div>
  );
}
