/**
 * Wave 6.11 Flare — IndexedDB submission queue.
 *
 * If a submission fails mid-flight (network drop, 3G timeout, browser
 * crash, tab close), the payload is persisted to IndexedDB and retried
 * on the next page load. This closes the gap from the spec ("must survive
 * offline + 3G + modal-open state") that the bare fetch() in flareClient
 * couldn't cover.
 *
 * DB shape:
 *   db: flare_pending_submissions (v1)
 *   store: queue (keyPath: id, autoIncrement: true)
 *   record: { id, payload, attempts, lastError, queuedAt }
 *
 * Capacity: 50 entries. Older entries are dropped on overflow.
 * Retry policy: on next page load, attempt every queued submission once.
 *               If still failing, leave in queue for next session.
 */

const DB_NAME = "flare_pending_submissions";
const DB_VERSION = 1;
const STORE_NAME = "queue";
const MAX_QUEUE_SIZE = 50;

interface QueueRecord<T> {
  id?: number;
  payload: T;
  attempts: number;
  lastError: string | null;
  queuedAt: number;
}

function isAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persist a payload to the queue. Drops oldest if at capacity.
 */
export async function enqueueSubmission<T>(payload: T, lastError: string): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      // Drop oldest if at capacity
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result >= MAX_QUEUE_SIZE) {
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) cursor.delete();
          };
        }
        const record: QueueRecord<T> = {
          payload,
          attempts: 0,
          lastError,
          queuedAt: Date.now(),
        };
        store.add(record);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    // Swallow — the queue is best-effort. The user already saw the error
    // toast from the original submission.
    // eslint-disable-next-line no-console
    console.warn("[flare] enqueueSubmission failed:", err);
  }
}

/**
 * Get all queued records (in insertion order).
 */
export async function getPendingSubmissions<T>(): Promise<Array<QueueRecord<T> & { id: number }>> {
  if (!isAvailable()) return [];
  try {
    const db = await openDb();
    const records = await new Promise<Array<QueueRecord<T> & { id: number }>>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as Array<QueueRecord<T> & { id: number }>);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[flare] getPendingSubmissions failed:", err);
    return [];
  }
}

/**
 * Remove a successfully-submitted record from the queue.
 */
export async function removeSubmission(id: number): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[flare] removeSubmission failed:", err);
  }
}

/**
 * Increment the attempt count + update lastError on a record that failed
 * on retry. Used to leave it in the queue for next session.
 */
export async function markSubmissionFailed(id: number, error: string): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as QueueRecord<unknown> | undefined;
        if (record) {
          record.attempts = (record.attempts ?? 0) + 1;
          record.lastError = error;
          store.put(record);
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[flare] markSubmissionFailed failed:", err);
  }
}

/**
 * Drain the queue by retrying every pending submission. Called once on
 * FlareProvider mount. Each successful retry removes its record;
 * each failure increments attempts and stays for next session.
 */
export async function drainPendingSubmissions<T>(
  submitFn: (payload: T) => Promise<unknown>,
): Promise<{ retried: number; succeeded: number; stillFailing: number }> {
  if (!isAvailable()) return { retried: 0, succeeded: 0, stillFailing: 0 };

  const pending = await getPendingSubmissions<T>();
  if (pending.length === 0) return { retried: 0, succeeded: 0, stillFailing: 0 };

  let succeeded = 0;
  let stillFailing = 0;

  for (const record of pending) {
    try {
      await submitFn(record.payload);
      await removeSubmission(record.id);
      succeeded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "retry failed";
      await markSubmissionFailed(record.id, msg);
      stillFailing += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[flare] drain complete: ${succeeded} succeeded, ${stillFailing} still failing`);
  return { retried: pending.length, succeeded, stillFailing };
}
