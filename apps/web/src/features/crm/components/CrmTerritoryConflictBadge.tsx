import { AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface CrmTerritoryConflictBadgeProps {
  territoryName: string;
  territoryRepName: string | null;
  contactRepName: string | null;
  canResolve: boolean;
  onResolve?: () => void;
}

export function CrmTerritoryConflictBadge({
  territoryName,
  territoryRepName,
  contactRepName,
  canResolve,
  onResolve,
}: CrmTerritoryConflictBadgeProps) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Territory assignment conflict
        </span>
        {canResolve && (
          <Button size="sm" variant="outline" onClick={onResolve}>
            Resolve
          </Button>
        )}
      </div>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="mt-2 cursor-help underline decoration-dotted underline-offset-2">
              {territoryName}: territory rep and contact rep differ.
            </p>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-[300px]">
            Territory rep: {territoryRepName || "Unassigned"}. Contact rep: {contactRepName || "Unassigned"}.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
