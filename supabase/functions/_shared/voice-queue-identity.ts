/** Queued audio identity is a binding check against verified auth, never an authorization claim. */
export function queuedVoiceIdentityError(form: FormData, actorId: string, workspaceId: string): string | null {
  const expectedUser = form.get("expected_user_id");
  const expectedWorkspace = form.get("expected_workspace_id");
  const queued = form.has("client_queue_id");
  if (!queued && expectedUser == null && expectedWorkspace == null) return null; // existing non-queue clients
  if (expectedUser !== actorId || expectedWorkspace !== workspaceId) {
    return "Recording belongs to a different operator or workspace. Return to the original account to retry.";
  }
  if (queued && (typeof form.get("client_queue_id") !== "string" || !String(form.get("client_queue_id")).trim())) {
    return "Queued capture id is required.";
  }
  return null;
}
export async function queuedVoiceCaptureId(actorId: string, workspaceId: string, queueId: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([actorId, workspaceId, queueId]))));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function queuedVoiceSavedResponse(row: Record<string, unknown>, actorId: string, workspaceId: string, queueId?: string): Record<string, unknown> | null {
  if (row.user_id !== actorId || row.workspace_id !== workspaceId) return null;
  if (!["pending", "synced"].includes(String(row.sync_status)) || typeof row.transcript !== "string" || !row.transcript.trim()) return null;
  return {
    id: row.id, client_queue_id: queueId ?? null, capture_saved: true, captured_user_id: actorId, captured_workspace_id: workspaceId,
    transcript: row.transcript, duration_seconds: row.duration_seconds ?? null,
    extracted_data: row.extracted_data ?? {}, hubspot_synced: Boolean(row.hubspot_synced_at),
    hubspot_deal_id: row.hubspot_deal_id ?? null, hubspot_note_id: row.hubspot_note_id ?? null,
    hubspot_task_id: row.hubspot_task_id ?? null, local_crm_saved: Boolean(row.qrm_activity_id),
    qrm_activity_id: row.qrm_activity_id ?? null, local_crm_note_id: row.qrm_activity_id ?? null,
    summary_bullets: row.summary_bullets ?? null, reconciled: true,
  };
}
