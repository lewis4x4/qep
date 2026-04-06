import { UsersRound } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface QrmTerritoryConflictBadgeProps {
  territoryName: string;
  territoryRepName: string | null;
  contactRepName: string | null;
  canResolve: boolean;
  onResolve?: () => void;
}

export function QrmTerritoryConflictBadge({
  territoryName,
  territoryRepName,
  contactRepName,
  canResolve,
  onResolve,
}: QrmTerritoryConflictBadgeProps) {
  return (
    <div
      className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-4 text-sm shadow-sm dark:border-amber-400/20 dark:bg-amber-400/[0.07]"
      role="status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <UsersRound className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="font-medium text-amber-950 dark:text-amber-50">
              Territory rep and contact rep don&apos;t match
            </p>
            <p className="text-pretty text-amber-950/80 dark:text-amber-100/85">
              This contact is tied to{" "}
              <span className="font-medium text-amber-950 dark:text-amber-50">{territoryName}</span>, but the
              rep who owns that territory isn&apos;t the same as the rep assigned to this contact. It&apos;s a
              heads-up for routing and ownership—not a system error.
            </p>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-left text-xs font-medium text-amber-800/90 underline decoration-amber-600/40 underline-offset-2 transition hover:decoration-amber-700 dark:text-amber-200/90 dark:decoration-amber-400/40 dark:hover:decoration-amber-300"
                  >
                    Who is assigned where?
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-[280px] text-xs leading-relaxed">
                  <span className="font-medium">Territory rep:</span> {territoryRepName || "Unassigned"}
                  <br />
                  <span className="font-medium">Contact rep:</span> {contactRepName || "Unassigned"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        {canResolve && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-600/35 bg-background/60 text-foreground hover:bg-amber-500/10 dark:border-amber-400/30 dark:hover:bg-amber-400/10"
            onClick={onResolve}
          >
            Open company
          </Button>
        )}
      </div>
    </div>
  );
}
