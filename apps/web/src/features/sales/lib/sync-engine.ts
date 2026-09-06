/**
 * Sync Engine — processes offline queue on reconnect
 */
import { supabase } from "@/lib/supabase";
import { getOfflineQueue, clearSyncedActions, getOfflineIdentity, assertOfflineIdentity } from "./offline-store";

interface SyncResult {
  total: number;
  synced: number;
  failed: number;
}

let activeSync: Promise<SyncResult> | null = null;
export function syncOfflineQueue(): Promise<SyncResult> {
  if (!activeSync) activeSync = drainQueue().finally(() => { activeSync = null; });
  return activeSync;
}

async function drainQueue(): Promise<SyncResult> {
  let total = 0, synced = 0;
  try {
    const identity = await getOfflineIdentity();
    const queue = (await getOfflineQueue()).sort((a, b) => (Date.parse(a.queued_at) || 0) - (Date.parse(b.queued_at) || 0));
    total = queue.length;
    // Preserve the server's 50-action admission limit, and retire only exact
    // acknowledged IDs. Conflicts/errors stay in the original operator's store.
    for (let offset = 0; offset < queue.length; offset += 50) {
      await assertOfflineIdentity(identity);
      const batch = queue.slice(offset, offset + 50);
      const response = await supabase.functions.invoke("process-offline-queue", { body: { actions: batch } });
      if (response.error) break;
      const results = response.data?.results;
      if (!Array.isArray(results)) break;
      const submitted = new Set(batch.map((action) => action.id));
      const acknowledged = [...new Set(results
        .filter((result) => result?.status === "synced" && submitted.has(result.id))
        .map((result) => result.id as string))];
      await assertOfflineIdentity(identity);
      if (acknowledged.length) await clearSyncedActions(acknowledged, identity);
      synced += acknowledged.length;
    }
  } catch (error) {
    console.warn("[sync-engine] Pending offline work retained:", error);
  }
  return { total, synced, failed: total - synced };
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
