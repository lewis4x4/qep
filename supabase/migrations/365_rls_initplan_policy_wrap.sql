-- ============================================================================
-- Migration 365: Wrap RLS auth helper calls in initplan-safe selects
--
-- Supabase Performance Advisor flags many public-schema policies for
-- re-evaluating auth/session helpers per row:
--   - public.get_my_workspace()
--   - public.get_my_role()
--   - public.get_my_audience()
--   - auth.uid()
--   - auth.role()
--
-- The recommended fix is syntactic, not semantic:
--   helper()         -> (select helper())
--
-- Rather than editing hundreds of historical migration statements, this
-- migration rewrites the live policy catalog in-place. It preserves policy
-- names, command, permissive/restrictive mode, roles, USING, and WITH CHECK.
-- ============================================================================

create or replace function public._qep_wrap_rls_initplan_expr(expr text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := expr;
begin
  if v is null then
    return null;
  end if;

  -- Preserve already-wrapped forms so repeated runs stay idempotent.
  v := replace(v, '(select public.get_my_workspace())', '__QEP_GMW__');
  v := replace(v, '(select public.get_my_role())', '__QEP_GMR__');
  v := replace(v, '(select public.get_my_audience())', '__QEP_GMA__');
  v := replace(v, '(select auth.uid())', '__QEP_AUTH_UID__');
  v := replace(v, '(select auth.role())', '__QEP_AUTH_ROLE__');

  -- Replace raw helper calls with initplan-safe forms.
  v := replace(v, 'public.get_my_workspace()', '(select public.get_my_workspace())');
  v := replace(v, 'public.get_my_role()', '(select public.get_my_role())');
  v := replace(v, 'public.get_my_audience()', '(select public.get_my_audience())');
  v := replace(v, 'auth.uid()', '(select auth.uid())');
  v := replace(v, 'auth.role()', '(select auth.role())');

  -- Restore the preserved wrapped forms.
  v := replace(v, '__QEP_GMW__', '(select public.get_my_workspace())');
  v := replace(v, '__QEP_GMR__', '(select public.get_my_role())');
  v := replace(v, '__QEP_GMA__', '(select public.get_my_audience())');
  v := replace(v, '__QEP_AUTH_UID__', '(select auth.uid())');
  v := replace(v, '__QEP_AUTH_ROLE__', '(select auth.role())');

  return v;
end;
$$;

create or replace function public._qep_refresh_initplan_safe_policies()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_row record;
  roles_clause text;
  roles_sql text;
  new_qual text;
  new_with_check text;
  changed_count integer := 0;
begin
  for policy_row in
    select
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%public.get_my_workspace()%'
        or coalesce(qual, '') like '%public.get_my_role()%'
        or coalesce(qual, '') like '%public.get_my_audience()%'
        or coalesce(qual, '') like '%auth.uid()%'
        or coalesce(qual, '') like '%auth.role()%'
        or coalesce(with_check, '') like '%public.get_my_workspace()%'
        or coalesce(with_check, '') like '%public.get_my_role()%'
        or coalesce(with_check, '') like '%public.get_my_audience()%'
        or coalesce(with_check, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.role()%'
      )
  loop
    new_qual := public._qep_wrap_rls_initplan_expr(policy_row.qual);
    new_with_check := public._qep_wrap_rls_initplan_expr(policy_row.with_check);

    if new_qual is not distinct from policy_row.qual
       and new_with_check is not distinct from policy_row.with_check
    then
      continue;
    end if;

    if policy_row.roles is not null and array_length(policy_row.roles, 1) > 0 then
      select string_agg(format('%I', role_name), ', ')
      into roles_sql
      from unnest(policy_row.roles) as role_name;
      roles_clause := format(' to %s', roles_sql);
    else
      roles_clause := '';
    end if;

    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    execute format(
      'create policy %I on %I.%I as %s for %s%s%s%s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      coalesce(policy_row.permissive, 'PERMISSIVE'),
      policy_row.cmd,
      roles_clause,
      case
        when new_qual is not null then format(' using (%s)', new_qual)
        else ''
      end,
      case
        when new_with_check is not null then format(' with check (%s)', new_with_check)
        else ''
      end
    );

    changed_count := changed_count + 1;
  end loop;

  return changed_count;
end;
$$;

do $$
declare
  changed integer;
begin
  changed := public._qep_refresh_initplan_safe_policies();
  raise notice 'qep initplan-safe policy rewrite updated % policies', changed;
end;
$$;

drop function if exists public._qep_refresh_initplan_safe_policies();
drop function if exists public._qep_wrap_rls_initplan_expr(text);
