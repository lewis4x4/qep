import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { queuedVoiceCaptureId, queuedVoiceIdentityError, queuedVoiceSavedResponse } from "./voice-queue-identity.ts";
Deno.test("queued audio cannot use another authenticated actor or workspace", () => {
  const form = new FormData(); form.set("client_queue_id", "queue-1"); form.set("expected_user_id", "a"); form.set("expected_workspace_id", "one");
  assertEquals(queuedVoiceIdentityError(form, "a", "one"), null);
  assertNotEquals(queuedVoiceIdentityError(form, "b", "one"), null);
  assertNotEquals(queuedVoiceIdentityError(form, "a", "two"), null);
  form.delete("expected_user_id"); assertNotEquals(queuedVoiceIdentityError(form, "a", "one"), null);
});
Deno.test("queue retry id is stable only within its actor and workspace", async () => {
  const id = await queuedVoiceCaptureId("a", "one", "queue-1");
  assertEquals(id, await queuedVoiceCaptureId("a", "one", "queue-1"));
  assertNotEquals(id, await queuedVoiceCaptureId("b", "one", "queue-1"));
  assertNotEquals(id, await queuedVoiceCaptureId("a", "two", "queue-1"));
});
Deno.test("only a persisted matching capture can acknowledge a queued recording", () => {
  const row = { id: "capture", user_id: "a", workspace_id: "one", transcript: "Work complete", sync_status: "synced", qrm_activity_id: "activity" };
  assertEquals(queuedVoiceSavedResponse(row, "a", "one")?.capture_saved, true);
  assertEquals(queuedVoiceSavedResponse(row, "b", "one"), null);
  assertEquals(queuedVoiceSavedResponse({ ...row, sync_status: "processing" }, "a", "one"), null);
  assertEquals(queuedVoiceSavedResponse({ ...row, transcript: "" }, "a", "one"), null);
});
