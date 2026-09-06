-- Bind provider identity to the existing AR receipt, atomically with its invoice application.
-- Existing unbound intents stay legacy/ambiguous until finance reconciles them.
begin;
alter table public.portal_payment_intents add column if not exists receipt_protocol_version integer not null default 0;
alter table public.customer_payments
 add column if not exists provider_name text,
 add column if not exists provider_payment_id text,
 add column if not exists provider_invoice_id uuid references public.customer_invoices(id) on delete restrict;
alter table public.customer_payments add constraint customer_payment_provider_identity_complete check (
 (provider_name is null and provider_payment_id is null and provider_invoice_id is null) or
 (provider_name='stripe' and nullif(btrim(provider_payment_id),'') is not null and provider_invoice_id is not null)
);
create unique index customer_payments_provider_identity on public.customer_payments(provider_name,provider_payment_id) where provider_name is not null;

create or replace function public.guard_provider_receipt_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.provider_name is not null then raise exception 'Provider receipts are immutable; record a compensating refund, not deletion';end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.provider_name is not null and
   (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.crm_company_id is distinct from old.crm_company_id or
    new.portal_customer_id is distinct from old.portal_customer_id or new.tender_type is distinct from old.tender_type or new.reference is distinct from old.reference or
    new.received_at is distinct from old.received_at or new.unapplied_amount is distinct from old.unapplied_amount or
    new.amount is distinct from old.amount or new.provider_name is distinct from old.provider_name or
    new.provider_payment_id is distinct from old.provider_payment_id or new.provider_invoice_id is distinct from old.provider_invoice_id) then
   raise exception 'Provider receipt identity and amount are immutable';
 end if;
 if new.provider_name is not null and (select auth.role()) is distinct from 'service_role' then
  raise exception 'Only the verified provider receipt operation may bind provider identity' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_provider_receipt_identity() from public,anon,authenticated;
create trigger guard_provider_receipt_identity before insert or update or delete on public.customer_payments for each row execute function public.guard_provider_receipt_identity();
create or replace function public.guard_provider_application_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op <> 'INSERT' and exists(select 1 from public.customer_payments where id=old.customer_payment_id and provider_name is not null) then
  raise exception 'Provider applications are immutable; retain the receipt when recording a refund';
 end if;
 if tg_op <> 'DELETE' and exists(select 1 from public.customer_payments where id=new.customer_payment_id and provider_name is not null) then
  raise exception 'Provider applications are immutable; the full receipt is already allocated';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function public.guard_provider_application_history() from public,anon,authenticated;
create trigger guard_provider_application_history before insert or update or delete on public.customer_payment_applications for each row execute function public.guard_provider_application_history();

create or replace function public.apply_stripe_invoice_receipt(p_intent_id uuid,p_provider_payment_id text,p_captured_amount_cents bigint,p_event_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_intent public.portal_payment_intents; v_receipt public.customer_payments; v_invoice public.customer_invoices;
 v_result jsonb; v_payment_id uuid; v_balance_cents bigint;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Verified provider service required' using errcode='42501';end if;
 if nullif(btrim(p_provider_payment_id),'') is null or p_captured_amount_cents<=0 then raise exception 'Invalid provider payment identity or amount';end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-receipt:' || p_provider_payment_id,0));
 select * into v_intent from public.portal_payment_intents where id=p_intent_id for update;
 if not found or v_intent.workspace_id is null or v_intent.company_id is null or v_intent.invoice_id is null then raise exception 'Payment scope or invoice anchor missing';end if;
 if v_intent.amount_cents is distinct from p_captured_amount_cents then raise exception 'Captured amount differs from intended amount';end if;
 if v_intent.stripe_payment_intent_id is distinct from p_provider_payment_id and not (
   v_intent.stripe_payment_intent_id like 'cs_%' and v_intent.metadata->>'checkout_session_id'=v_intent.stripe_payment_intent_id
 ) then raise exception 'Provider identity differs from the anchored payment intent';end if;
 select * into v_receipt from public.customer_payments where provider_name='stripe' and provider_payment_id=p_provider_payment_id;
 if found then
  if v_receipt.workspace_id is distinct from v_intent.workspace_id or v_receipt.crm_company_id is distinct from v_intent.company_id or
    v_receipt.provider_invoice_id is distinct from v_intent.invoice_id or round(v_receipt.amount*100)::bigint<>p_captured_amount_cents then
   raise exception 'Provider receipt scope, invoice or amount conflict' using errcode='42501';
  end if;
  if not exists(select 1 from public.customer_payment_applications where customer_payment_id=v_receipt.id and workspace_id=v_intent.workspace_id and customer_invoice_id=v_intent.invoice_id and round(amount*100)::bigint=p_captured_amount_cents) then raise exception 'Provider receipt application requires finance reconciliation';end if;
  return jsonb_build_object('payment_id',v_receipt.id,'already_applied',true,'applied_cents',p_captured_amount_cents,'received_at',v_receipt.received_at);
 end if;
 -- Old invoices may have been paid/refunded while intent metadata never committed.
 -- No surviving mutable field can prove those legacy attempts were never applied.
 if v_intent.receipt_protocol_version<>1 or v_intent.metadata ? 'invoice_payment_applied_at' or v_intent.metadata->>'reconciliation_requires_manual'='true' or exists(
  select 1 from public.customer_payments where reference='stripe:' || p_provider_payment_id
 ) then raise exception 'Legacy provider receipt is ambiguous; finance reconciliation required';end if;
 select * into v_invoice from public.customer_invoices where id=v_intent.invoice_id and workspace_id=v_intent.workspace_id for update;
 if not found or v_invoice.crm_company_id is distinct from v_intent.company_id then raise exception 'Invoice not found in the payment customer/workspace';end if;
 if v_invoice.status in ('void','reversed','cancelled') then raise exception 'Invoice is not payable';end if;
 if v_invoice.payment_reference='stripe:' || p_provider_payment_id then raise exception 'Legacy provider reference requires finance reconciliation';end if;
 v_balance_cents:=round((v_invoice.total-coalesce(v_invoice.amount_paid,0))*100)::bigint;
 if v_balance_cents<>p_captured_amount_cents then raise exception 'Captured amount differs from current full invoice balance';end if;
 v_result:=public.record_ar_payment(v_intent.workspace_id,v_intent.company_id,'card',p_captured_amount_cents::numeric/100,
   jsonb_build_array(jsonb_build_object('invoice_id',v_invoice.id,'amount',p_captured_amount_cents::numeric/100)),
   'stripe:' || p_provider_payment_id,null,'Verified Stripe receipt; event ' || coalesce(p_event_id,''));
 v_payment_id:=(v_result->>'payment_id')::uuid;
 update public.customer_payments set provider_name='stripe',provider_payment_id=p_provider_payment_id,provider_invoice_id=v_invoice.id
 where id=v_payment_id and workspace_id=v_intent.workspace_id and crm_company_id=v_intent.company_id and round(amount*100)::bigint=p_captured_amount_cents
 returning * into v_receipt;
 if not found then raise exception 'Provider receipt binding failed';end if;
 return jsonb_build_object('payment_id',v_receipt.id,'already_applied',false,'applied_cents',p_captured_amount_cents,'received_at',v_receipt.received_at);
end $$;
revoke all on function public.apply_stripe_invoice_receipt(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.apply_stripe_invoice_receipt(uuid,text,bigint,text) to service_role;
commit;
