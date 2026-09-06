import { beforeEach, describe, expect, test } from "bun:test";
import { buildOfflineJobUpdateFields, buildOfflineSegmentLaborFields, createOfflineFieldStore } from "./service-offline-field-mode";
const { cacheOfflineJobSnapshot, drainOfflineFieldQueue, enqueueOfflineFieldAction, enqueueOfflineJobUpdate,
 getCachedOfflineJobSnapshot, getOfflineFieldQueue, listCachedOfflineJobSnapshots } = createOfflineFieldStore({ userId: "tech-1", workspaceId: "default" });
import type { ServiceJobWithRelations } from "./types";

const job = {
  id: "job-offline-1",
  workspace_id: "default",
  customer_id: "cust-1",
  contact_id: null,
  machine_id: "machine-1",
  source_type: "field_request",
  request_type: "field_service",
  priority: "high",
  current_stage: "in_progress",
  status_flags: ["field_job"],
  branch_id: "OCALA",
  advisor_id: null,
  service_manager_id: null,
  technician_id: "tech-1",
  requested_by_name: "Jordan Lane",
  customer_problem_summary: "Hydraulic leak",
  ai_diagnosis_summary: null,
  selected_job_code_id: null,
  haul_required: false,
  shop_or_field: "field",
  scheduled_start_at: null,
  scheduled_end_at: null,
  hour_meter_reading: 1420.5,
  complaint: "Leaking cylinder",
  cause: null,
  correction: null,
  quote_total: null,
  invoice_total: null,
  portal_request_id: null,
  fulfillment_run_id: null,
  tracking_token: "token",
  created_at: "2026-07-03T00:00:00.000Z",
  updated_at: "2026-07-03T00:00:00.000Z",
  closed_at: null,
  deleted_at: null,
  machine: {
    id: "machine-1",
    make: "Kubota",
    model: "KX080",
    serial_number: "KBTA-17",
    year: 2024,
  },
  segments: [
    {
      id: "segment-1",
      segment_number: 1,
      description: "Hydraulic leak",
      status: "open",
      technician_id: "tech-1",
      estimated_hours: 2,
      quoted_labor_hours: 2,
      hours_actual: null,
      diagnostic_signoff_status: "not_submitted",
      diagnostic_submitted_at: null,
      diagnostic_approved_at: null,
      repair_signoff_status: "not_started",
      repair_signed_off_at: null,
      labor_story: null,
      labor_story_complaint_verification: null,
      labor_story_diagnostic_steps: null,
      labor_story_root_cause: null,
      labor_story_parts_used: null,
      labor_story_work_performed: null,
      overrun_status: "not_evaluated",
      overrun_flagged_at: null,
      overrun_acknowledged_at: null,
      lockout_tagout_required: false,
      lockout_tagout_completed: false,
      warranty_parts_turn_in_required: false,
      warranty_parts_turn_in_completed: false,
      warranty_parts_label: null,
    },
  ],
} as ServiceJobWithRelations;

describe("service offline field mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("normalizes field packet inputs before queueing", () => {
    expect(buildOfflineJobUpdateFields({
      hourMeter: " 1442.6 ",
      complaint: " Leak under cab ",
      cause: " ",
      correction: "Replaced hose",
    })).toEqual({
      hour_meter_reading: 1442.6,
      complaint: "Leak under cab",
      cause: null,
      correction: "Replaced hose",
    });

    expect(buildOfflineSegmentLaborFields({
      hoursActual: "-1",
      complaint: "Verified complaint",
    })).toEqual({
      hours_actual: null,
      complaint: "Verified complaint",
      cause: null,
      correction: null,
    });
  });

  test("caches opened work orders for offline reopening", () => {
    cacheOfflineJobSnapshot(job);

    expect(getCachedOfflineJobSnapshot(job.id)?.job.machine?.serial_number).toBe("KBTA-17");
    expect(listCachedOfflineJobSnapshots().map((snapshot) => snapshot.job.id)).toEqual([job.id]);
  });

  test("queues only actionable packets and drains successful replay", async () => {
    const blank = await enqueueOfflineJobUpdate("job-1", {
      hour_meter_reading: null,
      complaint: null,
      cause: null,
      correction: null,
    });
    expect(blank).toBeNull();

    const queued = await enqueueOfflineFieldAction({
      kind: "segment_labor",
      jobId: "job-1",
      segmentId: "segment-1",
      fields: { hours_actual: 1.7 },
    });
    expect(queued?.kind).toBe("segment_labor");

    const replayed: string[] = [];
    const result = await drainOfflineFieldQueue(async (action) => {
      replayed.push(action.id);
    });

    expect(result).toEqual({ retried: 1, succeeded: 1, stillFailing: 0 });
    expect(replayed).toEqual([queued?.id]);
    expect(await getOfflineFieldQueue()).toEqual([]);
  });

  test("keeps failed replay items with attempt evidence", async () => {
    await enqueueOfflineFieldAction({
      kind: "job_update",
      jobId: "job-1",
      fields: { complaint: "No signal repair note" },
    });

    const result = await drainOfflineFieldQueue(async () => {
      throw new Error("network unavailable");
    });
    const queue = await getOfflineFieldQueue();

    expect(result).toEqual({ retried: 1, succeeded: 0, stillFailing: 1 });
    expect(queue).toHaveLength(1);
    expect(queue[0]?.attempts).toBe(1);
    expect(queue[0]?.lastError).toBe("network unavailable");
  });
});


describe("offline durability and operator separation", () => {
  test("retains more than 75 unsynced operations", async () => {
    for (let index = 0; index < 80; index++) await enqueueOfflineJobUpdate(`job-${index}`, { complaint: `note-${index}` });
    const queue = await getOfflineFieldQueue();
    expect(queue).toHaveLength(80);
    expect(queue[0].jobId).toBe("job-0");
  });
  test("concurrent captures do not overwrite one another", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => enqueueOfflineJobUpdate(`job-${index}`, { cause: "diagnosis" })));
    expect(await getOfflineFieldQueue()).toHaveLength(10);
  });
  test("another operator or workspace never receives cached jobs or queued writes", async () => {
    cacheOfflineJobSnapshot(job);
    await enqueueOfflineJobUpdate(job.id, { complaint: "private" });
    for (const scope of [{ userId: "tech-2", workspaceId: "default" }, { userId: "tech-1", workspaceId: "other" }]) {
      const other = createOfflineFieldStore(scope);
      expect(await other.getOfflineFieldQueue()).toEqual([]);
      expect(other.listCachedOfflineJobSnapshots()).toEqual([]);
    }
  });
  test("clock events retain identity and ordering through refresh", async () => {
    const store = createOfflineFieldStore({ userId: "tech-1", workspaceId: "default" });
    await store.enqueueOfflineFieldAction({ kind: "clock_start", jobId: job.id, sessionId: "session-1", occurredAt: "2026-09-06T10:00:00Z" });
    expect((await createOfflineFieldStore({ userId: "tech-1", workspaceId: "default" }).getActiveClock(job.id))?.sessionId).toBe("session-1");
    await store.enqueueOfflineFieldAction({ kind: "clock_stop", jobId: job.id, sessionId: "session-1", occurredAt: "2026-09-06T11:00:00Z" });
    expect(await store.getActiveClock(job.id)).toBeNull();
    expect((await store.getOfflineFieldQueue()).map(row => row.kind)).toEqual(["clock_start", "clock_stop"]);
  });
});

test("storage refusal preserves already queued work and rejects the new save", async () => {
  window.localStorage.clear();
  await enqueueOfflineJobUpdate("kept", { complaint: "Keep this" });
  const storage = window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.getItem(key),
    setItem: () => { throw new Error("QuotaExceededError"); },
  } });
  try {
    await expect(enqueueOfflineJobUpdate("not-saved", { complaint: "Too large" })).rejects.toThrow("QuotaExceededError");
    expect((await getOfflineFieldQueue()).map(row => row.jobId)).toEqual(["kept"]);
  } finally { if (descriptor) Object.defineProperty(window, "localStorage", descriptor); else Object.defineProperty(window, "localStorage", { configurable: true, value: storage }); }
});

test("corrupt scoped queues are retained rather than overwritten as empty", async () => {
  window.localStorage.clear();
  const key="qep_service_offline_field_queue_v1:default:tech-1";
  window.localStorage.setItem(key,"broken-json");
  await expect(enqueueOfflineJobUpdate("not-saved", { complaint: "New" })).rejects.toThrow("retained");
  expect(window.localStorage.getItem(key)).toBe("broken-json");
});

test("retrying a delivered older stop cannot erase the newer active clock", async () => {
  window.localStorage.clear();
  const scope={userId:"tech-1",workspaceId:"default"};const store=createOfflineFieldStore(scope);
  await store.enqueueOfflineFieldAction({kind:"clock_start",jobId:"job",sessionId:"S1",occurredAt:"2026-09-06T10:00:00Z"});
  await store.drainOfflineFieldQueue(async()=>({}));
  await store.enqueueOfflineFieldAction({kind:"clock_stop",jobId:"job",sessionId:"S1",occurredAt:"2026-09-06T11:00:00Z"});
  await store.enqueueOfflineFieldAction({kind:"clock_start",jobId:"job",sessionId:"S2",occurredAt:"2026-09-06T11:01:00Z"});
  const first=await store.drainOfflineFieldQueue(async action=>{if(action.kind==="clock_stop" && action.sessionId==="S1")throw new Error("server committed stop; response lost");return {};});
  expect(first).toEqual({retried:2,succeeded:1,stillFailing:1});
  const refreshed=createOfflineFieldStore(scope);expect((await refreshed.getActiveClock("job"))?.sessionId).toBe("S2");
  await refreshed.enqueueOfflineFieldAction({kind:"clock_stop",jobId:"job",sessionId:"S2",occurredAt:"2026-09-06T12:00:00Z"});
  const stops:string[]=[];await refreshed.drainOfflineFieldQueue(async action=>{if(action.kind==="clock_stop")stops.push(action.sessionId);return {};});
  expect(stops).toEqual(["S1","S2"]);expect(await refreshed.getActiveClock("job")).toBeNull();
});
