import { assertEquals } from "jsr:@std/assert@1";
import { commitServiceCloseoutTransition, executeServiceJobCloseout } from "./service-closeout.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
function fixture(){
 const state={job:{id:"job",workspace_id:"ws",current_stage:"invoice_ready"},failure:true,warrantyFailure:false,notApplicable:false,notificationsFail:false,updates:0};
 const db={from(table:string){let patch:Record<string,unknown>={};const q={update:(value:Record<string,unknown>)=>{patch=value;return q;},eq:()=>q,select:()=>q,single:async()=>{Object.assign(state.job,patch);state.updates++;return {data:state.job,error:null};},insert:async()=>({error:null})};return q;}} as unknown as SupabaseClient;
 const prepare=(client:SupabaseClient,params:Parameters<typeof executeServiceJobCloseout>[1])=>executeServiceJobCloseout(client,params,{
  finalizeServiceInvoiceForJob:async()=>state.notApplicable?{invoice_id:null,finalized:false,not_applicable:true}:state.failure?{invoice_id:null,finalized:false,error:"Invoice lines could not persist"}:{invoice_id:"invoice",finalized:true,status:params.stage==="paid_closed"?"paid":"sent"},
  syncArOpenItemForInvoice:async()=>({ok:true}),
  jobHasWarrantyClaimLines:async()=>{if(state.warrantyFailure)throw new Error("Warranty lookup failed");return false;},
  queueServiceCustomerNotification:async()=>{if(state.notificationsFail)throw new Error("Notification queue unavailable");return {} as never;},
 });
 return {state,db,prepare};
}
Deno.test("financial failure keeps the work order actionable and an identical retry converges",async()=>{
 const {state,db,prepare}=fixture();const params={job:{...state.job},actorId:"actor",stage:"invoiced" as const,updates:{current_stage:"invoiced"}};
 const failed=await commitServiceCloseoutTransition(db,params,prepare);assertEquals(failed.closeout.financial_complete,false);assertEquals(state.job.current_stage,"invoice_ready");assertEquals(state.updates,0);
 state.failure=false;const success=await commitServiceCloseoutTransition(db,params,prepare);assertEquals(success.error,undefined);assertEquals(state.job.current_stage,"invoiced");assertEquals(state.updates,1);
});
Deno.test("internal no-invoice is not a financial failure, but warranty lookup failures prevent close",async()=>{
 const {state,db,prepare}=fixture();state.notApplicable=true;state.warrantyFailure=true;const params={job:{...state.job},actorId:"actor",stage:"paid_closed" as const,updates:{current_stage:"paid_closed"}};
 const blocked=await commitServiceCloseoutTransition(db,params,prepare);assertEquals(blocked.closeout.invoice_not_applicable,true);assertEquals(blocked.closeout.financial_complete,false);assertEquals(state.updates,0);
 state.warrantyFailure=false;const closed=await commitServiceCloseoutTransition(db,params,prepare);assertEquals(closed.closeout.financial_complete,true);assertEquals(state.job.current_stage,"paid_closed");
});
Deno.test("nonfinancial notification failure remains an explicit warning after successful financial closeout",async()=>{
 const {state,db,prepare}=fixture();state.failure=false;state.notificationsFail=true;
 const result=await commitServiceCloseoutTransition(db,{job:{...state.job},actorId:"actor",stage:"invoiced",updates:{current_stage:"invoiced"}},prepare);
 assertEquals(result.closeout.financial_complete,true);assertEquals(result.closeout.warnings,["Notification queue unavailable"]);assertEquals(state.job.current_stage,"invoiced");
});
