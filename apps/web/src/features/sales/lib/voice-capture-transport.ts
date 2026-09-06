import type { OfflineSubmissionContext } from "./offline-store";
import { assertVoiceCaptureReceipt, type VoiceCaptureReceipt } from "./queued-voice-sync";

export class VoiceCaptureRequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly payload: Record<string, unknown> = {}) {
    super(message); this.name = "VoiceCaptureRequestError";
  }
}
/** Never reacquire auth inside a recording's transport: that could attach A's audio to B. */
export async function postVoiceCapture(
  form: FormData,
  context: Readonly<OfflineSubmissionContext>,
  options: { url: string; apiKey: string; fetcher?: typeof fetch },
): Promise<VoiceCaptureReceipt & Record<string, unknown>> {
  form.set("expected_user_id", context.user_id);
  form.set("expected_workspace_id", context.workspace_id);
  const response = await (options.fetcher ?? fetch)(options.url, {
    method: "POST", headers: { Authorization: `Bearer ${context.accessToken}`, apikey: options.apiKey }, body: form,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Unknown error" })) as Record<string, unknown>;
    throw new VoiceCaptureRequestError(typeof payload.error === "string" ? payload.error : "Processing failed", response.status, payload);
  }
  const payload: unknown = await response.json();
  const queueId = form.get("client_queue_id");
  assertVoiceCaptureReceipt(payload, context, typeof queueId === "string" ? queueId : undefined);
  return payload as VoiceCaptureReceipt & Record<string, unknown>;
}
