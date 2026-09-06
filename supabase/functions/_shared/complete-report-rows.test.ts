import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { collectCompleteReportRows } from "./complete-report-rows.ts";
Deno.test("export survives transport caps smaller than requested pages and reconciles every row",async()=>{
 const all=Array.from({length:1201},(_,id)=>({id:String(id),hours:1}));let calls=0;
 const rows=await collectCompleteReportRows<{id:string;hours:number}>({maxRows:5000,key:r=>r.id,page:async(offset,_size)=>{calls++;return{data:all.slice(offset,offset+250),count:all.length,error:null};}});
 assertEquals(rows.length,1201);assertEquals(rows.reduce((sum,r)=>sum+r.hours,0),1201);assertEquals(calls,5);
});
Deno.test("export refuses over-limit, missing and concurrently changed rows instead of completing partial files",async()=>{
 await assertRejects(()=>collectCompleteReportRows({maxRows:10,key:(r:{id:string})=>r.id,page:async()=>({data:[],count:11,error:null})}),Error,"No partial export");
 await assertRejects(()=>collectCompleteReportRows({maxRows:10,key:(r:{id:string})=>r.id,page:async()=>({data:[],count:2,error:null})}),Error,"No partial export");
 let calls=0;await assertRejects(()=>collectCompleteReportRows({maxRows:10,key:(r:{id:string})=>r.id,page:async()=>({data:[{id:String(calls++)}],count:calls===1?2:3,error:null})}),Error,"changed");
 await assertRejects(()=>collectCompleteReportRows({maxRows:10,key:(r:{id:string})=>r.id,page:async()=>({data:[{id:'same'},{id:'same'}],count:2,error:null})}),Error,"duplicate");
});
