import { describe, expect, test, mock, beforeEach } from "bun:test";
let queue: Array<{id:string}> = [], batches: any[] = [], cleared: string[] = [], failBatch = -1, switched = false;
const identity = { user_id: "user-a", workspace_id: "branch-a" };
mock.module("./offline-store", () => ({
  getOfflineIdentity: async () => identity,
  assertOfflineIdentity: async () => { if (switched) throw new Error("identity changed"); },
  getOfflineQueue: async () => queue,
  clearSyncedActions: async (ids:string[]) => { cleared.push(...ids); },
}));
mock.module("@/lib/supabase", () => ({ supabase: { functions: { invoke: async (_name:string, {body}:any) => {
  batches.push(body.actions); if (batches.length === failBatch) return {error:new Error("offline")};
  return {data:{results:[...body.actions.map((a:any,i:number)=>({id:a.id,status:i===0?'conflict':'synced'})),{id:'not-submitted',status:'synced'}]}};
} } } }));
const { syncOfflineQueue } = await import("./sync-engine");
beforeEach(() => {queue=Array.from({length:121},(_,i)=>({id:`action-${i}`}));batches=[];cleared=[];failBatch=-1;switched=false;});
describe("offline synchronization",()=>{
 test("drains admitted batches, retains conflicts, ignores foreign acknowledgements and coalesces reconnects",async()=>{
  const [a,b]=await Promise.all([syncOfflineQueue(),syncOfflineQueue()]);
  expect(batches.map(x=>x.length)).toEqual([50,50,21]);expect(a).toEqual({total:121,synced:118,failed:3});expect(a).toEqual(b);expect(cleared).not.toContain('not-submitted');expect(cleared).not.toContain('action-0');
 });
 test("retains unacknowledged work when a later batch fails",async()=>{failBatch=2;const r=await syncOfflineQueue();expect(r).toEqual({total:121,synced:49,failed:72});expect(batches).toHaveLength(2);});
 test("never submits an old operator's work after a scope change",async()=>{switched=true;expect((await syncOfflineQueue()).synced).toBe(0);expect(batches).toHaveLength(0);expect(cleared).toHaveLength(0);});
});
