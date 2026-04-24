-- 385_flare_dedupe_overload_schema_repair.sql
--
-- Migration 384 repaired the four-argument Flare dedupe RPC. The remote
-- catalog also still had the earlier three-argument overload, so repair that
-- signature with the same schema-qualified pg_trgm call.

create or replace function public.flare_dedupe_count(
  p_route text,
  p_description text,
  p_threshold real default 0.62
)
returns integer
language plpgsql
security definer
stable
set search_path = public, extensions, pg_temp
as $$
begin
  return (
    select count(*)::integer
    from public.flare_reports f
    where f.workspace_id = public.get_my_workspace()
      and f.created_at > now() - interval '7 days'
      and f.status <> 'duplicate'
      and (
        f.route = p_route
        or extensions.similarity(lower(coalesce(f.user_description, '')), lower(coalesce(p_description, ''))) >= p_threshold
      )
  );
exception
  when undefined_function then
    return (
      select count(*)::integer
      from public.flare_reports f
      where f.workspace_id = public.get_my_workspace()
        and f.created_at > now() - interval '7 days'
        and f.status <> 'duplicate'
        and f.route = p_route
    );
end;
$$;

revoke execute on function public.flare_dedupe_count(text, text, real) from public;
grant execute on function public.flare_dedupe_count(text, text, real) to authenticated, service_role;
