import type { OfflineIdentity, OfflineSubmissionContext, QueuedVoiceNote } from "./offline-store";

export interface VoiceCaptureReceipt {
  id: string;
  capture_saved: boolean;
  captured_user_id: string;
  captured_workspace_id: string;
  client_queue_id?: string | null;
}
export function assertVoiceCaptureReceipt(receipt: unknown, identity: OfflineIdentity, queueId?: string): asserts receipt is VoiceCaptureReceipt {
  const row = receipt as Partial<VoiceCaptureReceipt> | null;
  if (typeof row?.id !== "string" || !row.id.trim() || row.capture_saved !== true || row.captured_user_id !== identity.user_id || row.captured_workspace_id !== identity.workspace_id || (queueId != null && row.client_queue_id !== queueId)) {
    throw new Error("The original operator's saved capture was not confirmed. Recording remains on this device for retry.");
  }
}
export interface VoiceQueueSyncDependencies {
  list: (identity: OfflineIdentity) => Promise<QueuedVoiceNote[]>;
  update: (id: string, patch: Partial<QueuedVoiceNote>, identity: OfflineIdentity) => Promise<void>;
  remove: (ids: string[], identity: OfflineIdentity) => Promise<void>;
  assertCurrent: (identity: OfflineIdentity) => Promise<void>;
  submit: (note: QueuedVoiceNote, context: Readonly<OfflineSubmissionContext>) => Promise<unknown>;
  progress?: () => Promise<void>;
  shouldStop: (error: unknown) => boolean;
}
/** One immutable transport + storage identity for the entire batch, including reconciliation after a switch. */
export async function syncCapturedVoiceQueue(context: Readonly<OfflineSubmissionContext>, deps: VoiceQueueSyncDependencies) {
  const notes = await deps.list(context);
  let synced = 0, failed = 0;
  for (const note of notes.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
    const attemptCount = (note.attemptCount ?? 0) + 1;
    const lastAttemptAt = new Date().toISOString();
    try {
      await deps.assertCurrent(context);
      if ((note.user_id && note.user_id !== context.user_id) || (note.workspace_id && note.workspace_id !== context.workspace_id)) {
        throw new Error("Queued recording identity does not match its operator workspace.");
      }
      await deps.update(note.id, { status: "syncing", lastError: null, attemptCount, lastAttemptAt }, context);
      await deps.progress?.();
      await deps.assertCurrent(context);
      const receipt = await deps.submit(note, context);
      assertVoiceCaptureReceipt(receipt, context, note.id);
      // A confirmed A upload only removes A's queue entry, even if B signed in while transport was pending.
      await deps.remove([note.id], context);
      synced += 1;
      await deps.progress?.();
    } catch (error) {
      failed += 1;
      await deps.update(note.id, { status: "failed", lastError: error instanceof Error ? error.message : "Capture sync failed", attemptCount, lastAttemptAt }, context);
      await deps.progress?.();
      let current = true;
      try { await deps.assertCurrent(context); } catch { current = false; }
      if (!current || deps.shouldStop(error)) break;
    }
  }
  return { total: notes.length, synced, failed };
}
