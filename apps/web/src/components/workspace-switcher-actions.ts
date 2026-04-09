import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "@/hooks/use-toast";
import { clearCachedProfile } from "@/lib/auth-recovery";

type ToastFn = typeof toast;

export async function performWorkspaceSwitch(params: {
  activeWorkspaceId: string;
  target: string;
  switchingRef: { current: boolean };
  supabaseClient: Pick<SupabaseClient, "rpc"> & {
    auth: Pick<SupabaseClient["auth"], "getSession" | "refreshSession">;
  };
  queryClient: Pick<QueryClient, "clear">;
  notify: ToastFn;
  clearProfileCache: typeof clearCachedProfile;
  reload: () => void;
}): Promise<void> {
  const {
    activeWorkspaceId,
    target,
    switchingRef,
    supabaseClient,
    queryClient,
    notify,
    clearProfileCache,
    reload,
  } = params;

  if (target === activeWorkspaceId || switchingRef.current) return;
  switchingRef.current = true;

  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    const { error } = await supabaseClient.rpc("set_active_workspace", { target });
    if (error) {
      notify({
        variant: "destructive",
        title: "Couldn't switch workspace",
        description: error.message,
      });
      return;
    }
    if (session?.user?.id) {
      clearProfileCache(session.user.id);
    }
    const { error: refreshError } = await supabaseClient.auth.refreshSession();
    if (refreshError) {
      notify({
        title: "Workspace updated",
        description: "Refreshing your session took too long. Reloading to finish the switch.",
      });
    }
    queryClient.clear();
    reload();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[workspace-switcher] switch failed:", err);
    notify({
      variant: "destructive",
      title: "Couldn't switch workspace",
      description: err instanceof Error
        ? err.message
        : "The workspace changed on the server but the app could not finish refreshing.",
    });
  } finally {
    switchingRef.current = false;
  }
}
