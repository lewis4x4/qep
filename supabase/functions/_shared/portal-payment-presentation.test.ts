import { assertEquals } from "jsr:@std/assert@1";
import { paymentReconciliationPending } from "./portal-payment-presentation.ts";
Deno.test("blocked verified capture remains pending finance rather than provider processing or invoice paid",()=>{
 const result=paymentReconciliationPending({webhook_signature_verified:true,metadata:{reconciliation_status:"blocked",invoice_payment_blocked_reason:"company_mismatch"}});
 assertEquals(result?.label,"Payment captured; finance reconciliation pending");assertEquals(result?.status,"processing");assertEquals(result?.detail.includes("Do not pay again"),true);
});
Deno.test("legacy blocked deposit metadata also cannot imply receipt application",()=>{
 assertEquals(paymentReconciliationPending({webhook_signature_verified:true,metadata:{deposit_payment_blocked_reason:"amount_mismatch"}})?.tone,"amber");
});
Deno.test("successful applied and not-yet-captured attempts keep their normal presentation",()=>{
 assertEquals(paymentReconciliationPending({metadata:{reconciliation_status:"applied",invoice_payment_applied_at:"2026-09-06"}}),null);
 assertEquals(paymentReconciliationPending({metadata:{}}),null);
});
