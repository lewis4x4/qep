-- VC-4 workspace-scoped speaker label suggestions and explicit assignment RPCs.
--
-- Privacy contract:
-- - Suggestions belong to the same workspace as their parent voice_captures row.
-- - Edge/service writers may create/update suggestions only; confirmed/rejected
--   assignments require authenticated user RPC calls.
-- - Audit rows record suggestion and explicit user decision events.

begin;

create table if not exists public.voice_capture_speaker_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  voice_capture_id uuid not null references public.voice_captures(id) on delete cascade,
  speaker_key text not null,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  suggested_display_name text,
  suggested_entity_type text check (suggested_entity_type is null or suggested_entity_type in ('user', 'contact', 'company', 'freeform')),
  suggested_entity_id uuid,
  suggestion_source text not null check (suggestion_source in ('recorder_profile', 'linked_contact', 'linked_company', 'extracted_contact', 'manual_user', 'system_context')),
  suggestion_confidence numeric(4,3) check (suggestion_confidence is null or (suggestion_confidence >= 0 and suggestion_confidence <= 1)),
  assigned_display_name text,
  assigned_entity_type text check (assigned_entity_type is null or assigned_entity_type in ('user', 'contact', 'company', 'freeform')),
  assigned_entity_id uuid,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint voice_capture_speaker_labels_workspace_capture_key_unique
    unique (workspace_id, voice_capture_id, speaker_key),
  constraint voice_capture_speaker_labels_status_shape check (
    (
      status = 'suggested'
      and assigned_by is null
      and assigned_at is null
      and rejected_by is null
      and rejected_at is null
    )
    or (
      status = 'confirmed'
      and nullif(btrim(assigned_display_name), '') is not null
      and assigned_by is not null
      and assigned_at is not null
      and rejected_by is null
      and rejected_at is null
    )
    or (
      status = 'rejected'
      and assigned_by is null
      and assigned_at is null
      and rejected_by is not null
      and rejected_at is not null
    )
  )
);

comment on table public.voice_capture_speaker_labels is
  'Workspace-scoped speaker label suggestions for voice captures. Rows remain suggestions until a user explicitly confirms or rejects them through RPCs.';
comment on column public.voice_capture_speaker_labels.speaker_key is
  'Stable non-biometric speaker slot such as speaker_1, rep, or customer. Does not store voiceprints, fingerprints, embeddings, or waveform features.';
comment on column public.voice_capture_speaker_labels.status is
  'suggested rows are recommendations only; confirmed/rejected states require explicit user RPC calls and audit entries.';

create table if not exists public.voice_capture_speaker_label_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  label_id uuid not null,
  voice_capture_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('suggestion_created', 'suggestion_updated', 'assignment_confirmed', 'assignment_rejected')),
  old_value jsonb,
  new_value jsonb not null,
  occurred_at timestamptz not null default now()
);

comment on table public.voice_capture_speaker_label_audit is
  'Append-only audit trail for speaker label suggestions and explicit user confirmations/rejections.';

create index if not exists idx_voice_capture_speaker_labels_capture
  on public.voice_capture_speaker_labels(voice_capture_id, status, speaker_key);
create index if not exists idx_voice_capture_speaker_labels_workspace
  on public.voice_capture_speaker_labels(workspace_id, created_at desc);
create index if not exists idx_voice_capture_speaker_label_audit_label
  on public.voice_capture_speaker_label_audit(label_id, occurred_at desc);
create index if not exists idx_voice_capture_speaker_label_audit_capture
  on public.voice_capture_speaker_label_audit(workspace_id, voice_capture_id, occurred_at desc);

create or replace function public.touch_voice_capture_speaker_label_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_voice_capture_speaker_labels_updated_at on public.voice_capture_speaker_labels;
create trigger trg_voice_capture_speaker_labels_updated_at
  before update on public.voice_capture_speaker_labels
  for each row execute function public.touch_voice_capture_speaker_label_updated_at();

create or replace function public.enforce_voice_capture_speaker_label_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_workspace_id text;
begin
  select vc.workspace_id into v_parent_workspace_id
  from public.voice_captures vc
  where vc.id = new.voice_capture_id;

  if v_parent_workspace_id is null then
    raise exception 'voice capture % has no verified workspace', new.voice_capture_id
      using errcode = '23514';
  end if;

  if new.workspace_id is distinct from v_parent_workspace_id then
    raise exception 'speaker label workspace must match parent voice capture workspace'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_voice_capture_speaker_labels_workspace on public.voice_capture_speaker_labels;
create trigger trg_voice_capture_speaker_labels_workspace
  before insert or update of workspace_id, voice_capture_id
  on public.voice_capture_speaker_labels
  for each row execute function public.enforce_voice_capture_speaker_label_workspace();

create or replace function public.audit_voice_capture_speaker_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_event_type := case new.status
      when 'confirmed' then 'assignment_confirmed'
      when 'rejected' then 'assignment_rejected'
      else 'suggestion_created'
    end;
    v_actor := coalesce(new.assigned_by, new.rejected_by, new.created_by, auth.uid());

    insert into public.voice_capture_speaker_label_audit (
      workspace_id,
      label_id,
      voice_capture_id,
      actor_user_id,
      event_type,
      old_value,
      new_value
    ) values (
      new.workspace_id,
      new.id,
      new.voice_capture_id,
      v_actor,
      v_event_type,
      null,
      to_jsonb(new)
    );
    return new;
  end if;

  if old.status = 'suggested' and new.status = 'confirmed' then
    v_event_type := 'assignment_confirmed';
    v_actor := coalesce(new.assigned_by, auth.uid());
  elsif old.status = 'suggested' and new.status = 'rejected' then
    v_event_type := 'assignment_rejected';
    v_actor := coalesce(new.rejected_by, auth.uid());
  elsif new.status = 'suggested' then
    v_event_type := 'suggestion_updated';
    v_actor := coalesce(new.created_by, auth.uid());
  else
    return new;
  end if;

  insert into public.voice_capture_speaker_label_audit (
    workspace_id,
    label_id,
    voice_capture_id,
    actor_user_id,
    event_type,
    old_value,
    new_value
  ) values (
    new.workspace_id,
    new.id,
    new.voice_capture_id,
    v_actor,
    v_event_type,
    to_jsonb(old),
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists trg_voice_capture_speaker_labels_audit on public.voice_capture_speaker_labels;
create trigger trg_voice_capture_speaker_labels_audit
  after insert or update on public.voice_capture_speaker_labels
  for each row execute function public.audit_voice_capture_speaker_label();

create or replace function public.prevent_service_role_speaker_label_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Service/edge writers are allowed to create or refresh suggestions only.
  -- Confirmed/rejected assignments require an authenticated user RPC call so
  -- labels cannot be silently assigned by background automation.
  if (select auth.role()) = 'service_role' and new.status <> 'suggested' then
    raise exception 'SERVICE_ROLE_SPEAKER_LABEL_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and (select auth.role()) = 'service_role'
    and old.status <> 'suggested' then
    raise exception 'SERVICE_ROLE_SPEAKER_LABEL_DECISION_REFRESH_FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_voice_capture_speaker_labels_service_role_guard on public.voice_capture_speaker_labels;
create trigger trg_voice_capture_speaker_labels_service_role_guard
  before insert or update on public.voice_capture_speaker_labels
  for each row execute function public.prevent_service_role_speaker_label_assignment();

alter table public.voice_capture_speaker_labels enable row level security;
alter table public.voice_capture_speaker_label_audit enable row level security;

drop policy if exists "voice_capture_speaker_labels_service_all" on public.voice_capture_speaker_labels;
create policy "voice_capture_speaker_labels_service_all"
  on public.voice_capture_speaker_labels for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "voice_capture_speaker_labels_select" on public.voice_capture_speaker_labels;
create policy "voice_capture_speaker_labels_select"
  on public.voice_capture_speaker_labels for select
  using (
    exists (
      select 1
      from public.voice_captures vc
      where vc.id = voice_capture_speaker_labels.voice_capture_id
        and vc.workspace_id = voice_capture_speaker_labels.workspace_id
        and voice_capture_speaker_labels.workspace_id = (select public.get_my_workspace())
        and (
          vc.user_id = (select auth.uid())
          or (select public.get_my_role()) in ('admin', 'manager', 'owner')
        )
    )
  );

drop policy if exists "voice_capture_speaker_label_audit_service_all" on public.voice_capture_speaker_label_audit;
create policy "voice_capture_speaker_label_audit_service_all"
  on public.voice_capture_speaker_label_audit for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "voice_capture_speaker_label_audit_select" on public.voice_capture_speaker_label_audit;
create policy "voice_capture_speaker_label_audit_select"
  on public.voice_capture_speaker_label_audit for select
  using (
    exists (
      select 1
      from public.voice_captures vc
      where vc.id = voice_capture_speaker_label_audit.voice_capture_id
        and vc.workspace_id = voice_capture_speaker_label_audit.workspace_id
        and voice_capture_speaker_label_audit.workspace_id = (select public.get_my_workspace())
        and (
          vc.user_id = (select auth.uid())
          or (select public.get_my_role()) in ('admin', 'manager', 'owner')
        )
    )
  );

create or replace function public.confirm_voice_capture_speaker_label(
  p_label_id uuid,
  p_display_name text default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns public.voice_capture_speaker_labels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id text := public.get_my_workspace();
  v_role text := public.get_my_role()::text;
  v_label public.voice_capture_speaker_labels%rowtype;
  v_capture public.voice_captures%rowtype;
  v_display_name text;
  v_entity_type text;
  v_entity_id uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_label
  from public.voice_capture_speaker_labels
  where id = p_label_id
  for update;

  if not found then
    raise exception 'SPEAKER_LABEL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_capture
  from public.voice_captures
  where id = v_label.voice_capture_id;

  if not found or v_capture.workspace_id is distinct from v_label.workspace_id then
    raise exception 'SPEAKER_LABEL_CAPTURE_SCOPE_INVALID' using errcode = '42501';
  end if;

  if v_workspace_id is null or v_label.workspace_id is distinct from v_workspace_id then
    raise exception 'FORBIDDEN_WORKSPACE' using errcode = '42501';
  end if;

  if not (v_capture.user_id = v_actor or v_role in ('admin', 'manager', 'owner')) then
    raise exception 'FORBIDDEN_CAPTURE' using errcode = '42501';
  end if;

  if v_label.status <> 'suggested' then
    raise exception 'LABEL_NOT_SUGGESTED' using errcode = '23514';
  end if;

  v_display_name := nullif(btrim(coalesce(p_display_name, v_label.suggested_display_name, '')), '');
  if v_display_name is null then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '23514';
  end if;

  v_entity_type := nullif(btrim(coalesce(p_entity_type, v_label.suggested_entity_type, '')), '');
  if v_entity_type is not null and v_entity_type not in ('user', 'contact', 'company', 'freeform') then
    raise exception 'INVALID_ENTITY_TYPE' using errcode = '23514';
  end if;

  v_entity_id := coalesce(p_entity_id, v_label.suggested_entity_id);

  if v_entity_type is null and v_entity_id is not null then
    raise exception 'ENTITY_TYPE_REQUIRED' using errcode = '23514';
  end if;

  if v_entity_type = 'freeform' and v_entity_id is not null then
    raise exception 'FREEFORM_ENTITY_ID_NOT_ALLOWED' using errcode = '23514';
  end if;

  if v_entity_type = 'user' and v_entity_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = v_entity_id
      and p.active_workspace_id = v_label.workspace_id
    union
    select 1
    from public.profile_workspaces pw
    where pw.profile_id = v_entity_id
      and pw.workspace_id = v_label.workspace_id
  ) then
    raise exception 'ENTITY_WORKSPACE_MISMATCH' using errcode = '42501';
  end if;

  if v_entity_type = 'contact' and v_entity_id is not null and not exists (
    select 1
    from public.crm_contacts c
    where c.id = v_entity_id
      and c.workspace_id = v_label.workspace_id
      and c.deleted_at is null
  ) then
    raise exception 'ENTITY_WORKSPACE_MISMATCH' using errcode = '42501';
  end if;

  if v_entity_type = 'company' and v_entity_id is not null and not exists (
    select 1
    from public.crm_companies c
    where c.id = v_entity_id
      and c.workspace_id = v_label.workspace_id
      and c.deleted_at is null
  ) then
    raise exception 'ENTITY_WORKSPACE_MISMATCH' using errcode = '42501';
  end if;

  update public.voice_capture_speaker_labels
  set
    status = 'confirmed',
    assigned_display_name = v_display_name,
    assigned_entity_type = v_entity_type,
    assigned_entity_id = v_entity_id,
    assigned_by = v_actor,
    assigned_at = now(),
    rejected_by = null,
    rejected_at = null
  where id = p_label_id
  returning * into v_label;

  return v_label;
end;
$$;

create or replace function public.reject_voice_capture_speaker_label(p_label_id uuid)
returns public.voice_capture_speaker_labels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id text := public.get_my_workspace();
  v_role text := public.get_my_role()::text;
  v_label public.voice_capture_speaker_labels%rowtype;
  v_capture public.voice_captures%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_label
  from public.voice_capture_speaker_labels
  where id = p_label_id
  for update;

  if not found then
    raise exception 'SPEAKER_LABEL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_capture
  from public.voice_captures
  where id = v_label.voice_capture_id;

  if not found or v_capture.workspace_id is distinct from v_label.workspace_id then
    raise exception 'SPEAKER_LABEL_CAPTURE_SCOPE_INVALID' using errcode = '42501';
  end if;

  if v_workspace_id is null or v_label.workspace_id is distinct from v_workspace_id then
    raise exception 'FORBIDDEN_WORKSPACE' using errcode = '42501';
  end if;

  if not (v_capture.user_id = v_actor or v_role in ('admin', 'manager', 'owner')) then
    raise exception 'FORBIDDEN_CAPTURE' using errcode = '42501';
  end if;

  if v_label.status <> 'suggested' then
    raise exception 'LABEL_NOT_SUGGESTED' using errcode = '23514';
  end if;

  update public.voice_capture_speaker_labels
  set
    status = 'rejected',
    assigned_display_name = null,
    assigned_entity_type = null,
    assigned_entity_id = null,
    assigned_by = null,
    assigned_at = null,
    rejected_by = v_actor,
    rejected_at = now()
  where id = p_label_id
  returning * into v_label;

  return v_label;
end;
$$;

revoke all on public.voice_capture_speaker_labels from anon, authenticated;
revoke all on public.voice_capture_speaker_label_audit from anon, authenticated;
grant select on public.voice_capture_speaker_labels to authenticated;
grant select on public.voice_capture_speaker_label_audit to authenticated;
grant all on public.voice_capture_speaker_labels to service_role;
grant all on public.voice_capture_speaker_label_audit to service_role;

revoke execute on function public.confirm_voice_capture_speaker_label(uuid, text, text, uuid) from public;
revoke execute on function public.reject_voice_capture_speaker_label(uuid) from public;
grant execute on function public.confirm_voice_capture_speaker_label(uuid, text, text, uuid) to authenticated;
grant execute on function public.reject_voice_capture_speaker_label(uuid) to authenticated;

update public.qep_roadmap_tasks
set description = 'Migration 609. Privacy/audit fields. UI only suggests labels, no silent assignment.'
where task_id = 'B2.4'
  and description like 'Migration 586.%';

commit;
