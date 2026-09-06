/**
 * Offline Store — IndexedDB cache for Sales Companion
 *
 * Caches customer roster, pipeline deals, and today's briefing for offline reads.
 * Queues write operations for sync on reconnect.
 */

import { supabase } from "@/lib/supabase";
import { readOfflineWorkspace } from "@/lib/auth-recovery";

export interface OfflineIdentity { user_id: string; workspace_id: string; }
export async function getOfflineIdentity(): Promise<OfflineIdentity> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  const workspace = user && (readOfflineWorkspace(user.id) || user.app_metadata?.workspace_id);
  if (!user?.id || typeof workspace !== "string" || !workspace.trim()) {
    throw new Error("Sign in to the correct workspace before accessing offline work.");
  }
  return { user_id: user.id, workspace_id: workspace };
}
/** Auth token is captured once for transport and never serialized to IndexedDB. */
export interface OfflineSubmissionContext extends OfflineIdentity { readonly accessToken: string }
export async function captureOfflineSubmissionContext(): Promise<Readonly<OfflineSubmissionContext>> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  const workspace = user && (readOfflineWorkspace(user.id) || user.app_metadata?.workspace_id);
  if (!user?.id || !session?.access_token || typeof workspace !== "string" || !workspace.trim()) {
    throw new Error("Sign in to the correct workspace before submitting offline work.");
  }
  return Object.freeze({ user_id: user.id, workspace_id: workspace, accessToken: session.access_token });
}
export function offlineDatabaseName(identity: OfflineIdentity): string {
  return `sales_companion:${encodeURIComponent(identity.user_id)}:${encodeURIComponent(identity.workspace_id)}`;
}
export async function assertOfflineIdentity(identity: OfflineIdentity): Promise<void> {
  const current = await getOfflineIdentity();
  if (current.user_id !== identity.user_id || current.workspace_id !== identity.workspace_id) {
    throw new Error("Account or workspace changed. Pending work remains with its original operator.");
  }
}
const DB_VERSION = 2;

export interface OfflineQueueItem {
  user_id?: string;
  workspace_id?: string;
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
  queued_at: string;
}

export type QueuedVoiceNoteStatus = "queued" | "syncing" | "failed";

export interface QueuedVoiceNote {
  user_id?: string;
  workspace_id?: string;
  id: string;
  audioBlob: Blob;
  mimeType: string;
  fileName: string;
  durationSeconds: number;
  dealId: string | null;
  dealLabel: string | null;
  queuedAt: string;
  status?: QueuedVoiceNoteStatus;
  lastError?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
}

async function openDB(identity?: OfflineIdentity): Promise<IDBDatabase> {
  const scope = identity ?? await getOfflineIdentity();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineDatabaseName(scope), DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("customers")) {
        db.createObjectStore("customers", { keyPath: "customer_id" });
      }
      if (!db.objectStoreNames.contains("pipeline")) {
        db.createObjectStore("pipeline", { keyPath: "deal_id" });
      }
      if (!db.objectStoreNames.contains("briefing")) {
        db.createObjectStore("briefing", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("offline_queue")) {
        db.createObjectStore("offline_queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("voice_note_queue")) {
        db.createObjectStore("voice_note_queue", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putAll<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);

  // Clear existing and add new
  store.clear();
  for (const item of items) {
    store.put(item);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getAll<T>(storeName: string, identity?: OfflineIdentity): Promise<T[]> {
  const db = await openDB(identity);
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      db.close();
      resolve(request.result as T[]);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

// Public API

export async function cacheCustomers<T>(customers: T[]): Promise<void> {
  await putAll("customers", customers);
}

export async function getCachedCustomers<T>(): Promise<T[]> {
  return getAll<T>("customers");
}

export async function cachePipeline<T>(deals: T[]): Promise<void> {
  await putAll("pipeline", deals);
}

export async function getCachedPipeline<T>(): Promise<T[]> {
  return getAll<T>("pipeline");
}

export async function cacheBriefing<T extends { id: string }>(briefing: T): Promise<void> {
  await putAll("briefing", [briefing]);
}

export async function getCachedBriefing<T>(): Promise<T | null> {
  const items = await getAll<T>("briefing");
  return items[0] ?? null;
}

// Offline queue

export async function enqueueOfflineAction(item: OfflineQueueItem): Promise<void> {
  const identity = await getOfflineIdentity();
  const db = await openDB(identity);
  const tx = db.transaction("offline_queue", "readwrite");
  tx.objectStore("offline_queue").put({ ...item, ...identity });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  return getAll<OfflineQueueItem>("offline_queue");
}

export async function clearSyncedActions(ids: string[], identity?: OfflineIdentity): Promise<void> {
  if (identity) await assertOfflineIdentity(identity);
  const db = await openDB(identity);
  const tx = db.transaction("offline_queue", "readwrite");
  const store = tx.objectStore("offline_queue");
  for (const id of ids) {
    store.delete(id);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function enqueueVoiceNote(item: QueuedVoiceNote, capturedIdentity?: OfflineIdentity): Promise<void> {
  const identity = capturedIdentity ?? await getOfflineIdentity();
  const db = await openDB(identity);
  const tx = db.transaction("voice_note_queue", "readwrite");
  tx.objectStore("voice_note_queue").put({ ...item, user_id: identity.user_id, workspace_id: identity.workspace_id });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getQueuedVoiceNotes(identity?: OfflineIdentity): Promise<QueuedVoiceNote[]> {
  return getAll<QueuedVoiceNote>("voice_note_queue", identity);
}

export async function updateQueuedVoiceNote(
  id: string,
  patch: Partial<QueuedVoiceNote>,
  capturedIdentity?: OfflineIdentity,
): Promise<void> {
  const identity = capturedIdentity ?? await getOfflineIdentity();
  const db = await openDB(identity);
  const tx = db.transaction("voice_note_queue", "readwrite");
  const store = tx.objectStore("voice_note_queue");
  const request = store.get(id);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const existing = request.result as QueuedVoiceNote | undefined;
      if (existing) {
        store.put({ ...existing, ...patch, id, user_id: identity.user_id, workspace_id: identity.workspace_id });
      }
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function removeQueuedVoiceNotes(ids: string[], capturedIdentity?: OfflineIdentity): Promise<void> {
  const db = await openDB(capturedIdentity);
  const tx = db.transaction("voice_note_queue", "readwrite");
  const store = tx.objectStore("voice_note_queue");
  for (const id of ids) {
    store.delete(id);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Preserve old unscoped data for supervised recovery; never read it into another operator's UI. */
export async function getLegacyOfflinePendingCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  const databases = await indexedDB.databases?.();
  if (!databases?.some((db) => db.name === "sales_companion")) return 0;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sales_companion");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const names = ["offline_queue", "voice_note_queue"].filter((name) => db.objectStoreNames.contains(name));
      if (!names.length) { db.close(); resolve(0); return; }
      const tx = db.transaction(names, "readonly");
      let count = 0;
      for (const name of names) {
        const result = tx.objectStore(name).count();
        result.onsuccess = () => { count += result.result; };
      }
      tx.oncomplete = () => { db.close(); resolve(count); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
