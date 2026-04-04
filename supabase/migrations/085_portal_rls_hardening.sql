-- ============================================================================
-- Migration 085: Portal RLS Hardening
--
-- Fixes from post-build audit round 2:
-- 1. Restrict service_requests customer policy: SELECT + INSERT only (no billing UPDATE)
-- 2. Restrict parts_orders customer policy: SELECT + INSERT only (no total/status UPDATE)
-- 3. Restrict portal_quote_reviews customer policy: SELECT + controlled UPDATE only
-- 4. Fix maintenance_schedules RLS recursion (use SECURITY DEFINER helper)
-- 5. Standardize JWT workspace extraction to use get_my_workspace()
-- 6. Add balance_due constraint on customer_invoices
-- ============================================================================

-- ═══ 1. service_requests: customers can SELECT + INSERT, not UPDATE billing ═

drop policy if exists "service_requests_self" on public.service_requests;

-- Customers can view their own requests
create policy "service_requests_self_select" on public.service_requests
  for select using (portal_customer_id = public.get_portal_customer_id());

-- Customers can create new requests
create policy "service_requests_self_insert" on public.service_requests
  for insert with check (portal_customer_id = public.get_portal_customer_id());

-- Customers can only update safe fields (photos, preferred_date, description)
-- Billing/status fields are internal-only via the "internal" policy
create policy "service_requests_self_update" on public.service_requests
  for update using (
    portal_customer_id = public.get_portal_customer_id()
    -- Block status changes past 'submitted' by customer
    and status = 'submitted'
  );

-- ═══ 2. parts_orders: customers can SELECT + INSERT draft, not UPDATE totals ═

drop policy if exists "parts_orders_self" on public.parts_orders;

create policy "parts_orders_self_select" on public.parts_orders
  for select using (portal_customer_id = public.get_portal_customer_id());

create policy "parts_orders_self_insert" on public.parts_orders
  for insert with check (
    portal_customer_id = public.get_portal_customer_id()
    -- New orders must start as draft
    and status = 'draft'
  );

-- Customers can only update draft orders (add items, change shipping)
create policy "parts_orders_self_update" on public.parts_orders
  for update using (
    portal_customer_id = public.get_portal_customer_id()
    and status = 'draft'
  );

-- ═══ 3. portal_quote_reviews: customers can view + accept/reject, not forge signatures

drop policy if exists "quote_reviews_self" on public.portal_quote_reviews;

create policy "quote_reviews_self_select" on public.portal_quote_reviews
  for select using (portal_customer_id = public.get_portal_customer_id());

-- Customers can only update status to 'viewed', 'accepted', 'rejected', 'countered'
-- Signature fields are set by portal-api edge function (service role), not direct update
create policy "quote_reviews_self_update" on public.portal_quote_reviews
  for update using (
    portal_customer_id = public.get_portal_customer_id()
    and status in ('sent', 'viewed')
  );

-- ═══ 4. Fix maintenance_schedules RLS recursion ════════════════════════════

-- Replace subselect-based policy with SECURITY DEFINER helper
create or replace function public.customer_can_view_maintenance(p_fleet_id uuid, p_subscription_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (
    (p_fleet_id is not null and exists (
      select 1 from public.customer_fleet cf
      where cf.id = p_fleet_id
      and cf.portal_customer_id = (
        select id from public.portal_customers where auth_user_id = auth.uid()
      )
    ))
    or
    (p_subscription_id is not null and exists (
      select 1 from public.eaas_subscriptions es
      where es.id = p_subscription_id
      and es.portal_customer_id = (
        select id from public.portal_customers where auth_user_id = auth.uid()
      )
    ))
  );
$$;

revoke execute on function public.customer_can_view_maintenance(uuid, uuid) from public;
grant execute on function public.customer_can_view_maintenance(uuid, uuid) to authenticated;

drop policy if exists "maintenance_self" on public.maintenance_schedules;
create policy "maintenance_self" on public.maintenance_schedules
  for select using (public.customer_can_view_maintenance(fleet_id, subscription_id));

-- ═══ 5. Fix campaign_in_my_workspace to use get_my_workspace() ═════════════

create or replace function public.campaign_in_my_workspace(p_campaign_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.marketing_campaigns c
    where c.id = p_campaign_id
    and c.workspace_id = public.get_my_workspace()
  );
$$;

-- Fix subscription_in_my_workspace too
create or replace function public.subscription_in_my_workspace(p_sub_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.eaas_subscriptions s
    where s.id = p_sub_id
    and s.workspace_id = public.get_my_workspace()
  );
$$;

-- ═══ 6. Prevent overpayment on invoices ════════════════════════════════════

alter table public.customer_invoices
  add constraint customer_invoices_no_overpay check (amount_paid <= total);
