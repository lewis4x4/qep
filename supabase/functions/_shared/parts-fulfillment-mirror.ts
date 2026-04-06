import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type MirrorResult =
  | { skipped: true }
  | { skipped: false; error?: string; duplicate?: boolean };

const IDEMPOTENCY_KEY_MAX = 200;

/** Trim and cap length for DB idempotency_key (partial unique index per workspace). */
export function normalizeFulfillmentEventIdempotencyKey(
  raw: string | undefined | null,
): string | undefined {
  if (raw == null) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  return t.length > IDEMPOTENCY_KEY_MAX ? t.slice(0, IDEMPOTENCY_KEY_MAX) : t;
}

/**
 * When `service_jobs.fulfillment_run_id` is set, append an event to
 * `parts_fulfillment_events` for run-level audit. No-op if unlinked or workspace mismatch.
 *
 * `auditChannel` is stored as `payload.audit_channel` for operator UI (shop | vendor | system).
 *
 * When `idempotencyKey` is set, a second insert with the same key in the same workspace
 * is skipped (duplicate=true) so webhook retries do not duplicate audit rows.
 */
export async function mirrorToFulfillmentRun(
  supabase: SupabaseClient,
  params: {
    jobId: string;
    workspaceId: string;
    eventType: string;
    payload: Record<string, unknown>;
    auditChannel?: "shop" | "vendor" | "system";
    idempotencyKey?: string | null;
  },
): Promise<MirrorResult> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select("fulfillment_run_id, workspace_id")
    .eq("id", params.jobId)
    .maybeSingle();

  if (error || !data) return { skipped: true };

  const job = data as {
    fulfillment_run_id: string | null;
    workspace_id: string;
  };

  if (String(job.workspace_id) !== params.workspaceId) return { skipped: true };

  const runId = job.fulfillment_run_id;
  if (!runId) return { skipped: true };

  const channel =
    (typeof params.payload.audit_channel === "string"
      ? params.payload.audit_channel
      : undefined) ??
    params.auditChannel ??
    "shop";

  const idempotencyKey = normalizeFulfillmentEventIdempotencyKey(
    params.idempotencyKey ?? undefined,
  );

  const row: Record<string, unknown> = {
    workspace_id: params.workspaceId,
    fulfillment_run_id: runId,
    event_type: params.eventType,
    payload: {
      ...params.payload,
      service_job_id: params.jobId,
      audit_channel: channel,
    },
  };
  if (idempotencyKey) row.idempotency_key = idempotencyKey;

  const { error: insErr } = await supabase.from("parts_fulfillment_events").insert(row);

  if (insErr) {
    if (String(insErr.code) === "23505") {
      return { skipped: false, duplicate: true };
    }
    console.warn("parts-fulfillment-mirror insert:", insErr.message);
    return { skipped: false, error: insErr.message };
  }
  return { skipped: false };
}
