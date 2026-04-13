/**
 * Offline Store — IndexedDB cache for Sales Companion
 *
 * Caches customer roster, pipeline deals, and today's briefing for offline reads.
 * Queues write operations for sync on reconnect.
 */

const DB_NAME = "sales_companion";
const DB_VERSION = 1;

interface OfflineQueueItem {
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
  queued_at: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
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
  const db = await openDB();
  const tx = db.transaction("offline_queue", "readwrite");
  tx.objectStore("offline_queue").put(item);

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

export async function clearSyncedActions(ids: string[]): Promise<void> {
  const db = await openDB();
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
