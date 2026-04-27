-- 397_customer_ein.sql
--
-- Wave 0: Brian's EIN anchor from docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.ein.
-- Adds Federal EIN to qrm_companies, validates NN-NNNNNNN format, indexes exact
-- workspace-scoped regulatory lookup, and protects writes via the existing
-- get_my_role()/get_my_workspace() role model.
--
-- Rollback notes:
--   drop trigger if exists trg_qrm_companies_guard_ein on public.qrm_companies;
--   drop function if exists public.qrm_companies_guard_ein_write();
--   recreate public.crm_companies without ein / ein_masked if rolling this back.
--   drop function if exists public.mask_customer_ein(text);
--   drop function if exists public.qrm_can_access_customer_ein();
--   drop index if exists public.idx_qrm_companies_workspace_ein;
--   alter table public.qrm_companies drop constraint if exists qrm_companies_ein_format_chk;
--   alter table public.qrm_companies drop column if exists ein;

alter table public.qrm_companies add column ein text;

alter table public.qrm_companies add constraint qrm_companies_ein_format_chk
  check (ein is null or ein ~ '^\d{2}-\d{7}$');

create index idx_qrm_companies_workspace_ein
  on public.qrm_companies (workspace_id, ein)
  where ein is not null;

comment on column public.qrm_companies.ein is
  'Federal EIN (NN-NNNNNNN). Required for 1099 issuance, AvaTax exemption substantiation, OFAC screening.';

comment on index public.idx_qrm_companies_workspace_ein is
  'Purpose: exact workspace-scoped EIN lookup for 1099/AvaTax/OFAC identity checks; excludes customers without EIN.';

create or replace function public.qrm_can_access_customer_ein()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Keep this aligned to public.user_role. As of Wave 0 the enum supports
  -- rep/admin/manager/owner plus client_stakeholder; there is no finance role.
  select auth.role() = 'service_role'
    or coalesce(public.get_my_role()::text, '') in ('admin', 'manager', 'owner');
$$;

comment on function public.qrm_can_access_customer_ein() is
  'Returns true for service callers and elevated QEP roles (admin, manager, owner) allowed to view/write customer EIN. Finance is not a public.user_role value in Wave 0.';

revoke execute on function public.qrm_can_access_customer_ein() from public;
grant execute on function public.qrm_can_access_customer_ein() to authenticated, service_role;

create or replace function public.mask_customer_ein(p_ein text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_ein is null then null
    when public.qrm_can_access_customer_ein() then p_ein
    else '••-•••' || right(regexp_replace(p_ein, '\D', '', 'g'), 4)
  end;
$$;

comment on function public.mask_customer_ein(text) is
  'Masks customer EIN to last four digits unless qrm_can_access_customer_ein() permits full access.';

revoke execute on function public.mask_customer_ein(text) from public;
grant execute on function public.mask_customer_ein(text) to authenticated, service_role;

-- Keep the public CRM compatibility view masked. Direct qrm_companies access is
-- limited by existing RLS to elevated roles/service; rep-facing CRM reads should
-- consume this masked projection instead of the raw regulatory identifier.
create or replace view public.crm_companies
  with (security_invoker = true)
  as
  select
    id,
    workspace_id,
    name,
    parent_company_id,
    assigned_rep_id,
    hubspot_company_id,
    address_line_1,
    address_line_2,
    city,
    state,
    postal_code,
    country,
    metadata,
    created_at,
    updated_at,
    deleted_at,
    legal_name,
    dba,
    phone,
    website,
    classification,
    territory_code,
    county,
    status,
    notes,
    search_1,
    search_2,
    public.mask_customer_ein(ein) as ein,
    (ein is not null and not public.qrm_can_access_customer_ein()) as ein_masked
  from public.qrm_companies;

comment on view public.crm_companies is
  'CRM company compatibility view. Federal EIN is role-masked via mask_customer_ein; raw qrm_companies.ein is not exposed here.';

create or replace function public.qrm_companies_guard_ein_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.ein is not null)
    or (tg_op = 'UPDATE' and new.ein is distinct from old.ein) then
    if not public.qrm_can_access_customer_ein() then
      raise exception 'FORBIDDEN_CUSTOMER_EIN_WRITE'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.qrm_companies_guard_ein_write() is
  'Blocks non-elevated roles from inserting or changing qrm_companies.ein, including direct table writes.';

revoke execute on function public.qrm_companies_guard_ein_write() from public;

drop trigger if exists trg_qrm_companies_guard_ein on public.qrm_companies;
create trigger trg_qrm_companies_guard_ein
  before insert or update of ein on public.qrm_companies
  for each row
  execute function public.qrm_companies_guard_ein_write();

-- Recreate Account 360 so Customer Profile Details receives only the
-- caller-appropriate EIN representation. The RPC remains SECURITY INVOKER and
-- RLS-scoped; the payload overlays `ein` with the masked value and adds an
-- explicit `ein_masked` flag for the UI.
create or replace function public.get_account_360(p_company_id uuid)
returns json
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_company jsonb;
  v_profile json;
  v_fleet json;
  v_quotes json;
  v_service json;
  v_parts json;
  v_invoices json;
  v_health json;
  v_ar_block json;
begin
  select to_jsonb(c) || jsonb_build_object(
      'ein', public.mask_customer_ein(c.ein),
      'ein_masked', (c.ein is not null and not public.qrm_can_access_customer_ein())
    ) into v_company
    from public.qrm_companies c
    where c.id = p_company_id;

  if v_company is null then
    return null;
  end if;

  select to_json(cpe.*) into v_profile
    from public.customer_profiles_extended cpe
    where cpe.crm_company_id = p_company_id
    limit 1;

  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_fleet
    from (
      select e.id, e.name, e.make, e.model, e.year, e.engine_hours,
             e.serial_number, e.asset_tag, e.metadata, e.updated_at,
             esc.stage_label, esc.eta, esc.last_updated as stage_updated
        from public.qrm_equipment e
        left join public.equipment_status_canonical esc on esc.equipment_id = e.id
        where e.company_id = p_company_id
          and e.deleted_at is null
        order by e.updated_at desc
        limit 50
    ) e;

  select coalesce(json_agg(row_to_json(q)), '[]'::json) into v_quotes
    from (
      select q.id, q.deal_id, q.status, q.net_total, q.expires_at, q.created_at,
             d.name as deal_name
        from public.quote_packages q
        join public.qrm_deals d on d.id = q.deal_id
        where d.company_id = p_company_id
          and q.status in ('draft', 'sent', 'negotiating')
        order by q.expires_at asc nulls last
        limit 25
    ) q;

  select coalesce(json_agg(row_to_json(sj)), '[]'::json) into v_service
    from (
      select sj.id, sj.current_stage::text as current_stage,
             sj.customer_problem_summary, sj.scheduled_start_at, sj.scheduled_end_at,
             sj.closed_at as completed_at, sj.machine_id
        from public.service_jobs sj
        where sj.customer_id = p_company_id
        order by sj.created_at desc
        limit 25
    ) sj;

  select json_build_object(
    'lifetime_total', coalesce(sum(po.total), 0),
    'order_count', count(*),
    'recent', coalesce((
      select json_agg(row_to_json(r))
      from (
        select po2.id, po2.status, po2.total, po2.created_at
        from public.parts_orders po2
        join public.portal_customers pc on pc.id = po2.portal_customer_id
        where pc.crm_company_id = p_company_id
        order by po2.created_at desc
        limit 10
      ) r
    ), '[]'::json)
  ) into v_parts
  from public.parts_orders po
  join public.portal_customers pc on pc.id = po.portal_customer_id
  where pc.crm_company_id = p_company_id;

  select coalesce(json_agg(row_to_json(ci)), '[]'::json) into v_invoices
    from (
      select ci.id, ci.invoice_number, ci.invoice_date, ci.due_date,
             ci.total, ci.amount_paid, ci.balance_due, ci.status
        from public.customer_invoices ci
        where ci.crm_company_id = p_company_id
          and ci.status in ('pending', 'sent', 'viewed', 'partial', 'overdue')
        order by ci.due_date asc
        limit 25
    ) ci;

  begin
    select public.get_health_score_with_deltas((v_profile->>'id')::uuid) into v_health;
  exception when others then
    v_health := null;
  end;

  select to_json(b.*) into v_ar_block
    from public.ar_credit_blocks b
    where b.company_id = p_company_id
      and b.status = 'active'
    limit 1;

  return json_build_object(
    'company',       v_company,
    'profile',       v_profile,
    'fleet',         v_fleet,
    'open_quotes',   v_quotes,
    'service',       v_service,
    'parts',         v_parts,
    'invoices',      v_invoices,
    'health',        v_health,
    'ar_block',      v_ar_block
  );
end;
$function$;

comment on function public.get_account_360(uuid) is
  'Single round-trip Account 360 payload with role-masked customer EIN in company.ein and company.ein_masked.';
