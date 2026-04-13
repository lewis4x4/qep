/**
 * Sync Engine — processes offline queue on reconnect
 */
import { supabase } from "@/lib/supabase";
import { getOfflineQueue, clearSyncedActions } from "./offline-store";

interface SyncResult {
  total: number;
  synced: number;
  failed: number;
}

export async function syncOfflineQueue(): Promise<SyncResult> {
  const queue = await getOfflineQueue();

  if (queue.length === 0) {
    return { total: 0, synced: 0, failed: 0 };
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { total: queue.length, synced: 0, failed: queue.length };
    }

    const response = await supabase.functions.invoke("process-offline-queue", {
      body: { actions: queue },
    });

    if (response.error) {
      console.error("[sync-engine] edge function error:", response.error);
      return { total: queue.length, synced: 0, failed: queue.length };
    }

    const data = response.data as {
      results: Array<{ id: string; status: string }>;
      synced: number;
      failed: number;
    };

    // Clear synced items from IndexedDB
    const syncedIds = data.results
      .filter((r) => r.status === "synced")
      .map((r) => r.id);

    if (syncedIds.length > 0) {
      await clearSyncedActions(syncedIds);
    }

    return {
      total: queue.length,
      synced: data.synced,
      failed: data.failed,
    };
  } catch (err) {
    console.error("[sync-engine] sync failed:", err);
    return { total: queue.length, synced: 0, failed: queue.length };
  }
}

/**
 * Register a listener that syncs when the browser comes back online.
 * Also performs an initial sync if already online at mount time.
 */
export function registerSyncOnReconnect(): () => void {
  async function handleOnline() {
    console.info("[sync-engine] online — syncing offline queue...");
    const result = await syncOfflineQueue();
    console.info("[sync-engine] sync complete:", result);
  }

  // Sync immediately if already online (clears any queue from previous session)
  if (navigator.onLine) {
    handleOnline();
  }

  window.addEventListener("online", handleOnline);
  return () => window.removeEventListener("online", handleOnline);
}
