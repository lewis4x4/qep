-- DATA-001: preferences updates must not grant the caller new authority.
-- Rollback: DROP TRIGGER profiles_authority_guard ON public.profiles;
-- DROP FUNCTION public.guard_profile_authority_change();
begin;

create or replace function public.guard_profile_authority_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  field text;
  authority_changed boolean := false;
begin
  foreach field in array array[
    'role', 'is_support', 'iron_role', 'iron_role_display',
    'audience', 'stakeholder_subrole',
    'is_agent_service_account', 'agent_service_key'
  ] loop
    if (to_jsonb(new) -> field) is distinct from (to_jsonb(old) -> field) then
      authority_changed := true;
      exit;
    end if;
  end loop;
  if not authority_changed then return new; end if;

  -- Service endpoints already authenticate/authorize their actor. SQL migrations
  -- without a JWT remain available to the actual database administrator.
  if (select auth.role()) = 'service_role'
     or ((select auth.uid()) is null and session_user in ('postgres', 'supabase_admin'))
     or ((select auth.uid()) is not null and (select public.get_my_role())::text = 'owner')
  then
    return new;
  end if;
  raise exception 'Only an owner can change profile authority'
    using errcode = '42501';
end;
$$;

revoke all on function public.guard_profile_authority_change() from public, anon, authenticated;
drop trigger if exists profiles_authority_guard on public.profiles;
-- Run before the existing role synchronization triggers.
create trigger profiles_authority_guard before update on public.profiles
for each row execute function public.guard_profile_authority_change();
comment on function public.guard_profile_authority_change() is
  'DATA-001: database backstop for protected profile roles, audiences and service-account identity; own preferences remain editable.';
commit;
