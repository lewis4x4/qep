import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { resolveReplayContext, completedReplayStep } from "./replay-context.ts";
import { workflowMatchesEvent } from "../../flow-runner/handler.ts";
import type { FlowEvent } from "./types.ts";
const event:FlowEvent={event_id:"new-event",flow_event_type:"rental.contract.opened",workspace_id:"w1",source_module:"system",entity_type:null,entity_id:null,occurred_at:"2026-01-01T00:00:00Z",correlation_id:null,parent_event_id:"original-event",properties:{resumed_from_run:"old-run",resumed_workflow_slug:"rental-on-rent-delivery",effect_event_id:"original-event"}};
function db(mismatch=false){return {from:(table:string)=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:"old-run",workspace_id:"w1",workflow_slug:"rental-on-rent-delivery",event_id:"original-event",metadata:{resumed_as_event:mismatch?"forged-event":"new-event"}},error:null}),then:(resolve:(x:unknown)=>unknown)=>Promise.resolve(resolve({data:[],error:null}))};return query;}};}
Deno.test("actual runner targets the original workflow pattern, not its slug as event type",()=>{
 assertEquals(workflowMatchesEvent({slug:"rental-on-rent-delivery",trigger_event_pattern:"rental.contract.opened"},event),true);
 assertEquals(workflowMatchesEvent({slug:"other-workflow",trigger_event_pattern:"rental.contract.opened"},event),false);
 assertEquals(workflowMatchesEvent({slug:"rental-on-rent-delivery",trigger_event_pattern:"rental.contract.opened"},{...event,flow_event_type:"rental-on-rent-delivery"}),false);
});
Deno.test("only a database-bound resume can reuse original effect identity",async()=>{
 assertEquals((await resolveReplayContext(db() as never,event,"rental-on-rent-delivery")).effectEventId,"original-event");
 await assertRejects(()=>resolveReplayContext(db(true) as never,event,"rental-on-rent-delivery"),Error,"authorized run");
});
Deno.test("completed action receipts survive retries without repeating effects; changed workflow requires review",()=>{
 const prior={step_index:0,action_key:"send",params:{to:"customer",body:"approved"},status:"succeeded",result:{delivery_id:"saved"},idempotency_key:"original"};
 assertEquals(completedReplayStep([prior],0,"send",{body:"approved",to:"customer"}),prior);
 assertThrows(()=>completedReplayStep([prior],0,"send",{body:"different",to:"customer"}),Error,"Workflow changed");
 assertEquals(completedReplayStep([{...prior,status:"failed"}],0,"send",prior.params),undefined);
});
