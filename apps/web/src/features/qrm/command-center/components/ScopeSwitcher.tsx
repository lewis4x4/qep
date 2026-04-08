import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommandCenterScope, IronRole } from "../api/commandCenter.types";

interface ScopeSwitcherProps {
  scope: CommandCenterScope;
  onChange: (next: CommandCenterScope) => void;
  ironRole: IronRole;
}

const ELEVATED_SCOPES: CommandCenterScope[] = ["mine", "team"];
const ADVISOR_SCOPES: CommandCenterScope[] = ["mine"];

const SCOPE_LABEL: Record<CommandCenterScope, string> = {
  mine: "Mine",
  team: "Team",
  branch: "Branch",
  company: "Company",
};

function isElevated(role: IronRole): boolean {
  return role === "iron_manager";
}

export function ScopeSwitcher({ scope, onChange, ironRole }: ScopeSwitcherProps) {
  const available = isElevated(ironRole) ? ELEVATED_SCOPES : ADVISOR_SCOPES;

  if (available.length <= 1) {
    return (
      <Badge variant="outline" className="border-border/60 text-xs text-muted-foreground">
        Scope: {SCOPE_LABEL[available[0] ?? "mine"]}
      </Badge>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 p-1">
      {available.map((option) => {
        const active = option === scope;
        return (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={active ? "default" : "ghost"}
            className={cn(
              "h-7 px-3 text-xs font-medium",
              active
                ? "bg-qep-orange text-white shadow-sm hover:bg-qep-orange/90"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(option)}
          >
            {SCOPE_LABEL[option]}
          </Button>
        );
      })}
    </div>
  );
}
