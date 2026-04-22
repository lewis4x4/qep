-- Harden voice capture triggers against schema drift.
--
-- The current voice_captures table stores parsed data in extracted_data and
-- does not guarantee workspace_id, metadata, or extraction_result columns.
-- Existing trigger functions referenced those fields directly, which causes
-- inserts to fail at runtime with "record new has no field ..." when a field
-- note is submitted. Read trigger input through jsonb so absent columns degrade
-- to null instead of aborting the insert.

create or replace function public.trg_lifecycle_from_voice_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_workspace_id text;
  v_company_id uuid;
begin
  v_row := to_jsonb(new);
  v_workspace_id := coalesce(v_row->>'workspace_id', public.get_my_workspace(), 'default');

  begin
    v_company_id := coalesce(
      nullif(v_row #>> '{metadata,company_id}', '')::uuid,
      nullif(v_row->>'linked_company_id', '')::uuid
    );
  exception when others then
    v_company_id := null;
  end;

  if v_company_id is null then
    return new;
  end if;

  perform public.insert_lifecycle_event_once(
    v_workspace_id,
    v_company_id,
    'first_contact',
    jsonb_build_object('voice_capture_id', new.id),
    'voice_captures',
    new.id
  );
  return new;
end;
$$;

drop trigger if exists trg_lifecycle_voice on public.voice_captures;
create trigger trg_lifecycle_voice
  after insert on public.voice_captures
  for each row execute function public.trg_lifecycle_from_voice_capture();

create or replace function public.flow_emit_from_voice_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_workspace_id text;
  v_event_type text;
  v_extracted_data jsonb;
  v_old_extracted_data jsonb;
begin
  v_new := to_jsonb(new);
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_workspace_id := coalesce(v_new->>'workspace_id', public.get_my_workspace(), 'default');
  v_extracted_data := coalesce(v_new->'extracted_data', v_new->'extraction_result');
  v_old_extracted_data := coalesce(v_old->'extracted_data', v_old->'extraction_result');

  if tg_op = 'INSERT' then
    v_event_type := 'voice.capture.created';
  elsif v_extracted_data is distinct from v_old_extracted_data and v_extracted_data is not null then
    v_event_type := 'voice.capture.parsed';
  else
    return new;
  end if;

  perform public.emit_event(
    v_event_type,
    'qrm',
    'voice_capture',
    new.id::text,
    jsonb_build_object(
      'voice_capture_id', new.id,
      'workspace_id', v_workspace_id,
      'user_id', new.user_id,
      'extracted_data', v_extracted_data
    ),
    v_workspace_id
  );
  return new;
end;
$$;

drop trigger if exists trg_flow_emit_voice on public.voice_captures;
create trigger trg_flow_emit_voice
  after insert or update on public.voice_captures
  for each row execute function public.flow_emit_from_voice_capture();
