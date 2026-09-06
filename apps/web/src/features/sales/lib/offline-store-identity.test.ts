import { expect, test, mock } from "bun:test";
type TestUser = { id: string; app_metadata: { workspace_id: string } };
let user: TestUser | null = { id: "a", app_metadata: { workspace_id: "one" } };
mock.module("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: user ? { user, access_token: `token-${user.id}` } : null } }) } } }));
mock.module("@/lib/auth-recovery", () => ({ readOfflineWorkspace: () => null }));
const { offlineDatabaseName, getOfflineIdentity, assertOfflineIdentity, captureOfflineSubmissionContext, enqueueVoiceNote, updateQueuedVoiceNote, removeQueuedVoiceNotes } = await import("./offline-store");
test("caches and blobs have distinct namespaces for every actor/workspace", () => {
  expect(offlineDatabaseName({ user_id: "a", workspace_id: "one" })).not.toBe(offlineDatabaseName({ user_id: "b", workspace_id: "one" }));
  expect(offlineDatabaseName({ user_id: "a", workspace_id: "one" })).not.toBe(offlineDatabaseName({ user_id: "a", workspace_id: "two" }));
});
test("signed out and changed identity cannot access the old queue", async () => {
  user = { id: "a", app_metadata: { workspace_id: "one" } };
  const identity = await getOfflineIdentity(); user = { id: "b", app_metadata: { workspace_id: "one" } };
  await expect(assertOfflineIdentity(identity)).rejects.toThrow("Account or workspace changed");
  user = null; await expect(getOfflineIdentity()).rejects.toThrow("Sign in");
});
test("submission captures one immutable actor/workspace/token snapshot", async () => {
  user = { id: "a", app_metadata: { workspace_id: "one" } };
  const context = await captureOfflineSubmissionContext();
  user = { id: "b", app_metadata: { workspace_id: "two" } };
  expect(Object.isFrozen(context)).toBe(true);
  expect(context).toEqual({ user_id: "a", workspace_id: "one", accessToken: "token-a" });
});
test("actual voice store operations keep original namespace after account switch and never persist token", async () => {
  user = { id: "a", app_metadata: { workspace_id: "one" } };
  const context = await captureOfflineSubmissionContext();
  user = { id: "b", app_metadata: { workspace_id: "two" } };
  const original = globalThis.indexedDB;
  const opened: string[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const dbName = offlineDatabaseName(context);
  const fake = {
    open(name: string) {
      opened.push(name);
      const request: { result?: unknown; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            const tx: { oncomplete?: () => void; objectStore: () => unknown } = {
              objectStore: () => ({
                put(row: Record<string, unknown>) { rows.set(`${name}:${row.id}`, row); },
                delete(id: string) { rows.delete(`${name}:${id}`); },
                get(id: string) {
                  const getRequest: { result?: unknown; onsuccess?: () => void } = {};
                  queueMicrotask(() => { getRequest.result = rows.get(`${name}:${id}`); getRequest.onsuccess?.(); });
                  return getRequest;
                },
              }),
            };
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fake });
  try {
    await enqueueVoiceNote({ id: "q", audioBlob: new Blob(["audio"]), mimeType: "audio/webm", fileName: "q.webm", durationSeconds: 1, dealId: null, dealLabel: null, queuedAt: "2026-09-06" }, context);
    expect(JSON.stringify(rows.get(`${dbName}:q`))).not.toContain("token-a");
    expect(rows.get(`${dbName}:q`)?.user_id).toBe("a");
    await updateQueuedVoiceNote("q", { status: "failed", lastError: "retry" }, context);
    expect(rows.get(`${dbName}:q`)?.status).toBe("failed");
    await removeQueuedVoiceNotes(["q"], context);
    expect(rows.has(`${dbName}:q`)).toBe(false);
    expect(opened).toEqual([dbName, dbName, dbName]);
  } finally { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: original }); }
});
