-- ============================================================================
-- Migration 230: Track 7A.2 — Time Bank
--
-- Builds the first Time Bank surface on top of the existing P0.7 time
-- primitive. Exposes per-deal time balance with company + rep context and
-- explicit budget policy:
--   - use stage SLA when configured
--   - otherwise use a 14-day operating fallback so every open deal can
--     participate in the ledger
-- ============================================================================

create or replace function public.qrm_time_bank(
  p_workspace_id text,
  p_default_budget_days integer default 14
)
returns table(
  deal_id uuid,
  deal_name text,
  company_id uuid,
  company_name text,
  assigned_rep_id uuid,
  assigned_rep_name text,
  stage_id uuid,
  stage_name text,
  days_in_stage integer,
  stage_age_days integer,
  budget_days integer,
  has_explicit_budget boolean,
  remaining_days integer,
  pct_used numeric,
  is_over boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace text;
begin
  v_workspace := case
    when auth.role() = 'service_role' then coalesce(p_workspace_id, 'default')
    else public.get_my_workspace()
  end;

  return query
  with base as (
    select
      d.id as deal_id,
      d.name as deal_name,
      d.company_id,
      c.name as company_name,
      d.assigned_rep_id,
      p.full_name as assigned_rep_name,
      d.stage_id,
      s.name as stage_name,
      public.qrm_stage_age(d.id) as days_in_stage,
      public.qrm_stage_age(d.id) as stage_age_days,
      coalesce(nullif(ceil(coalesce(s.sla_minutes, 0)::numeric / 1440.0), 0)::integer, greatest(p_default_budget_days, 1)) as budget_days,
      (s.sla_minutes is not null and s.sla_minutes > 0) as has_explicit_budget
    from public.crm_deals d
    join public.crm_deal_stages s on s.id = d.stage_id
    left join public.crm_companies c on c.id = d.company_id
    left join public.profiles p on p.id = d.assigned_rep_id
    where d.workspace_id = v_workspace
      and d.deleted_at is null
      and d.closed_at is null
  )
  select
    b.deal_id,
    b.deal_name,
    b.company_id,
    b.company_name,
    b.assigned_rep_id,
    b.assigned_rep_name,
    b.stage_id,
    b.stage_name,
    b.days_in_stage,
    b.stage_age_days,
    b.budget_days,
    b.has_explicit_budget,
    greatest(b.budget_days - b.days_in_stage, 0) as remaining_days,
    round(
      case
        when b.budget_days > 0 then (b.days_in_stage::numeric / b.budget_days::numeric)
        else 1
      end,
      2
    ) as pct_used,
    (b.days_in_stage > b.budget_days) as is_over
  from base b
  order by is_over desc, pct_used desc, b.days_in_stage desc, b.deal_name asc;
end;
$$;

comment on function public.qrm_time_bank is
  'Track 7A.2: per-deal time balance with company + rep context. Uses stage SLA when configured, otherwise a 14-day operating fallback so every open deal participates in the Time Bank.';

revoke execute on function public.qrm_time_bank(text, integer) from public;
grant execute on function public.qrm_time_bank(text, integer) to authenticated, service_role;
