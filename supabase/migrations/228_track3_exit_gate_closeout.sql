-- ============================================================================
-- Migration 228: Track 3 Exit Gate Closeout
--
-- Adds:
--   1. company-scoped health-score recompute helpers
--   2. source-table triggers for near-immediate health-score recompute
--   3. nightly revenue-attribution-compute schedule
-- ============================================================================

create or replace function public.recompute_health_score_for_company(
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if p_company_id is null then
    return;
  end if;

  for v_profile_id in
    select id
    from public.customer_profiles_extended
    where crm_company_id = p_company_id
  loop
    perform public.compute_customer_health_score(v_profile_id);
  end loop;
end;
$$;

comment on function public.recompute_health_score_for_company(uuid) is
  'Track 3 exit-gate helper. Recomputes health score for all customer profiles linked to a CRM company.';

revoke all on function public.recompute_health_score_for_company(uuid) from public;
grant execute on function public.recompute_health_score_for_company(uuid) to service_role;

create or replace function public.resolve_parts_order_company_id(
  p_crm_company_id uuid,
  p_portal_customer_id uuid
)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    p_crm_company_id,
    (
      select pc.crm_company_id
      from public.portal_customers pc
      where pc.id = p_portal_customer_id
    )
  );
$$;

comment on function public.resolve_parts_order_company_id(uuid, uuid) is
  'Returns the effective crm_company_id for a parts order using crm_company_id first, then portal customer binding.';

revoke all on function public.resolve_parts_order_company_id(uuid, uuid) from public;
grant execute on function public.resolve_parts_order_company_id(uuid, uuid) to service_role;

create or replace function public.health_score_recompute_from_crm_deals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_health_score_for_company(coalesce(new.company_id, old.company_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.health_score_recompute_from_service_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_health_score_for_company(coalesce(new.customer_id, old.customer_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.health_score_recompute_from_parts_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  v_company_id := public.resolve_parts_order_company_id(
    coalesce(new.crm_company_id, old.crm_company_id),
    coalesce(new.portal_customer_id, old.portal_customer_id)
  );
  perform public.recompute_health_score_for_company(v_company_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.health_score_recompute_from_customer_invoices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_health_score_for_company(coalesce(new.crm_company_id, old.crm_company_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.health_score_recompute_from_voice_captures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_health_score_for_company(coalesce(new.linked_company_id, old.linked_company_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists health_score_recompute_crm_deals_trg on public.qrm_deals;
create trigger health_score_recompute_crm_deals_trg
  after insert or delete or update of company_id, stage_id, amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, deposit_status, margin_check_status, dge_score
  on public.qrm_deals
  for each row
  execute function public.health_score_recompute_from_crm_deals();

drop trigger if exists health_score_recompute_service_jobs_trg on public.service_jobs;
create trigger health_score_recompute_service_jobs_trg
  after insert or delete or update of customer_id, current_stage, status_flags, quote_total, invoice_total, closed_at, updated_at
  on public.service_jobs
  for each row
  execute function public.health_score_recompute_from_service_jobs();

drop trigger if exists health_score_recompute_parts_orders_trg on public.parts_orders;
create trigger health_score_recompute_parts_orders_trg
  after insert or delete or update of crm_company_id, portal_customer_id, status, total, updated_at
  on public.parts_orders
  for each row
  execute function public.health_score_recompute_from_parts_orders();

drop trigger if exists health_score_recompute_customer_invoices_trg on public.customer_invoices;
create trigger health_score_recompute_customer_invoices_trg
  after insert or delete or update of crm_company_id, amount_paid, paid_at, status, total, updated_at
  on public.customer_invoices
  for each row
  execute function public.health_score_recompute_from_customer_invoices();

drop trigger if exists health_score_recompute_voice_captures_trg on public.voice_captures;
create trigger health_score_recompute_voice_captures_trg
  after insert or delete or update of linked_company_id, sentiment, created_at
  on public.voice_captures
  for each row
  execute function public.health_score_recompute_from_voice_captures();

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'revenue-attribution-compute-nightly') then
    perform cron.unschedule('revenue-attribution-compute-nightly');
  end if;

  perform cron.schedule(
    'revenue-attribution-compute-nightly',
    '40 4 * * *',
    format(
      $sql$
      select net.http_post(
        url := '%s/functions/v1/revenue-attribution-compute/scan-recent-wins',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-service-role-key', current_setting('app.settings.service_role_key', true)
        ),
        body := '{}'::jsonb
      );
      $sql$,
      current_setting('app.settings.supabase_url', true)
    )
  );
exception
  when undefined_function then
    raise notice 'Skipping revenue-attribution-compute cron: pg_cron or pg_net unavailable.';
end
$cron$;
