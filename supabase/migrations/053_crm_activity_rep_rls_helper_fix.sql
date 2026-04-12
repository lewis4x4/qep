create or replace function public.crm_rep_can_access_contact(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_contacts c
    where c.id = p_contact_id
      and c.workspace_id = public.get_my_workspace()
      and c.deleted_at is null
      and (
        c.assigned_rep_id = auth.uid()
        or exists (
          select 1
          from public.crm_contact_territories ct
          join public.crm_territories t on t.id = ct.territory_id
          where ct.contact_id = c.id
            and ct.workspace_id = public.get_my_workspace()
            and t.workspace_id = public.get_my_workspace()
            and t.deleted_at is null
            and t.assigned_rep_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.crm_rep_can_access_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_companies c
    where c.id = p_company_id
      and c.workspace_id = public.get_my_workspace()
      and c.deleted_at is null
      and (
        c.assigned_rep_id = auth.uid()
        or exists (
          select 1
          from public.crm_contact_companies cc
          where cc.company_id = c.id
            and cc.workspace_id = public.get_my_workspace()
            and public.crm_rep_can_access_contact(cc.contact_id)
        )
      )
  );
$$;

create or replace function public.crm_rep_can_access_deal(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_deals d
    where d.id = p_deal_id
      and d.workspace_id = public.get_my_workspace()
      and d.deleted_at is null
      and (
        d.assigned_rep_id = auth.uid()
        or (d.primary_contact_id is not null and public.crm_rep_can_access_contact(d.primary_contact_id))
        or (d.company_id is not null and public.crm_rep_can_access_company(d.company_id))
      )
  );
$$;

create or replace function public.crm_rep_can_access_activity(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_activities a
    where a.id = p_activity_id
      and a.workspace_id = public.get_my_workspace()
      and a.deleted_at is null
      and (
        (a.contact_id is not null and public.crm_rep_can_access_contact(a.contact_id))
        or (a.company_id is not null and public.crm_rep_can_access_company(a.company_id))
        or (a.deal_id is not null and public.crm_rep_can_access_deal(a.deal_id))
      )
  );
$$;

revoke execute on function public.crm_rep_can_access_contact(uuid) from public;
revoke execute on function public.crm_rep_can_access_company(uuid) from public;
revoke execute on function public.crm_rep_can_access_deal(uuid) from public;
revoke execute on function public.crm_rep_can_access_activity(uuid) from public;

grant execute on function public.crm_rep_can_access_contact(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_company(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_deal(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_activity(uuid) to authenticated;

-- Rollback (manual):
-- Re-apply the previous non-SECURITY DEFINER definitions from
-- `supabase/migrations/021_crm_core.sql` if needed.
