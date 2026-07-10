-- Migration 818: serialize customer email authorization with OEM requote flags.

begin;

create table public.quote_send_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  quote_package_version_id uuid not null references public.quote_package_versions(id) on delete restrict,
  document_artifact_id uuid not null references public.quote_document_artifacts(id) on delete restrict,
  actor_id uuid not null,
  status text not null default 'authorized' check (
    status in ('authorized', 'sent', 'failed', 'expired')
  ),
  expires_at timestamptz not null,
  error_detail text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_quote_send_authorizations_active
  on public.quote_send_authorizations (quote_package_id, expires_at)
  where status = 'authorized';

alter table public.quote_send_authorizations enable row level security;
revoke all on table public.quote_send_authorizations from public, anon, authenticated;
grant select on table public.quote_send_authorizations to service_role;

create function public.issue_quote_share_token_if_requote_resolved(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_candidate_token text,
  p_replace boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_packages%rowtype;
  v_token text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'issue_quote_share_token_if_requote_resolved requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_workspace_id), '') is null
     or p_quote_package_id is null
     or length(coalesce(p_candidate_token, '')) < 16 then
    raise exception 'workspace, quote, and candidate token are required'
      using errcode = '22023';
  end if;
  select * into v_quote
  from public.quote_packages quote
  where quote.id = p_quote_package_id
    and quote.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'quote share token is outside workspace'
      using errcode = '42501';
  end if;
  if v_quote.requires_requote then
    raise exception 'QUOTE_REQUIRES_REQUOTE: resolve OEM price impacts before sharing'
      using errcode = '55000';
  end if;
  v_token := case
    when not coalesce(p_replace, false)
      and length(coalesce(v_quote.share_token, '')) >= 16
      then v_quote.share_token
    else p_candidate_token
  end;
  update public.quote_packages
  set share_token = v_token,
      share_token_created_at = case
        when share_token is distinct from v_token then now()
        else share_token_created_at
      end,
      updated_at = now()
  where id = p_quote_package_id;
  return v_token;
end;
$$;

create function public.begin_quote_send_authorization(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_quote_package_version_id uuid,
  p_document_artifact_id uuid,
  p_actor_id uuid,
  p_ttl_seconds integer default 300
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_packages%rowtype;
  v_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'begin_quote_send_authorization requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_workspace_id), '') is null
     or p_quote_package_id is null or p_quote_package_version_id is null
     or p_document_artifact_id is null or p_actor_id is null then
    raise exception 'workspace, quote, version, artifact, and actor are required'
      using errcode = '22023';
  end if;

  select * into v_quote
  from public.quote_packages quote
  where quote.id = p_quote_package_id
    and quote.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'quote send authorization is outside workspace'
      using errcode = '42501';
  end if;
  if v_quote.requires_requote then
    raise exception 'QUOTE_REQUIRES_REQUOTE: resolve OEM price impacts before send'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.quote_package_versions version
    where version.id = p_quote_package_version_id
      and version.quote_package_id = p_quote_package_id
      and version.workspace_id = p_workspace_id
      and version.superseded_at is null
  ) then
    raise exception 'quote send authorization version is no longer current'
      using errcode = '40001';
  end if;
  if not exists (
    select 1
    from public.quote_document_artifacts artifact
    where artifact.id = p_document_artifact_id
      and artifact.workspace_id = p_workspace_id
      and artifact.quote_package_id = p_quote_package_id
      and artifact.quote_package_version_id = p_quote_package_version_id
      and artifact.artifact_type = 'customer_quote_pdf'
      and artifact.storage_provider = 'r2'
      and artifact.status = 'generated'
      and artifact.customer_visible_at is null
  ) then
    raise exception 'quote send authorization artifact is stale or invalid'
      using errcode = '40001';
  end if;

  update public.quote_send_authorizations as send_auth
  set status = 'expired', completed_at = now(),
      error_detail = 'authorization expired before completion'
  where send_auth.quote_package_id = p_quote_package_id
    and send_auth.status = 'authorized'
    and send_auth.expires_at <= now();

  if exists (
    select 1 from public.quote_send_authorizations send_auth
    where send_auth.quote_package_id = p_quote_package_id
      and send_auth.status = 'authorized'
      and send_auth.expires_at > now()
  ) then
    raise exception 'quote already has an active send authorization'
      using errcode = '55000';
  end if;

  insert into public.quote_send_authorizations (
    workspace_id, quote_package_id, quote_package_version_id,
    document_artifact_id, actor_id, expires_at
  ) values (
    p_workspace_id, p_quote_package_id, p_quote_package_version_id,
    p_document_artifact_id, p_actor_id,
    now() + pg_catalog.make_interval(
      secs => least(greatest(coalesce(p_ttl_seconds, 300), 60), 900)
    )
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.fail_quote_send_authorization(
  p_authorization_id uuid,
  p_error_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'fail_quote_send_authorization requires service_role'
      using errcode = '42501';
  end if;
  update public.quote_send_authorizations
  set status = 'failed', completed_at = now(),
      error_detail = left(coalesce(p_error_detail, 'send failed'), 2000)
  where id = p_authorization_id and status = 'authorized';
end;
$$;

create function public.guard_quote_requote_during_authorized_send()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requires_requote is true
     and old.requires_requote is distinct from true
     and exists (
       select 1
       from public.quote_send_authorizations send_auth
       where send_auth.quote_package_id = new.id
         and send_auth.workspace_id = new.workspace_id
         and send_auth.status = 'authorized'
         and send_auth.expires_at > now()
     ) then
    raise exception 'QUOTE_SEND_IN_PROGRESS: retry OEM publication after customer send completes'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

create trigger guard_quote_requote_during_authorized_send_trg
  before update of requires_requote on public.quote_packages
  for each row execute function public.guard_quote_requote_during_authorized_send();

alter function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb
) rename to quote_send_package_commit_v599;
revoke execute on function public.quote_send_package_commit_v599(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb
) from public, anon, authenticated, service_role;

create function public.quote_send_package_commit(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_sent_at timestamptz,
  p_document_artifact_id uuid,
  p_recipient text,
  p_subject text,
  p_message_body text,
  p_provider text,
  p_follow_up_at timestamptz,
  p_created_by uuid,
  p_metadata jsonb,
  p_send_authorization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'quote_send_package_commit requires service_role'
      using errcode = '42501';
  end if;

  perform 1
  from public.quote_packages quote
  where quote.id = p_quote_package_id
    and quote.workspace_id = p_workspace_id
    and quote.requires_requote is not true
  for update;
  if not found then
    raise exception 'QUOTE_REQUIRES_REQUOTE: customer send authorization is no longer valid'
      using errcode = '55000';
  end if;

  perform 1
  from public.quote_send_authorizations send_auth
  where send_auth.id = p_send_authorization_id
    and send_auth.workspace_id = p_workspace_id
    and send_auth.quote_package_id = p_quote_package_id
    and send_auth.document_artifact_id = p_document_artifact_id
    and send_auth.status = 'authorized'
    and send_auth.expires_at > now()
  for update;
  if not found then
    raise exception 'quote send authorization is missing, stale, or expired'
      using errcode = '55000';
  end if;

  v_delivery_id := public.quote_send_package_commit_v599(
    p_workspace_id, p_quote_package_id, p_sent_at,
    p_document_artifact_id, p_recipient, p_subject, p_message_body,
    p_provider, p_follow_up_at, p_created_by, p_metadata
  );

  update public.quote_send_authorizations
  set status = 'sent', completed_at = now(), error_detail = null
  where id = p_send_authorization_id and status = 'authorized';
  if not found then
    raise exception 'quote send authorization changed during delivery commit'
      using errcode = '40001';
  end if;
  return v_delivery_id;
end;
$$;

revoke all on function public.begin_quote_send_authorization(
  text, uuid, uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.issue_quote_share_token_if_requote_resolved(
  text, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function public.fail_quote_send_authorization(uuid, text)
  from public, anon, authenticated;
revoke all on function public.guard_quote_requote_during_authorized_send()
  from public, anon, authenticated, service_role;
revoke all on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.begin_quote_send_authorization(
  text, uuid, uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.issue_quote_share_token_if_requote_resolved(
  text, uuid, text, boolean
) to service_role;
grant execute on function public.fail_quote_send_authorization(uuid, text)
  to service_role;
grant execute on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb, uuid
) to service_role;

commit;
