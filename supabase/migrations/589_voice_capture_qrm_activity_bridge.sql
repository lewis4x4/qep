-- Bridge every stored voice capture into the QRM activity timeline.
--
-- Direct client captures can insert a voice_captures row without going through
-- the edge-function sync path. The business invariant is stronger than the UI:
-- if a capture has a transcript, QRM must have an activity receipt attached to
-- the best available subject. This trigger is idempotent and schema-drift safe.

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'qrm_activities'
      and c.relkind in ('r', 'p')
  ) then
    create unique index if not exists crm_activities_voice_capture_subject_unique_idx
    on public.qrm_activities (
      workspace_id,
      activity_type,
      coalesce(deal_id::text, company_id::text, contact_id::text),
      ((metadata ->> 'voiceCaptureId')),
      ((metadata ->> 'activityKind'))
    )
    where deleted_at is null
      and metadata ->> 'source' = 'voice_capture';
  elsif exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'crm_activities'
      and c.relkind in ('r', 'p')
  ) then
    create unique index if not exists crm_activities_voice_capture_subject_unique_idx
    on public.crm_activities (
      workspace_id,
      activity_type,
      coalesce(deal_id::text, company_id::text, contact_id::text),
      ((metadata ->> 'voiceCaptureId')),
      ((metadata ->> 'activityKind'))
    )
    where deleted_at is null
      and metadata ->> 'source' = 'voice_capture';
  end if;
end $$;

create or replace function public.ensure_voice_capture_qrm_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_workspace_id text;
  v_transcript text;
  v_deal_id uuid;
  v_company_id uuid;
  v_contact_id uuid;
  v_target_source text;
  v_existing_activity_id uuid;
  v_inbox_metadata jsonb := jsonb_build_object('source', 'voice_capture_inbox', 'system', true);
  v_body text;
  v_summary text;
begin
  v_row := to_jsonb(new);
  v_workspace_id := coalesce(v_row->>'workspace_id', public.get_my_workspace(), 'default');
  v_transcript := nullif(trim(coalesce(v_row->>'transcript', '')), '');

  if v_transcript is null then
    return new;
  end if;

  begin
    v_deal_id := coalesce(
      nullif(v_row->>'linked_deal_id', '')::uuid,
      case when (v_row->>'hubspot_deal_id') ~* '^[0-9a-f-]{36}$' then nullif(v_row->>'hubspot_deal_id', '')::uuid else null end
    );
  exception when others then
    v_deal_id := null;
  end;

  if v_deal_id is not null and not exists (
    select 1 from public.crm_deals d
    where d.id = v_deal_id and d.workspace_id = v_workspace_id and d.deleted_at is null
  ) then
    v_deal_id := null;
  end if;

  begin
    v_company_id := nullif(v_row->>'linked_company_id', '')::uuid;
  exception when others then
    v_company_id := null;
  end;

  if v_company_id is not null and not exists (
    select 1 from public.crm_companies c
    where c.id = v_company_id and c.workspace_id = v_workspace_id and c.deleted_at is null
  ) then
    v_company_id := null;
  end if;

  begin
    v_contact_id := nullif(v_row->>'linked_contact_id', '')::uuid;
  exception when others then
    v_contact_id := null;
  end;

  if v_contact_id is not null and not exists (
    select 1 from public.crm_contacts c
    where c.id = v_contact_id and c.workspace_id = v_workspace_id and c.deleted_at is null
  ) then
    v_contact_id := null;
  end if;

  -- If no explicit subject exists, create/use a workspace inbox company so the
  -- note still lands in QRM instead of disappearing into an unattached table.
  if v_deal_id is null and v_company_id is null and v_contact_id is null then
    select c.id into v_company_id
    from public.crm_companies c
    where c.workspace_id = v_workspace_id
      and c.deleted_at is null
      and c.name = 'Voice Capture Inbox'
      and c.metadata @> v_inbox_metadata
    limit 1;

    if v_company_id is null then
      insert into public.crm_companies (workspace_id, name, assigned_rep_id, metadata)
      values (
        v_workspace_id,
        'Voice Capture Inbox',
        new.user_id,
        v_inbox_metadata || jsonb_build_object(
          'description', 'System holding account for voice captures that could not be matched to a QRM customer yet.'
        )
      )
      returning id into v_company_id;
    end if;

    v_target_source := 'inbox';
  elsif v_deal_id is not null then
    v_company_id := null;
    v_contact_id := null;
    v_target_source := 'deal';
  elsif v_company_id is not null then
    v_contact_id := null;
    v_target_source := 'company';
  else
    v_target_source := 'contact';
  end if;

  v_summary := nullif(v_row #>> '{extracted_data,extraction,summary}', '');
  v_body := concat_ws(E'\n\n', 'Voice capture', v_summary, v_transcript);

  select a.id into v_existing_activity_id
  from public.crm_activities a
  where a.workspace_id = v_workspace_id
    and a.deleted_at is null
    and a.metadata ->> 'source' = 'voice_capture'
    and a.metadata ->> 'voiceCaptureId' = new.id::text
    and a.metadata ->> 'activityKind' = 'note'
  limit 1;

  if v_existing_activity_id is not null then
    update public.crm_activities
    set
      body = v_body,
      deal_id = v_deal_id,
      contact_id = v_contact_id,
      company_id = v_company_id,
      metadata = jsonb_build_object(
        'source', 'voice_capture',
        'voiceCaptureId', new.id,
        'activityKind', 'note',
        'targetSource', v_target_source,
        'transcript', v_transcript,
        'extractedData', coalesce(v_row->'extracted_data', '{}'::jsonb),
        'resolvedDealId', v_deal_id,
        'resolvedCompanyId', v_company_id,
        'resolvedContactId', v_contact_id,
        'autoAttachedBy', 'ensure_voice_capture_qrm_activity'
      )
    where id = v_existing_activity_id;

    if new.sync_status is distinct from 'failed' and new.sync_status is distinct from 'synced' then
      update public.voice_captures vc
      set
        sync_status = 'synced',
        sync_error = null,
        qrm_activity_id = v_existing_activity_id,
        qrm_synced_at = coalesce(vc.qrm_synced_at, now())
      where vc.id = new.id;
    end if;
    return new;
  end if;

  insert into public.crm_activities (
    workspace_id,
    activity_type,
    body,
    occurred_at,
    deal_id,
    contact_id,
    company_id,
    created_by,
    metadata
  )
  values (
    v_workspace_id,
    'note',
    v_body,
    coalesce(new.created_at, now()),
    v_deal_id,
    v_contact_id,
    v_company_id,
    new.user_id,
    jsonb_build_object(
      'source', 'voice_capture',
      'voiceCaptureId', new.id,
      'activityKind', 'note',
      'targetSource', v_target_source,
      'transcript', v_transcript,
      'extractedData', coalesce(v_row->'extracted_data', '{}'::jsonb),
      'resolvedDealId', v_deal_id,
      'resolvedCompanyId', v_company_id,
      'resolvedContactId', v_contact_id,
      'autoAttachedBy', 'ensure_voice_capture_qrm_activity'
    )
  )
  on conflict do nothing;

  update public.voice_captures vc
  set
    sync_status = case when vc.sync_status = 'failed' then vc.sync_status else 'synced' end,
    sync_error = case when vc.sync_status = 'failed' then vc.sync_error else null end,
    qrm_activity_id = coalesce(vc.qrm_activity_id, (
      select a.id
      from public.crm_activities a
      where a.workspace_id = v_workspace_id
        and a.deleted_at is null
        and a.metadata ->> 'source' = 'voice_capture'
        and a.metadata ->> 'voiceCaptureId' = new.id::text
        and a.metadata ->> 'activityKind' = 'note'
      limit 1
    )),
    qrm_synced_at = coalesce(vc.qrm_synced_at, now())
  where vc.id = new.id
    and vc.sync_status is distinct from 'failed';

  return new;
end;
$$;

drop trigger if exists trg_voice_capture_qrm_activity on public.voice_captures;
create trigger trg_voice_capture_qrm_activity
  after insert or update of transcript, linked_deal_id, linked_company_id, linked_contact_id, extracted_data, sync_status
  on public.voice_captures
  for each row execute function public.ensure_voice_capture_qrm_activity();

-- Backfill existing successful/pending captures so historical notes become QRM
-- activities as soon as this migration is applied.
update public.voice_captures
set
  transcript = transcript,
  updated_at = now()
where transcript is not null
  and nullif(trim(transcript), '') is not null
  and sync_status is distinct from 'failed';
