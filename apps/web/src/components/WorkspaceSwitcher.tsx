import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useWorkspaceMemberships } from "@/hooks/useWorkspaceMemberships";

interface WorkspaceSwitcherProps {
  activeWorkspaceId: string;
}

function displayName(workspaceId: string): string {
  if (workspaceId === "default") return "Default";
  return workspaceId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkspaceSwitcher({ activeWorkspaceId }: WorkspaceSwitcherProps) {
  const queryClient = useQueryClient();
  const { data: memberships = [], isLoading } = useWorkspaceMemberships();
  const [switching, setSwitching] = useState(false);

  const handleSwitch = useCallback(
    async (target: string) => {
      if (target === activeWorkspaceId || switching) return;
      setSwitching(true);
      try {
        const { error } = await supabase.rpc("set_active_workspace", { target });
        if (error) {
          // eslint-disable-next-line no-console
          console.error("[workspace-switcher] set_active_workspace failed:", error.message);
          return;
        }
        // Pull a fresh JWT so app_metadata claims reflect the new workspace.
        await supabase.auth.refreshSession();
        // Invalidate the entire react-query cache — most keys are workspace-scoped.
        queryClient.clear();
        // Hard reload as a v1 safety net so every module re-initializes cleanly.
        window.location.reload();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[workspace-switcher] switch failed:", err);
      } finally {
        setSwitching(false);
      }
    },
    [activeWorkspaceId, queryClient, switching],
  );

  // Don't render anything unless the user has more than one membership.
  if (isLoading || memberships.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={switching}
          className="h-8 gap-2 rounded-full border border-white/15 bg-white/5 px-3 text-xs text-white hover:bg-white/10 hover:text-white"
          aria-label={`Active workspace: ${displayName(activeWorkspaceId)}. Click to switch.`}
        >
          <Building2 className="h-3.5 w-3.5 text-qep-orange" aria-hidden />
          <span className="hidden sm:inline">{displayName(activeWorkspaceId)}</span>
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Switch workspace
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map(({ workspace_id }) => {
          const isActive = workspace_id === activeWorkspaceId;
          return (
            <DropdownMenuItem
              key={workspace_id}
              onSelect={() => {
                void handleSwitch(workspace_id);
              }}
              className="gap-2"
            >
              <Check
                className={`h-3.5 w-3.5 ${isActive ? "text-qep-orange" : "invisible"}`}
                aria-hidden
              />
              <span className="flex-1 text-sm">{displayName(workspace_id)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
