-- Immutable R2-backed customer quote PDF versions for A3.8 / QEP-21.
-- Keeps legacy Supabase Storage preview artifacts intact while making customer
-- email sends depend on generated, immutable R2 customer PDF artifacts.

set statement_timeout = 0;

alter table public.quote_document_artifacts
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists version_number integer,
  add column if not exists content_sha256 text,
  add column if not exists size_bytes bigint,
  add column if not exists proposal_snapshot_json jsonb,
  add column if not exists customer_visible_at timestamptz,
  add column if not exists sent_delivery_event_id uuid references public.quote_delivery_events(id) on delete set null,
  add column if not exists upload_intent text,
  add column if not exists upload_expires_at timestamptz;

alter table public.quote_document_artifacts
  drop constraint if exists quote_document_artifacts_storage_provider_check;
alter table public.quote_document_artifacts
  add constraint quote_document_artifacts_storage_provider_check
  check (storage_provider in ('supabase', 'r2'));

alter table public.quote_document_artifacts
  drop constraint if exists quote_document_artifacts_upload_intent_check;
alter table public.quote_document_artifacts
  add constraint quote_document_artifacts_upload_intent_check
  check (upload_intent is null or upload_intent in ('preview', 'send'));

alter table public.quote_document_artifacts
  drop constraint if exists quote_document_artifacts_version_positive_check;
alter table public.quote_document_artifacts
  add constraint quote_document_artifacts_version_positive_check
  check (version_number is null or version_number > 0);

alter table public.quote_document_artifacts
  drop constraint if exists quote_document_artifacts_size_bytes_check;
alter table public.quote_document_artifacts
  add constraint quote_document_artifacts_size_bytes_check
  check (size_bytes is null or size_bytes >= 0);

alter table public.quote_document_artifacts
  drop constraint if exists quote_document_artifacts_sha256_check;
alter table public.quote_document_artifacts
  add constraint quote_document_artifacts_sha256_check
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$');

create unique index if not exists uq_quote_document_artifact_pdf_version
  on public.quote_document_artifacts (quote_package_id, artifact_type, version_number)
  where version_number is not null;

create index if not exists idx_quote_document_artifacts_customer_latest
  on public.quote_document_artifacts (quote_package_id, artifact_type, customer_visible_at desc, version_number desc)
  where customer_visible_at is not null;

create index if not exists idx_quote_document_artifacts_pending_expiry
  on public.quote_document_artifacts (status, upload_expires_at)
  where status = 'pending';

comment on column public.quote_document_artifacts.storage_provider is
  'Storage backend for the artifact. Legacy preview PDFs remain supabase; customer-send immutable PDFs use r2.';
comment on column public.quote_document_artifacts.version_number is
  'Immutable customer-visible PDF version number assigned at upload begin for send artifacts.';
comment on column public.quote_document_artifacts.proposal_snapshot_json is
  'Customer-safe semantic snapshot of the rendered PDF used for version history diffs.';
comment on column public.quote_document_artifacts.customer_visible_at is
  'Set by quote_send_package_commit only after a customer email send succeeds.';

create or replace function public.quote_begin_customer_pdf_version(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_quote_package_version_id uuid,
  p_generated_by uuid,
  p_filename text,
  p_content_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_proposal_snapshot_json jsonb,
  p_storage_bucket text,
  p_upload_expires_at timestamptz
) returns table (
  artifact_id uuid,
  version_number integer,
  storage_bucket text,
  storage_key text,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package record;
  v_version record;
  v_next_version integer;
  v_safe_filename text;
  v_storage_key text;
begin
  if p_workspace_id is null or length(trim(p_workspace_id)) = 0 then
    raise exception 'quote_begin_customer_pdf_version: workspace_id required';
  end if;
  if p_content_type is distinct from 'application/pdf' then
    raise exception 'quote_begin_customer_pdf_version: content_type must be application/pdf';
  end if;
  if coalesce(p_size_bytes, 0) <= 0 then
    raise exception 'quote_begin_customer_pdf_version: size_bytes must be positive';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'quote_begin_customer_pdf_version: content_sha256 must be lowercase sha256 hex';
  end if;
  if p_proposal_snapshot_json is null or jsonb_typeof(p_proposal_snapshot_json) <> 'object' then
    raise exception 'quote_begin_customer_pdf_version: proposal_snapshot_json object required';
  end if;
  if p_storage_bucket is null or length(trim(p_storage_bucket)) = 0 then
    raise exception 'quote_begin_customer_pdf_version: storage bucket required';
  end if;

  select id, workspace_id
  into v_package
  from public.quote_packages
  where id = p_quote_package_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'quote_begin_customer_pdf_version: quote package % not in workspace %',
      p_quote_package_id, p_workspace_id;
  end if;

  select id
  into v_version
  from public.quote_package_versions
  where id = p_quote_package_version_id
    and quote_package_id = p_quote_package_id
    and workspace_id = p_workspace_id
    and superseded_at is null;

  if not found then
    raise exception 'quote_begin_customer_pdf_version: latest active quote package version required';
  end if;

  select coalesce(max(qda.version_number), 0) + 1
  into v_next_version
  from public.quote_document_artifacts qda
  where qda.quote_package_id = p_quote_package_id
    and qda.artifact_type = 'customer_quote_pdf'
    and qda.version_number is not null;

  v_safe_filename := lower(coalesce(nullif(trim(p_filename), ''), 'quote.pdf'));
  v_safe_filename := regexp_replace(v_safe_filename, '[^a-z0-9._-]+', '-', 'g');
  v_safe_filename := trim(both '-' from v_safe_filename);
  if v_safe_filename = '' then
    v_safe_filename := 'quote.pdf';
  end if;
  if right(v_safe_filename, 4) <> '.pdf' then
    v_safe_filename := v_safe_filename || '.pdf';
  end if;

  v_storage_key := concat(
    'workspaces/', p_workspace_id,
    '/quotes/', p_quote_package_id::text,
    '/customer-pdf/v', v_next_version::text,
    '/', gen_random_uuid()::text, '-', v_safe_filename
  );

  insert into public.quote_document_artifacts (
    workspace_id,
    quote_package_id,
    quote_package_version_id,
    artifact_type,
    storage_provider,
    storage_bucket,
    storage_key,
    status,
    generated_by,
    upload_intent,
    upload_expires_at,
    version_number,
    content_sha256,
    size_bytes,
    proposal_snapshot_json,
    metadata
  ) values (
    p_workspace_id,
    p_quote_package_id,
    p_quote_package_version_id,
    'customer_quote_pdf',
    'r2',
    p_storage_bucket,
    v_storage_key,
    'pending',
    p_generated_by,
    'send',
    p_upload_expires_at,
    v_next_version,
    lower(p_content_sha256),
    p_size_bytes,
    p_proposal_snapshot_json,
    jsonb_build_object(
      'content_type', p_content_type,
      'upload_started_at', now()
    )
  )
  returning id, quote_document_artifacts.version_number, quote_document_artifacts.storage_bucket, quote_document_artifacts.storage_key, quote_document_artifacts.upload_expires_at
  into artifact_id, version_number, storage_bucket, storage_key, upload_expires_at;

  return next;
end;
$$;

comment on function public.quote_begin_customer_pdf_version is
  'Service-role only: serialize and allocate the next immutable R2 customer PDF artifact version for a quote package.';

revoke execute on function public.quote_begin_customer_pdf_version(
  text, uuid, uuid, uuid, text, text, bigint, text, jsonb, text, timestamptz
) from anon, authenticated;

grant execute on function public.quote_begin_customer_pdf_version(
  text, uuid, uuid, uuid, text, text, bigint, text, jsonb, text, timestamptz
) to service_role;

create or replace function public.quote_send_package_commit(
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
  p_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_document_artifact_id is null then
    raise exception 'quote_send_package_commit: document_artifact_id is required for customer email sends';
  end if;

  insert into public.quote_delivery_events (
    workspace_id,
    quote_package_id,
    document_artifact_id,
    channel,
    status,
    recipient,
    subject,
    message_body,
    provider,
    provider_message_id,
    error_message,
    follow_up_at,
    created_by,
    metadata
  ) values (
    p_workspace_id,
    p_quote_package_id,
    p_document_artifact_id,
    'email',
    'sent',
    p_recipient,
    p_subject,
    p_message_body,
    p_provider,
    null,
    null,
    p_follow_up_at,
    p_created_by,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  update public.quote_packages
  set
    status = 'sent',
    sent_at = p_sent_at,
    sent_via = 'email',
    updated_at = now()
  where id = p_quote_package_id
    and workspace_id = p_workspace_id;

  if not found then
    raise exception 'quote_send_package_commit: quote package % not in workspace %',
      p_quote_package_id, p_workspace_id;
  end if;

  update public.quote_document_artifacts
  set
    customer_visible_at = p_sent_at,
    sent_delivery_event_id = v_id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'sent_at', p_sent_at,
      'recipient', p_recipient,
      'provider', p_provider
    ),
    updated_at = now()
  where id = p_document_artifact_id
    and workspace_id = p_workspace_id
    and quote_package_id = p_quote_package_id
    and artifact_type = 'customer_quote_pdf'
    and storage_provider = 'r2'
    and status = 'generated'
    and version_number is not null
    and proposal_snapshot_json is not null
    and customer_visible_at is null
    and not exists (
      select 1
      from public.quote_document_artifacts newer
      where newer.quote_package_id = p_quote_package_id
        and newer.artifact_type = 'customer_quote_pdf'
        and newer.customer_visible_at is not null
        and newer.version_number > public.quote_document_artifacts.version_number
    );

  if not found then
    raise exception 'quote_send_package_commit: generated R2 customer PDF artifact % not found, already sent, older than an already visible version, or invalid',
      p_document_artifact_id;
  end if;

  return v_id;
end;
$$;

comment on function public.quote_send_package_commit is
  'Service-role only: after external email succeeds, insert quote_delivery_events, mark quote sent, and expose the immutable R2 PDF artifact version atomically.';

revoke execute on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb
) from anon, authenticated;

grant execute on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb
) to service_role;
