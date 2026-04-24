-- 386_flare_dedupe_canonical_signatures.sql
--
-- Restore the canonical Flare RPC signatures used by PostgREST and remove the
-- temporary real-typed overloads from migrations 384/385. The live API sends
-- named JSON parameters; keeping only the original numeric signatures avoids
-- overload ambiguity while schema-qualifying pg_trgm calls.

drop function if exists public.flare_dedupe_count(text, text, text, real);
drop function if exists public.flare_dedupe_count(text, text, real);

create or replace function public.flare_dedupe_count(
  p_route text,
  p_description text,
  p_threshold numeric default 0.4
)
returns integer
language plpgsql
security invoker
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_count integer;
begin
  select count(*)::integer
  into v_count
  from public.flare_reports f
  where f.workspace_id = public.get_my_workspace()
    and f.created_at > now() - interval '7 days'
    and f.status <> 'duplicate'
    and (
      f.route = p_route
      or extensions.similarity(lower(coalesce(f.user_description, '')), lower(coalesce(p_description, ''))) >= p_threshold::real
    );

  return coalesce(v_count, 0);
exception
  when undefined_function then
    select count(*)::integer
    into v_count
    from public.flare_reports f
    where f.workspace_id = public.get_my_workspace()
      and f.created_at > now() - interval '7 days'
      and f.status <> 'duplicate'
      and f.route = p_route;

    return coalesce(v_count, 0);
end;
$$;

create or replace function public.flare_dedupe_count(
  p_route text,
  p_description text,
  p_threshold numeric default 0.4,
  p_first_error text default null
)
returns integer
language plpgsql
security invoker
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_count integer;
begin
  select count(*)::integer
  into v_count
  from public.flare_reports f
  where f.workspace_id = public.get_my_workspace()
    and f.created_at > now() - interval '7 days'
    and f.status <> 'duplicate'
    and (
      f.route = p_route
      or extensions.similarity(lower(coalesce(f.user_description, '')), lower(coalesce(p_description, ''))) >= p_threshold::real
      or (
        p_first_error is not null
        and jsonb_array_length(coalesce(f.console_errors, '[]'::jsonb)) > 0
        and extensions.similarity(
          lower(coalesce((f.console_errors -> 0 ->> 'message'), '')),
          lower(p_first_error)
        ) >= p_threshold::real
      )
    );

  return coalesce(v_count, 0);
exception
  when undefined_function then
    select count(*)::integer
    into v_count
    from public.flare_reports f
    where f.workspace_id = public.get_my_workspace()
      and f.created_at > now() - interval '7 days'
      and f.status <> 'duplicate'
      and f.route = p_route;

    return coalesce(v_count, 0);
end;
$$;

comment on function public.flare_dedupe_count(text, text, numeric) is
  'Fuzzy dedupe count over the last 7 days. Matches exact route or pg_trgm similarity on user_description.';

comment on function public.flare_dedupe_count(text, text, numeric, text) is
  'Fuzzy dedupe count over the last 7 days. Matches exact route, user_description similarity, or first console_error message similarity.';

revoke execute on function public.flare_dedupe_count(text, text, numeric) from public;
revoke execute on function public.flare_dedupe_count(text, text, numeric, text) from public;
grant execute on function public.flare_dedupe_count(text, text, numeric) to authenticated, service_role;
grant execute on function public.flare_dedupe_count(text, text, numeric, text) to authenticated, service_role;
