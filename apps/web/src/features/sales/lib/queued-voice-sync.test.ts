import { expect, test } from "bun:test";
import { syncCapturedVoiceQueue, type VoiceQueueSyncDependencies } from "./queued-voice-sync";
import { postVoiceCapture } from "./voice-capture-transport";
import type { OfflineIdentity, QueuedVoiceNote } from "./offline-store";
const context = Object.freeze({ user_id: "operator-a", workspace_id: "workspace-a", accessToken: "token-a" });
function fixture() {
  let active = "operator-a";
  const updates: OfflineIdentity[] = [], removals: OfflineIdentity[] = [], requests: RequestInit[] = [];
  const note: QueuedVoiceNote = { id: "queue-a", user_id: context.user_id, workspace_id: context.workspace_id, audioBlob: new Blob(["A private audio"]), mimeType: "audio/webm", fileName: "a.webm", durationSeconds: 1, dealId: null, dealLabel: null, queuedAt: "2026-09-01" };
  const receipt = { id: "capture-a", client_queue_id: note.id, capture_saved: true, captured_user_id: context.user_id, captured_workspace_id: context.workspace_id };
  const deps: VoiceQueueSyncDependencies = {
    list: async (identity) => { expect(identity.user_id).toBe("operator-a"); return [note]; },
    update: async (_id, _patch, identity) => { updates.push(identity); },
    remove: async (_ids, identity) => { removals.push(identity); },
    assertCurrent: async (identity) => { if (active !== identity.user_id) throw new Error("Account changed"); },
    submit: async (item, captured) => {
      const form = new FormData(); form.set("audio", item.audioBlob); form.set("client_queue_id", item.id);
      return postVoiceCapture(form, captured, { url: "https://capture-test.invalid", apiKey: "test", fetcher: async (_url, init) => {
        requests.push(init!); return Response.json(receipt);
      } });
    },
    shouldStop: () => false,
  };
  return { deps, receipt, updates, removals, requests, switchActor: () => { active = "operator-b"; } };
}
test("switch between preflight and upload never reads or modifies the new operator store", async () => {
  const f = fixture(); f.deps.progress = async () => { f.switchActor(); };
  const result = await syncCapturedVoiceQueue(context, f.deps);
  expect(result.synced).toBe(0); expect(f.requests).toHaveLength(0); expect(f.removals).toHaveLength(0);
  expect(f.updates.every((identity) => identity.user_id === "operator-a")).toBe(true);
});
test("switch after preflight but before transport still uses the captured token, never B auth", async () => {
  const f = fixture(); const original = f.deps.submit;
  f.deps.submit = async (note, captured) => { f.switchActor(); return original(note, captured); };
  expect((await syncCapturedVoiceQueue(context, f.deps)).synced).toBe(1);
  expect(new Headers(f.requests[0].headers).get("Authorization")).toBe("Bearer token-a");
  expect((f.requests[0].body as FormData).get("expected_user_id")).toBe("operator-a");
  expect(f.removals).toEqual([context]);
});
test("account switch while upload is pending reconciles only the original queue after bound receipt", async () => {
  const f = fixture(); let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const original = f.deps.submit;
  f.deps.submit = async (note, captured) => { await pending; return original(note, captured); };
  const work = syncCapturedVoiceQueue(context, f.deps);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.removals).toHaveLength(0);
  f.switchActor(); release();
  expect((await work).synced).toBe(1);
  expect(f.removals[0].workspace_id).toBe("workspace-a");
  expect(new Headers(f.requests[0].headers).get("Authorization")).toBe("Bearer token-a");
});
test("unbound or foreign acknowledgements retain the original audio", async () => {
  const f = fixture(); f.deps.submit = async () => ({ ...f.receipt, captured_user_id: "operator-b" });
  expect((await syncCapturedVoiceQueue(context, f.deps)).synced).toBe(0);
  expect(f.removals).toHaveLength(0); expect(f.updates.at(-1)?.user_id).toBe("operator-a");
});


test("another queue entry's receipt cannot remove this recording even for the same actor", async () => {
  const f = fixture(); f.deps.submit = async () => ({ ...f.receipt, client_queue_id: "different-note" });
  expect((await syncCapturedVoiceQueue(context, f.deps)).synced).toBe(0);
  expect(f.removals).toHaveLength(0);
});
