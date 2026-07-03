import type { ServiceJobWithRelations } from "./types";

const SNAPSHOT_PREFIX = "qep_service_offline_job:";
const QUEUE_KEY = "qep_service_offline_field_queue_v1";
const MAX_QUEUE_SIZE = 75;

type OfflineFieldBaseAction = {
  id: string;
  jobId: string;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
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
  | (OfflineFieldBaseAction & {
      kind: "job_update";
      fields: OfflineJobUpdateFields;
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
  | {
      kind: "job_update";
      jobId: string;
      fields: OfflineJobUpdateFields;
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
};

function getStorage(): Storage | null {
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
  if (!storage) return;
  storage.setItem(key, JSON.stringify(value));
}

function nextActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function snapshotKey(jobId: string): string {
  return `${SNAPSHOT_PREFIX}${jobId}`;
}

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

export function cacheOfflineJobSnapshot(job: ServiceJobWithRelations): void {
  writeJson<OfflineJobSnapshot>(snapshotKey(job.id), {
    job,
    cachedAt: new Date().toISOString(),
  });
}

export function getCachedOfflineJobSnapshot(jobId: string): OfflineJobSnapshot | null {
  return readJson<OfflineJobSnapshot | null>(snapshotKey(jobId), null);
}

export function listCachedOfflineJobSnapshots(): OfflineJobSnapshot[] {
  const storage = getStorage();
  if (!storage) return [];
  const snapshots: OfflineJobSnapshot[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(SNAPSHOT_PREFIX)) continue;
    const snapshot = readJson<OfflineJobSnapshot | null>(key, null);
    if (snapshot?.job?.id) snapshots.push(snapshot);
  }
  return snapshots.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
}

export async function getOfflineFieldQueue(): Promise<OfflineFieldAction[]> {
  return readJson<OfflineFieldAction[]>(QUEUE_KEY, []);
}

async function writeOfflineFieldQueue(actions: OfflineFieldAction[]): Promise<void> {
  writeJson(QUEUE_KEY, actions.slice(-MAX_QUEUE_SIZE));
}

export async function enqueueOfflineFieldAction(
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
    id: nextActionId(),
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  } as OfflineFieldAction;

  const existing = await getOfflineFieldQueue();
  await writeOfflineFieldQueue([...existing, queued]);
  return queued;
}

export async function removeOfflineFieldAction(actionId: string): Promise<void> {
  const existing = await getOfflineFieldQueue();
  await writeOfflineFieldQueue(existing.filter((action) => action.id !== actionId));
}

export async function markOfflineFieldActionFailed(actionId: string, error: string): Promise<void> {
  const existing = await getOfflineFieldQueue();
  await writeOfflineFieldQueue(existing.map((action) =>
    action.id === actionId
      ? { ...action, attempts: action.attempts + 1, lastError: error }
      : action,
  ));
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Photo read failed"));
    reader.readAsDataURL(file);
  });
}

export async function dataUrlToFile(
  dataUrl: string,
  fileName: string,
  fileType: string,
): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: fileType || blob.type || "application/octet-stream" });
}

export async function enqueueOfflineJobUpdate(
  jobId: string,
  fields: OfflineJobUpdateFields,
): Promise<OfflineFieldAction | null> {
  return enqueueOfflineFieldAction({
    kind: "job_update",
    jobId,
    fields,
  });
}

export async function enqueueOfflineSegmentLabor(
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

export async function enqueueOfflineSegmentPhoto(payload: {
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

export async function replayOfflineFieldAction(action: OfflineFieldAction): Promise<unknown> {
  const {
    updateServiceJob,
    recordSegmentLabor,
    uploadAndRecordSegmentPhoto,
  } = await import("./api");

  if (action.kind === "job_update") {
    return updateServiceJob(action.jobId, action.fields);
  }

  if (action.kind === "segment_labor") {
    const fields = Object.fromEntries(
      Object.entries(action.fields).filter(([, value]) => value !== null && value !== undefined),
    ) as {
      hours_actual?: number;
      complaint?: string;
      cause?: string;
      correction?: string;
    };
    return recordSegmentLabor({
      segment_id: action.segmentId,
      ...fields,
    });
  }

  const file = await dataUrlToFile(action.fileDataUrl, action.fileName, action.fileType);
  return uploadAndRecordSegmentPhoto({
    workspace_id: action.workspaceId,
    service_job_id: action.serviceJobId,
    segment_id: action.segmentId,
    phase: action.phase,
    category: action.category,
    caption: action.caption,
    file,
  });
}

export async function drainOfflineFieldQueue(
  replayAction: (action: OfflineFieldAction) => Promise<unknown> = replayOfflineFieldAction,
): Promise<{ retried: number; succeeded: number; stillFailing: number }> {
  const pending = await getOfflineFieldQueue();
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
