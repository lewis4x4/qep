/**
 * PendingApprovalsBanner — thin one-line strip surfacing the rep's pending
 * quote approvals on the Pipeline page so they can't miss a stuck submission.
 *
 * Self-hides when there is nothing pending. Tapping routes to the dedicated
 * My Approvals page (/sales/my-approvals).
 *
 * Mounts on PipelineBoardPage between the hero block and PipelinePulse. The
 * page already guards against an empty pipeline, but the banner also exits
 * early at pendingCount === 0, so it stays quiet when there's nothing to say.
 */
import { useNavigate } from "react-router-dom";
import { Clock, ChevronRight } from "lucide-react";
import { useMyApprovals } from "../hooks/useMyApprovals";

export function PendingApprovalsBanner() {
  const navigate = useNavigate();
  const { pendingCount } = useMyApprovals();

  if (pendingCount === 0) return null;

  const noun = pendingCount === 1 ? "quote" : "quotes";

  return (
    <div className="px-4 pt-2.5 pb-0.5">
      <button
        type="button"
        onClick={() => navigate("/sales/my-approvals")}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[12px] border border-qep-orange/30 bg-qep-orange/[0.06] hover:bg-qep-orange/[0.10] transition-colors text-left active:scale-[0.995]"
        aria-label={`${pendingCount} ${noun} awaiting approval — review`}
      >
        <Clock className="w-4 h-4 shrink-0 text-qep-orange" aria-hidden />
        <p className="flex-1 min-w-0 text-[12.5px] leading-snug text-foreground/90">
          <span className="font-bold text-qep-orange tabular-nums">
            {pendingCount}
          </span>{" "}
          {noun} awaiting approval
          <span className="text-muted-foreground/70 font-normal ml-1.5">
            · Tap to review
          </span>
        </p>
        <ChevronRight
          className="w-4 h-4 shrink-0 text-qep-orange/80"
          aria-hidden
        />
      </button>
    </div>
  );
}
