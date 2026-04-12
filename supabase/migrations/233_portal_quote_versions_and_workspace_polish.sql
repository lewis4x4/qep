-- ============================================================================
-- Migration 233: Portal Quote Versions + Workspace Polish Foundation
--
-- Adds:
--   1. portal_quote_review_versions for versioned customer proposal history
--   2. automatic version capture from portal_quote_reviews quote payload changes
-- ============================================================================

create table if not exists public.portal_quote_review_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_quote_review_id uuid not null references public.portal_quote_reviews(id) on delete cascade,
  version_number integer not null,
  quote_data jsonb not null default '{}'::jsonb,
  quote_pdf_url text,
  dealer_message text,
  revision_summary text,
  customer_request_snapshot text,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (portal_quote_review_id, version_number)
);

comment on table public.portal_quote_review_versions is
  'Version history for customer proposal revisions. Tracks published dealership responses and proposal deltas over time.';

create unique index if not exists idx_pqrv_current_unique
  on public.portal_quote_review_versions (portal_quote_review_id)
  where is_current = true;

create index if not exists idx_pqrv_review_id
  on public.portal_quote_review_versions (portal_quote_review_id, version_number desc);

alter table public.portal_quote_review_versions enable row level security;

create policy "quote_review_versions_internal" on public.portal_quote_review_versions for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "quote_review_versions_self_select" on public.portal_quote_review_versions for select
  using (
    exists (
      select 1
      from public.portal_quote_reviews pqr
      where pqr.id = portal_quote_review_versions.portal_quote_review_id
        and pqr.portal_customer_id = public.get_portal_customer_id()
    )
  );

create policy "quote_review_versions_service" on public.portal_quote_review_versions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.extract_portal_quote_version_text(
  p_quote_data jsonb,
  p_key_a text,
  p_key_b text
)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      coalesce(
        p_quote_data ->> p_key_a,
        p_quote_data ->> p_key_b,
        ''
      )
    ),
    ''
  );
$$;

create or replace function public.capture_portal_quote_review_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_version integer;
  v_published_by uuid;
begin
  v_published_by := auth.uid();

  if tg_op = 'INSERT' then
    if new.quote_data is null and new.quote_pdf_url is null then
      return new;
    end if;

    insert into public.portal_quote_review_versions (
      workspace_id,
      portal_quote_review_id,
      version_number,
      quote_data,
      quote_pdf_url,
      dealer_message,
      revision_summary,
      customer_request_snapshot,
      published_at,
      published_by,
      is_current
    )
    values (
      new.workspace_id,
      new.id,
      1,
      coalesce(new.quote_data, '{}'::jsonb),
      new.quote_pdf_url,
      public.extract_portal_quote_version_text(new.quote_data, 'dealer_message', 'dealerMessage'),
      public.extract_portal_quote_version_text(new.quote_data, 'revision_summary', 'revisionSummary'),
      new.counter_notes,
      coalesce(new.updated_at, new.created_at, now()),
      v_published_by,
      true
    )
    on conflict (portal_quote_review_id, version_number) do nothing;

    return new;
  end if;

  if new.quote_data is distinct from old.quote_data
    or new.quote_pdf_url is distinct from old.quote_pdf_url
    or new.expires_at is distinct from old.expires_at
  then
    select coalesce(max(version_number), 0)
      into v_max_version
    from public.portal_quote_review_versions
    where portal_quote_review_id = new.id;

    if v_max_version = 0 then
      insert into public.portal_quote_review_versions (
        workspace_id,
        portal_quote_review_id,
        version_number,
        quote_data,
        quote_pdf_url,
        dealer_message,
        revision_summary,
        customer_request_snapshot,
        published_at,
        published_by,
        is_current
      )
      values (
        old.workspace_id,
        old.id,
        1,
        coalesce(old.quote_data, '{}'::jsonb),
        old.quote_pdf_url,
        public.extract_portal_quote_version_text(old.quote_data, 'dealer_message', 'dealerMessage'),
        public.extract_portal_quote_version_text(old.quote_data, 'revision_summary', 'revisionSummary'),
        old.counter_notes,
        coalesce(old.updated_at, old.created_at, now()),
        null,
        false
      );

      v_max_version := 1;
    end if;

    update public.portal_quote_review_versions
    set is_current = false
    where portal_quote_review_id = new.id
      and is_current = true;

    insert into public.portal_quote_review_versions (
      workspace_id,
      portal_quote_review_id,
      version_number,
      quote_data,
      quote_pdf_url,
      dealer_message,
      revision_summary,
      customer_request_snapshot,
      published_at,
      published_by,
      is_current
    )
    values (
      new.workspace_id,
      new.id,
      v_max_version + 1,
      coalesce(new.quote_data, '{}'::jsonb),
      new.quote_pdf_url,
      public.extract_portal_quote_version_text(new.quote_data, 'dealer_message', 'dealerMessage'),
      public.extract_portal_quote_version_text(new.quote_data, 'revision_summary', 'revisionSummary'),
      old.counter_notes,
      coalesce(new.updated_at, now()),
      v_published_by,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists portal_quote_review_capture_version_trg on public.portal_quote_reviews;
create trigger portal_quote_review_capture_version_trg
  after insert or update of quote_data, quote_pdf_url, expires_at
  on public.portal_quote_reviews
  for each row
  execute function public.capture_portal_quote_review_version();
