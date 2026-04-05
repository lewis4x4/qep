-- ============================================================================
-- Migration 120: Staff search for portal parts orders (fulfillment link UX)
--
-- Server-side filter by order id fragment, customer email, or name — avoids
-- client-side "last 200 rows" scans. Enforces workspace + staff role via
-- get_my_workspace() / get_my_role().
-- ============================================================================

create or replace function public.search_parts_orders_for_link(p_workspace text, p_term text)
returns table (
  id uuid,
  status text,
  fulfillment_run_id uuid,
  created_at timestamptz,
  customer_first_name text,
  customer_last_name text,
  customer_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_term text;
  v_like text;
begin
  v_term := trim(coalesce(p_term, ''));
  v_term := replace(replace(replace(v_term, '%', ''), '_', ''), '''', '');
  if length(v_term) < 2 then
    return;
  end if;

  if p_workspace is distinct from public.get_my_workspace() then
    return;
  end if;

  if public.get_my_role() not in ('rep', 'admin', 'manager', 'owner') then
    return;
  end if;

  v_like := '%' || v_term || '%';

  return query
  select
    po.id,
    po.status,
    po.fulfillment_run_id,
    po.created_at,
    pc.first_name,
    pc.last_name,
    pc.email
  from public.parts_orders po
  join public.portal_customers pc on pc.id = po.portal_customer_id
  where po.workspace_id = p_workspace
    and (
      po.id::text ilike v_like
      or lower(pc.email) like lower(v_like)
      or lower(pc.first_name) like lower(v_like)
      or lower(pc.last_name) like lower(v_like)
      or lower(coalesce(pc.first_name, '') || ' ' || coalesce(pc.last_name, '')) like lower(v_like)
    )
  order by po.created_at desc
  limit 25;
end;
$$;

comment on function public.search_parts_orders_for_link(text, text) is
  'Staff: search parts_orders in a workspace by id fragment or portal customer email/name; used by service-job-router.';

revoke all on function public.search_parts_orders_for_link(text, text) from public;
grant execute on function public.search_parts_orders_for_link(text, text) to authenticated;
