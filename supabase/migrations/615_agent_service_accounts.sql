-- ============================================================================
-- 615 · Agent service accounts in Supabase Auth
--
-- D3.8 / QEP-102. Handoff §8 requires dedicated agent service accounts for
-- automation workflows. This migration adds non-secret profile metadata and
-- propagates service-account claims into auth.users.raw_app_meta_data so issued
-- Supabase JWTs can be distinguished from human users without relying on email
-- naming conventions.
-- ============================================================================

alter table public.profiles
  add column if not exists is_agent_service_account boolean not null default false,
  add column if not exists agent_service_key text,
  add column if not exists agent_service_purpose text,
  add column if not exists agent_service_config jsonb not null default '{}'::jsonb;

comment on column public.profiles.is_agent_service_account is
  'True for non-human Supabase Auth users reserved for automation agents.';
comment on column public.profiles.agent_service_key is
  'Stable non-secret automation account key, e.g. qep-pipeline-agent.';
comment on column public.profiles.agent_service_purpose is
  'Human-readable purpose for the service account; no secrets.';
comment on column public.profiles.agent_service_config is
  'Non-secret service-account metadata such as required env var names and allowed automation surface.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_agent_service_account_requires_key_chk'
  ) then
    alter table public.profiles
      add constraint profiles_agent_service_account_requires_key_chk
      check (
        is_agent_service_account = false
        or (agent_service_key is not null and length(trim(agent_service_key)) > 0 and email is not null)
      );
  end if;
end $$;

create unique index if not exists idx_profiles_agent_service_key
  on public.profiles(agent_service_key)
  where is_agent_service_account = true;

create index if not exists idx_profiles_agent_service_workspace
  on public.profiles(active_workspace_id, agent_service_key)
  where is_agent_service_account = true;

-- Replace the metadata sync trigger so service-account identity is carried into
-- newly issued Supabase Auth JWTs. Do not include secrets or password material.
create or replace function public.sync_profile_to_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and OLD.active_workspace_id is not distinct from NEW.active_workspace_id
     and OLD.iron_role is not distinct from NEW.iron_role
     and OLD.role is not distinct from NEW.role
     and OLD.is_agent_service_account is not distinct from NEW.is_agent_service_account
     and OLD.agent_service_key is not distinct from NEW.agent_service_key
  then
    return NEW;
  end if;

  begin
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object(
           'workspace_id', NEW.active_workspace_id,
           'iron_role', NEW.iron_role,
           'role', NEW.role::text,
           'account_kind', case when NEW.is_agent_service_account then 'agent_service' else 'human' end,
           'is_agent_service_account', NEW.is_agent_service_account,
           'agent_service_key', NEW.agent_service_key
         )
    where id = NEW.id;
  exception
    when others then
      raise log 'sync_profile_to_auth_metadata: failed for %: %', NEW.id, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists sync_profile_to_auth_metadata on public.profiles;
create trigger sync_profile_to_auth_metadata
  after insert or update of active_workspace_id, iron_role, role, is_agent_service_account, agent_service_key on public.profiles
  for each row
  execute function public.sync_profile_to_auth_metadata();

notify pgrst, 'reload schema';
