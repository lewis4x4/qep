/**
 * DecisionRoomReplayBanner — outcome banner when the loaded deal is
 * already closed-lost. Tells the rep they're training against a real
 * historical loss, names what killed it, and keeps the rest of the
 * simulator operational for replay. The simulator page shows this at
 * the very top, above the Coach's Read.
 */
import { Flag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeckSurface } from "./command-deck";

interface Props {
  lossReason: string | null;
  competitor: string | null;
  dealName: string | null;
}

export function DecisionRoomReplayBanner({ lossReason, competitor, dealName }: Props) {
  if (!lossReason && !competitor) return null;

  return (
    <DeckSurface
      className={cn(
        "border-amber-400/40 bg-gradient-to-r from-amber-400/[0.08] to-red-500/[0.04] p-5",
      )}
      aria-label="Training gym — this is a closed-lost deal"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10">
          <Flag className="h-4 w-4 text-amber-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
            Training gym — this deal has already closed lost
          </p>
          <p className="mt-1 text-sm text-foreground/90">
            {dealName ? `${dealName} is a live practice target. ` : ""}
            Everything on this page still works — the moves you try won't change the past,
            but the reactions they surface are the training signal.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {lossReason ? (
              <span className="rounded-full border border-red-400/40 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-200">
                <span className="mr-1 font-semibold uppercase tracking-wider">Lost to</span>
                {lossReason}
              </span>
            ) : null}
            {competitor ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200">
                <Trophy className="h-3 w-3" aria-hidden />
                <span className="font-semibold uppercase tracking-wider">Winner:</span>
                {competitor}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </DeckSurface>
  );
}
