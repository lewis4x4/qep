import { assert, assertEquals } from "jsr:@std/assert@1";
import { handlePortalStripeRequest, type PortalStripeDependencies } from "./handler.ts";
import { reconcileSucceededPayment } from "../_shared/portal-stripe-reconcile.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
const constraint = await Deno.readTextFile(new URL("../../migrations/803_n6_equipment_lifecycle_truth.sql", import.meta.url));
const sourceConstraint = constraint.slice(constraint.indexOf("add constraint exception_queue_source_check"),constraint.indexOf("create or replace function public.trg_trade_to_stock"));
function fixture() {
 const state = {
  invoice: {id:"invoice-1",workspace_id:"ws",crm_company_id:"company-1",total:100,amount_paid:0,status:"sent",paid_at:null as string|null,payment_reference:null as string|null},
  intent: {id:"intent-1",workspace_id:"ws",company_id:"company-1",invoice_id:"invoice-1" as string|null,amount_cents:10000,stripe_payment_intent_id:"pi_1",metadata:{} as Record<string,unknown>,status:"requires_payment_method",webhook_signature_verified:false,receipt_protocol_version:1},
  portal: null as Record<string,unknown>|null, profile: {role:"finance_admin",is_active:true,active_workspace_id:"ws"},
  missingInvoice:false, missingIntent:false, invoiceLookupError:false, invoiceWriteError:false, intentWriteError:false, insertError:false, casConflict:false,
  receipts: new Map<string,{payment_id:string;applied_cents:number;received_at:string;invoice_id:string}>(),
  invoiceWrites:0, fetches:[] as string[], exceptions:[] as Record<string,unknown>[],
 };
 const admin = {from(table:string) {
  let patch:Record<string,unknown>|null=null; const filters:Array<[string,unknown]>=[]; let metadataFilter: Record<string,unknown>|null=null;
  const row=()=>table==="customer_invoices" ? state.missingInvoice?null:state.invoice : table==="portal_payment_intents" ? state.missingIntent?null:state.intent : table==="portal_customers" ? state.portal : table==="profiles" ? state.profile : null;
  async function execute() {
   if(table==="customer_invoices" && !patch && state.invoiceLookupError)return {data:null,error:{message:"invoice lookup unavailable"}};
   if(patch && (table==="customer_invoices" && state.invoiceWriteError || table==="portal_payment_intents" && state.intentWriteError))return {data:null,error:{message:"injected write failure"}};
   const target=row() as Record<string,unknown>|null;
   if (target && metadataFilter && Object.entries(metadataFilter).some(([key,value]) => (target.metadata as Record<string,unknown> | undefined)?.[key] !== value)) return {data:null,error:null};
   if(target && filters.some(([key,value])=>key in target && target[key]!==value))return {data:null,error:null};
   if(patch && target) {
    if(table==="customer_invoices" && state.casConflict)return {data:null,error:null};
    if(filters.some(([key,value])=>key in target && target[key]!==value))return {data:null,error:null};
    Object.assign(target,patch);if(table==="customer_invoices")state.invoiceWrites++;
   }
   return {data:target?structuredClone(target):null,error:null};
  }
  const q={select:(_s?:string)=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q;},is:(key:string,value:unknown)=>{filters.push([key,value]);return q;},neq:()=>q,contains:(_key:string,value:Record<string,unknown>)=>{metadataFilter=value;return q;},limit:()=>q,maybeSingle:execute,
   update:(value:Record<string,unknown>)=>{patch=value;return q;},
   insert:async (value:unknown)=>{
    if(table === "exception_queue") { const payload=value as Record<string,unknown>;if(!sourceConstraint.includes(`'${payload.source}'`))return {error:{message:"exception_queue_source_check"}};state.exceptions.push(payload);return {error:null}; }
    return {error:state.insertError?{message:"intent persistence unavailable"}:null};
   },
   then:(resolve:(value:unknown)=>unknown)=>execute().then(resolve)};return q;
 },rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name === "apply_stripe_invoice_receipt") {
    const id=String(args.p_provider_payment_id),amount=Number(args.p_captured_amount_cents);
    const existing=state.receipts.get(id);if(existing)return {data:existing,error:null};
    if(state.intent.receipt_protocol_version!==1 || state.intent.metadata.invoice_payment_applied_at || state.intent.metadata.reconciliation_requires_manual)return {data:null,error:{message:"Legacy provider receipt is ambiguous; finance reconciliation required"}};
    if(state.invoiceWriteError || state.casConflict)return {data:null,error:{message:"injected receipt transaction failure"}};
    if(amount!==Math.round((state.invoice.total-state.invoice.amount_paid)*100))return {data:null,error:{message:"Captured amount differs from current full invoice balance"}};
    const receipt={payment_id:"canonical-payment",applied_cents:amount,received_at:"2026-09-06T00:00:00Z",invoice_id:state.intent.invoice_id!};
    state.invoice.amount_paid+=amount/100;state.invoice.status="paid";state.invoice.payment_reference=`stripe:${id}`;state.invoiceWrites++;state.receipts.set(id,receipt);
    return {data:receipt,error:null};
  }
  if(name==="enqueue_exception") {if(!sourceConstraint.includes(`'${args.p_source}'`))return {data:null,error:{message:"exception_queue_source_check"}};state.exceptions.push(args);}
  return {data:null,error:null};
 }} as unknown as SupabaseClient;
 const deps:Partial<PortalStripeDependencies>={createAdmin:()=>admin,authenticate:async()=>({ok:true,userId:"user-1",supabase:admin}),stripeSecret:"test_secret",webhookSecret:"test_hook",capture:()=>{},reconcile:reconcileSucceededPayment,
 fetch:async(input:RequestInfo|URL)=>{state.fetches.push(String(input));return new Response(JSON.stringify({id:"cs_1",url:"https://checkout.stripe.com/test",payment_intent:"pi_1"}),{status:200});}};
 return {state,admin,deps};
}
const checkout=()=>new Request("https://local.test/portal-stripe/create-checkout",{method:"POST",headers:{Authorization:"Bearer local-test","Content-Type":"application/json"},body:JSON.stringify({invoice_id:"invoice-1",company_id:"company-1"})});
async function webhook() {
 const body=JSON.stringify({id:"evt_1",type:"checkout.session.completed",data:{object:{id:"cs_1",payment_intent:"pi_1",payment_status:"paid",amount_total:10000,currency:"usd"}}});
 const time=String(Math.floor(Date.now()/1000)),encoder=new TextEncoder();
 const key=await crypto.subtle.importKey("raw",encoder.encode("test_hook"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,encoder.encode(`${time}.${body}`));
 const hex=Array.from(new Uint8Array(sig)).map(n=>n.toString(16).padStart(2,"0")).join("");
 return new Request("https://local.test/portal-stripe/webhook",{method:"POST",headers:{"stripe-signature":`t=${time},v1=${hex}`},body});
}
Deno.test("checkout suppresses payable URL and expires session when local intent insert fails",async()=>{
 const {state,deps}=fixture();state.insertError=true;
 const response=await handlePortalStripeRequest(checkout(),deps);assertEquals(response.status,500);const body=await response.json();assertEquals(body.url,undefined);assert(state.fetches.some(url=>url.endsWith("/cs_1/expire")));
});
Deno.test("active staff can collect invoices but a portal customer's backing rep role cannot bypass company ownership",async()=>{
 const {state,deps}=fixture();assertEquals((await handlePortalStripeRequest(checkout(),deps)).status,200);
 state.fetches=[];state.portal={id:"pc-1",workspace_id:"ws",crm_company_id:"other-company",is_active:true};state.profile.role="rep";
 assertEquals((await handlePortalStripeRequest(checkout(),deps)).status,403);assertEquals(state.fetches,[]);
 state.portal.is_active=false;assertEquals((await handlePortalStripeRequest(checkout(),deps)).status,403);
});
Deno.test("unmatched signed callback uses the real allowed exception source and requests retry",async()=>{
 const {state,deps}=fixture();state.missingIntent=true;const response=await handlePortalStripeRequest(await webhook(),deps);assertEquals(response.status,500);
 assertEquals(state.exceptions.length,1);assertEquals(state.exceptions[0].p_source,"stripe_mismatch");assertEquals((state.exceptions[0].p_payload as Record<string,unknown>).exception_subtype,"stripe_unmatched_payment");
});
Deno.test("invoice lookup failure cannot create an applied marker; callback retry applies once",async()=>{
 const {state,deps}=fixture();state.invoiceLookupError=true;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.intent.metadata.invoice_payment_applied_at,undefined);assertEquals(state.invoiceWrites,0);
 state.invoiceLookupError=false;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoiceWrites,1);assertEquals(state.invoice.amount_paid,100);
});
Deno.test("missing anchor and amount mismatch remain unapplied with a persisted exception",async()=>{
 for(const failure of ["anchor","missing","underpaid"]){const {state,deps}=fixture();if(failure==="anchor")state.intent.invoice_id=null;if(failure==="missing")state.missingInvoice=true;if(failure==="underpaid")state.invoice.total=200;
 state.intent.metadata.invoice_payment_applied_at="premature-old-marker";
 assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.invoiceWrites,0);assertEquals(state.intent.metadata.invoice_payment_applied_at,undefined);assertEquals(state.intent.status,"processing");assertEquals(state.exceptions.length,1);}
});
Deno.test("invoice failure and conditional-write conflict both preserve retry eligibility",async()=>{
 for(const failure of ["error","conflict"]){const {state,deps}=fixture();state.invoiceWriteError=failure==="error";state.casConflict=failure==="conflict";
 assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.intent.metadata.invoice_payment_applied_at,undefined);
 state.invoiceWriteError=false;state.casConflict=false;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoiceWrites,1);}
});
Deno.test("late intent update failure retries against persisted invoice evidence without charging twice",async()=>{
 const {state,deps}=fixture();state.intentWriteError=true;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.invoiceWrites,1);assertEquals(state.invoice.payment_reference,"stripe:pi_1");assertEquals(state.intent.metadata.invoice_payment_applied_at,undefined);
 state.intentWriteError=false;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoiceWrites,1);assertEquals(state.intent.status,"succeeded");assert(typeof state.intent.metadata.invoice_payment_applied_at==="string");
});
Deno.test("a legacy marker without immutable receipt evidence requires manual reconciliation",async()=>{
 const {state,deps}=fixture();state.intent.metadata.invoice_payment_applied_at="premature-old-marker";assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.invoiceWrites,0);assertEquals(state.intent.metadata.reconciliation_requires_manual,true);assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.invoiceWrites,0);
});

Deno.test("invoice increases and refunds never turn the same received payment into new money",async()=>{
 const {state,deps}=fixture();assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);
 state.invoice.total=200;
 assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoice.amount_paid,100);assertEquals(state.invoiceWrites,1);
 state.invoice.amount_paid=50;state.invoice.payment_reference="refund:reviewed";state.invoice.status="partial";
 assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoice.amount_paid,50);assertEquals(state.invoiceWrites,1);
});
Deno.test("late intent-state failure followed by an increased invoice does not reapply cash",async()=>{
 const {state,deps}=fixture();state.intentWriteError=true;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);
 state.intentWriteError=false;state.invoice.total=200;
 assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoice.amount_paid,100);assertEquals(state.invoiceWrites,1);
});

Deno.test("invalid webhook signatures perform no accounting writes",async()=>{
 const {state,deps}=fixture();const req=new Request("https://local.test/portal-stripe/webhook",{method:"POST",headers:{"stripe-signature":"t=1,v1=invalid"},body:"{}"});
 assertEquals((await handlePortalStripeRequest(req,deps)).status,401);assertEquals(state.invoiceWrites,0);assertEquals(state.exceptions.length,0);
});

Deno.test("a captured but blocked receipt prevents a second checkout",async()=>{
 const {state,deps}=fixture();state.intent.metadata={reconciliation_status:"blocked"};state.intent.webhook_signature_verified=true;
 const response=await handlePortalStripeRequest(checkout(),deps);assertEquals(response.status,409);assertEquals(state.fetches.length,0);assertEquals((await response.json()).error.includes("Do not pay"),true);
});

Deno.test("late intent failure plus a full refund cannot reapply the original provider receipt",async()=>{
 const {state,deps}=fixture();state.intentWriteError=true;assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,500);assertEquals(state.receipts.size,1);
 state.intentWriteError=false;state.invoice.amount_paid=0;state.invoice.payment_reference="reviewed_full_refund";state.invoice.status="sent";
 assertEquals((await handlePortalStripeRequest(await webhook(),deps)).status,200);assertEquals(state.invoice.amount_paid,0);assertEquals(state.invoiceWrites,1);assertEquals(state.receipts.size,1);
});
