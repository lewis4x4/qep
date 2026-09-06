import type { ServiceJobWithRelations } from "./types";

const SNAPSHOT_PREFIX = "qep_service_offline_job:";
const QUEUE_KEY = "qep_service_offline_field_queue_v1";
export type OfflineFieldScope = { userId: string; workspaceId: string };
const queueWrites = new Map<string, Promise<void>>();
const queueDrains = new Map<string, Promise<{ retried: number; succeeded: number; stillFailing: number }>>();

type OfflineFieldBaseAction = {
  id: string;
  jobId: string;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
  ownerId: string;
  ownerWorkspaceId: string;
};

export type OfflineJobUpdateFields = {
  hour_meter_reading?: number | null;
  complaint?: string | null;
  cause?: string | null;
  correction?: string | null;
};

export type OfflineSegmentLaborFields = {
  hours_actual?: number | null;
  complaint?: string | null;
  cause?: string | null;
  correction?: string | null;
};

export type OfflineFieldAction =
  | (OfflineFieldBaseAction & { kind: "clock_start" | "clock_stop"; sessionId: string; occurredAt: string; segmentId?: string | null })
  | (OfflineFieldBaseAction & {
      kind: "job_update";
      fields: OfflineJobUpdateFields;
      base?: OfflineJobUpdateFields;
    })
  | (OfflineFieldBaseAction & {
      kind: "segment_labor";
      segmentId: string;
      fields: OfflineSegmentLaborFields;
    })
  | (OfflineFieldBaseAction & {
      kind: "segment_photo";
      workspaceId: string;
      serviceJobId: string;
      segmentId: string;
      phase: "before" | "during" | "after";
      category: string;
      caption?: string;
      fileName: string;
      fileType: string;
      fileDataUrl: string;
    });

export type OfflineFieldActionInput =
  | { kind: "clock_start" | "clock_stop"; jobId: string; sessionId: string; occurredAt: string; segmentId?: string | null }
  | {
      kind: "job_update";
      jobId: string;
      fields: OfflineJobUpdateFields;
      base?: OfflineJobUpdateFields;
    }
  | {
      kind: "segment_labor";
      jobId: string;
      segmentId: string;
      fields: OfflineSegmentLaborFields;
    }
  | {
      kind: "segment_photo";
      jobId: string;
      workspaceId: string;
      serviceJobId: string;
      segmentId: string;
      phase: "before" | "during" | "after";
      category: string;
      caption?: string;
      fileName: string;
      fileType: string;
      fileDataUrl: string;
    };

export type OfflineJobSnapshot = {
  job: ServiceJobWithRelations;
  cachedAt: string;
  history?: ServiceJobWithRelations[];
};


function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) && next >= 0 ? next : null;
}

function hasPayloadFields(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some((value) => value !== null && value !== undefined && value !== "");
}

export function buildOfflineJobUpdateFields(input: {
  hourMeter?: string | number | null;
  complaint?: string | null;
  cause?: string | null;
  correction?: string | null;
}): OfflineJobUpdateFields {
  return {
    hour_meter_reading: normalizeOptionalNumber(input.hourMeter),
    complaint: normalizeOptionalText(input.complaint),
    cause: normalizeOptionalText(input.cause),
    correction: normalizeOptionalText(input.correction),
  };
}

export function buildOfflineSegmentLaborFields(input: {
  hoursActual?: string | number | null;
  complaint?: string | null;
  cause?: string | null;
  correction?: string | null;
}): OfflineSegmentLaborFields {
  return {
    hours_actual: normalizeOptionalNumber(input.hoursActual),
    complaint: normalizeOptionalText(input.complaint),
    cause: normalizeOptionalText(input.cause),
    correction: normalizeOptionalText(input.correction),
  };
}


export function hasLegacyOfflineFieldWork(): boolean {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return !!raw && raw !== "[]";
  } catch { return false; }
}

/** Legacy unscoped records are retained, never silently adopted by a different operator. */
export function createOfflineFieldStore(scope: OfflineFieldScope) {
  const identity = `${encodeURIComponent(scope.workspaceId)}:${encodeURIComponent(scope.userId)}`;
  const snapshotPrefix = `${SNAPSHOT_PREFIX}${identity}:`;
  const queueKey = `${QUEUE_KEY}:${identity}`;
  function assertScope() {
    if (!scope.userId || !scope.workspaceId) throw new Error("Sign in to a workspace before using offline storage");
  }
  async function mutateQueue(mutate: (items: OfflineFieldAction[]) => OfflineFieldAction[]) {
    const previous = queueWrites.get(queueKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      assertScope();
      const change = async () => { await writeOfflineFieldQueue(mutate(await getOfflineFieldQueue())); };
      if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request(queueKey, change);
      else await change();
    });
    queueWrites.set(queueKey, next);
    try { await next; } finally { if (queueWrites.get(queueKey) === next) queueWrites.delete(queueKey); }
  }
function getStorage(): Storage | null {
  if (!scope.userId || !scope.workspaceId) return null;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const storage = getStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  const storage = getStorage();
  if (!storage) throw new Error("Offline storage unavailable; this work has not been saved.");
  storage.setItem(key, JSON.stringify(value));
}

function nextActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function snapshotKey(jobId: string): string {
  return `${snapshotPrefix}${jobId}`;
}

function cacheOfflineJobSnapshot(job: ServiceJobWithRelations, history?: ServiceJobWithRelations[]): void {
  if (job.workspace_id !== scope.workspaceId) throw new Error("Offline cache workspace mismatch");
  writeJson<OfflineJobSnapshot>(snapshotKey(job.id), {
    job,
    history: history ?? getCachedOfflineJobSnapshot(job.id)?.history,
    cachedAt: new Date().toISOString(),
  });
}

function getCachedOfflineJobSnapshot(jobId: string): OfflineJobSnapshot | null {
  return readJson<OfflineJobSnapshot | null>(snapshotKey(jobId), null);
}

function listCachedOfflineJobSnapshots(): OfflineJobSnapshot[] {
  const storage = getStorage();
  if (!storage) return [];
  const snapshots: OfflineJobSnapshot[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(snapshotPrefix)) continue;
    const snapshot = readJson<OfflineJobSnapshot | null>(key, null);
    if (snapshot?.job?.id) snapshots.push(snapshot);
  }
  return snapshots.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
}

async function queueDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("qep_service_field", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("queues")) request.result.createObjectStore("queues"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Offline database could not open. Existing work is retained."));
  });
}
async function readQueue(): Promise<string | null> {
  const database = await queueDatabase();
  if (!database) return getStorage()?.getItem(queueKey) ?? null;
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("queues", "readonly").objectStore("queues").get(queueKey);
      request.onsuccess = () => resolve(request.result ?? getStorage()?.getItem(queueKey) ?? null);
      request.onerror = () => reject(new Error("Offline queue read failed; work was retained."));
    });
  } finally { database.close(); }
}
async function persistQueue(raw: string): Promise<void> {
  const database = await queueDatabase();
  if (!database) { writeJson(queueKey, JSON.parse(raw)); return; }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("queues", "readwrite");
      tx.objectStore("queues").put(raw, queueKey);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("Offline storage is full or unavailable. The packet was not saved; keep the form open and retry."));
    });
  } finally { database.close(); }
}
type ClockState = { sessionId: string; occurredAt: string; segmentId?: string | null };
type QueueDocument = { actions: OfflineFieldAction[]; clocks: Record<string, ClockState> };
async function readQueueDocument(): Promise<QueueDocument> {
  if (!scope.userId || !scope.workspaceId) return { actions: [], clocks: {} };
  const raw = await readQueue();
  if (!raw) return { actions: [], clocks: {} };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Offline queue could not be read. Existing work was retained; contact support before saving more."); }
  const document = Array.isArray(parsed) ? { actions: parsed, clocks: {} } : parsed as QueueDocument;
  if (!document || !Array.isArray(document.actions) || document.actions.some(action => !action || action.ownerId !== scope.userId || action.ownerWorkspaceId !== scope.workspaceId)) {
    throw new Error("Offline queue identity is inconsistent. Existing work was retained for review.");
  }
  // Only legacy array documents need reconstruction. A saved capture state is independent of delivery retries.
  const clocks = { ...(document.clocks ?? {}) };
  for (const action of Array.isArray(parsed) ? document.actions : []) {
    if (action.kind === "clock_start") clocks[action.jobId] = { sessionId: action.sessionId, occurredAt: action.occurredAt, segmentId: action.segmentId };
    if (action.kind === "clock_stop" && clocks[action.jobId]?.sessionId === action.sessionId) delete clocks[action.jobId];
  }
  return { actions: document.actions, clocks };
}
async function getOfflineFieldQueue(): Promise<OfflineFieldAction[]> { return (await readQueueDocument()).actions; }
async function writeOfflineFieldQueue(actions: OfflineFieldAction[]): Promise<void> {
  assertScope();
  const previous = await readQueueDocument();
  const clocks = { ...previous.clocks };
  const previousIds = new Set(previous.actions.map(action => action.id));
  // Apply only newly captured actions, never failed-delivery history during queue rewrites.
  for (const action of actions.filter(action => !previousIds.has(action.id))) {
    if (action.kind === "clock_start") clocks[action.jobId] = { sessionId: action.sessionId, occurredAt: action.occurredAt, segmentId: action.segmentId };
    if (action.kind === "clock_stop" && clocks[action.jobId]?.sessionId === action.sessionId) delete clocks[action.jobId];
  }
  // Actions and the active clock are committed by the same IndexedDB transaction.
  await persistQueue(JSON.stringify({ actions, clocks }));
}

async function enqueueOfflineFieldAction(
  action: OfflineFieldActionInput,
): Promise<OfflineFieldAction | null> {
  if (
    (action.kind === "job_update" && !hasPayloadFields(action.fields)) ||
    (action.kind === "segment_labor" && !hasPayloadFields(action.fields))
  ) {
    return null;
  }

  const queued = {
    ...action,
    ownerId: scope.userId,
    ownerWorkspaceId: scope.workspaceId,
    id: nextActionId(),
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  } as OfflineFieldAction;

  await mutateQueue(existing => [...existing, queued]);
  return queued;
}

async function removeOfflineFieldAction(actionId: string): Promise<void> {
  await mutateQueue(existing => existing.filter((action) => action.id !== actionId));
}

async function markOfflineFieldActionFailed(actionId: string, error: string): Promise<void> {
  await mutateQueue(existing => existing.map((action) =>
    action.id === actionId
      ? { ...action, attempts: action.attempts + 1, lastError: error }
      : action,
  ));
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Photo read failed"));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(
  dataUrl: string,
  fileName: string,
  fileType: string,
): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: fileType || blob.type || "application/octet-stream" });
}

async function enqueueOfflineJobUpdate(
  jobId: string,
  fields: OfflineJobUpdateFields,
  base?: OfflineJobUpdateFields,
): Promise<OfflineFieldAction | null> {
  return enqueueOfflineFieldAction({
    kind: "job_update",
    jobId,
    fields,
    base,
  });
}

async function enqueueOfflineSegmentLabor(
  jobId: string,
  segmentId: string,
  fields: OfflineSegmentLaborFields,
): Promise<OfflineFieldAction | null> {
  return enqueueOfflineFieldAction({
    kind: "segment_labor",
    jobId,
    segmentId,
    fields,
  });
}

async function enqueueOfflineSegmentPhoto(payload: {
  workspaceId: string;
  serviceJobId: string;
  segmentId: string;
  phase: "before" | "during" | "after";
  category: string;
  caption?: string;
  file: File;
}): Promise<OfflineFieldAction | null> {
  const fileDataUrl = await fileToDataUrl(payload.file);
  return enqueueOfflineFieldAction({
    kind: "segment_photo",
    jobId: payload.serviceJobId,
    workspaceId: payload.workspaceId,
    serviceJobId: payload.serviceJobId,
    segmentId: payload.segmentId,
    phase: payload.phase,
    category: payload.category,
    caption: normalizeOptionalText(payload.caption) ?? undefined,
    fileName: payload.file.name || "field-photo.jpg",
    fileType: payload.file.type || "image/jpeg",
    fileDataUrl,
  });
}

async function replayOfflineFieldAction(action: OfflineFieldAction): Promise<unknown> {
  const {
    recordServiceFieldPacket,
    uploadAndRecordSegmentPhoto,
  } = await import("./api");

  if (action.ownerId !== scope.userId || action.ownerWorkspaceId !== scope.workspaceId) throw new Error("Offline operation belongs to another operator");
  if (action.kind === "job_update") {
    return recordServiceFieldPacket(action.id, action.jobId, { kind: action.kind, fields: action.fields, base: action.base, captured_by: scope.userId, captured_workspace_id: scope.workspaceId });
  }
  if (action.kind === "clock_start" || action.kind === "clock_stop") {
    return recordServiceFieldPacket(action.id, action.jobId, { kind: action.kind, session_id: action.sessionId, occurred_at: action.occurredAt, segment_id: action.segmentId, captured_by: scope.userId, captured_workspace_id: scope.workspaceId });
  }

  if (action.kind === "segment_labor") {
    throw new Error("Legacy manual labor packet requires supervisor review; clock events are now authoritative.");

  }

  if (action.kind !== "segment_photo") throw new Error("Unknown offline field operation");
  const file = await dataUrlToFile(action.fileDataUrl, action.fileName, action.fileType);
  return uploadAndRecordSegmentPhoto({
    operation_id: action.id,
    captured_by: scope.userId,
    captured_workspace_id: scope.workspaceId,
    workspace_id: action.workspaceId,
    service_job_id: action.serviceJobId,
    segment_id: action.segmentId,
    phase: action.phase,
    category: action.category,
    caption: action.caption,
    file,
  });
}

async function runOfflineFieldQueue(
  replayAction: (action: OfflineFieldAction) => Promise<unknown> = replayOfflineFieldAction,
): Promise<{ retried: number; succeeded: number; stillFailing: number }> {
  const pending = (await getOfflineFieldQueue()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  let succeeded = 0;
  let stillFailing = 0;

  for (const action of pending) {
    try {
      await replayAction(action);
      await removeOfflineFieldAction(action.id);
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "offline replay failed";
      await markOfflineFieldActionFailed(action.id, message);
      stillFailing += 1;
    }
  }

  return { retried: pending.length, succeeded, stillFailing };
}

function drainOfflineFieldQueue(replayAction: (action: OfflineFieldAction) => Promise<unknown> = replayOfflineFieldAction) {
  const active = queueDrains.get(queueKey);
  if (active) return active;
  const next = runOfflineFieldQueue(replayAction).finally(() => { if (queueDrains.get(queueKey) === next) queueDrains.delete(queueKey); });
  queueDrains.set(queueKey, next);
  return next;
}
async function getActiveClock(jobId: string): Promise<ClockState | null> {
  return (await readQueueDocument()).clocks[jobId] ?? null;
}
return { getActiveClock, cacheOfflineJobSnapshot, getCachedOfflineJobSnapshot, listCachedOfflineJobSnapshots, getOfflineFieldQueue,
 enqueueOfflineFieldAction, enqueueOfflineJobUpdate, enqueueOfflineSegmentLabor, enqueueOfflineSegmentPhoto,
 drainOfflineFieldQueue, removeOfflineFieldAction, markOfflineFieldActionFailed, replayOfflineFieldAction };
}
