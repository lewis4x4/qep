import { assertEquals } from "jsr:@std/assert@1";
import { handleProcessOfflineQueue, type ProcessOfflineQueueDependencies, type QueuedAction } from "./handler.ts";
const USER="11111111-1111-4111-8111-111111111111", WORKSPACE="workspace-a";
const A="10000000-0000-4000-8000-000000000001", B="10000000-0000-4000-8000-000000000002";
function action(id=A, queued_at="2026-01-01T00:00:00Z"):QueuedAction{return {id,action_type:"create_note",payload:{text:"Captured note"},queued_at,user_id:USER,workspace_id:WORKSPACE};}
function fixture(options:{unauthenticated?:boolean;error?:string;receipt?:boolean}={}){
 const calls:Array<Record<string,unknown>>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,...args});return {data:options.receipt===false?null:{id:args.p_action_id,status:"synced"},error:options.error?{message:options.error,code:"40001"}:null};}};
 const deps:Partial<ProcessOfflineQueueDependencies>={createAdminClient:(()=>client)as never,resolveCallerContext:(async()=>({userId:options.unauthenticated?null:USER,role:"rep",workspaceId:"forged-claim"}))as never,resolveProfileActiveWorkspaceId:(async()=>WORKSPACE)as never};
 return {calls,deps};
}
function request(actions:QueuedAction[]){return new Request("https://example.test/process-offline-queue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({actions})});}
Deno.test("unauthenticated request cannot invoke the mutation RPC",async()=>{const f=fixture({unauthenticated:true});assertEquals((await handleProcessOfflineQueue(request([action()]),f.deps)).status,401);assertEquals(f.calls.length,0);});
Deno.test("caller-derived active workspace and actor, immutable action identity and content reach one transaction",async()=>{
 const f=fixture();const body=await (await handleProcessOfflineQueue(request([action()]),f.deps)).json();assertEquals(body.synced,1);assertEquals(f.calls[0],{name:"apply_sales_offline_action",p_user_id:USER,p_workspace_id:WORKSPACE,p_action_id:A,p_action_type:"create_note",p_payload:{text:"Captured note"},p_queued_at:"2026-01-01T00:00:00Z"});
});
Deno.test("captured foreign actor or workspace is retained as failed without a mutation",async()=>{
 for(const bad of [{...action(),user_id:"other"},{...action(),workspace_id:"other"}]){const f=fixture();const body=await(await handleProcessOfflineQueue(request([bad]),f.deps)).json();assertEquals(body.failed,1);assertEquals(f.calls.length,0);}
});
Deno.test("database ownership/conflict failures remain failed; no unconfirmed success receipt",async()=>{
 for(const options of [{error:"Deal not assigned to operator"},{error:"Stage changed while offline"},{receipt:false}]){const f=fixture(options);const body=await(await handleProcessOfflineQueue(request([action()]),f.deps)).json();assertEquals(body.failed,1);assertEquals(body.synced,0);}
});
Deno.test("replay is chronological across distinct action types and enforces the existing50 action limit",async()=>{
 const f=fixture();const later={...action(A,"2026-01-02T00:00:00Z"),action_type:"advance_stage" as const};const earlier=action(B);
 await handleProcessOfflineQueue(request([later,earlier]),f.deps);assertEquals(f.calls.map(x=>x.p_action_id),[B,A]);
 const g=fixture();assertEquals((await handleProcessOfflineQueue(request(Array.from({length:51},()=>action())),g.deps)).status,400);assertEquals(g.calls.length,0);
});
