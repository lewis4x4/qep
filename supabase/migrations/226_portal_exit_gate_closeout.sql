-- ============================================================================
-- Migration 226: Track 6 Exit Gate Closeout
--
-- Adds:
--   1. portal_customer_notifications canonical customer-facing notification log
--   2. quote-available trigger on portal_quote_reviews
--   3. hourly portal-notification-refresh cron
-- ============================================================================

create table if not exists public.portal_customer_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  category text not null check (category in ('service', 'parts', 'quotes', 'fleet')),
  event_type text not null,
  channel text not null check (channel in ('portal', 'email', 'sms')),
  title text not null,
  body text not null,
  related_entity_type text,
  related_entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.portal_customer_notifications is
  'Canonical customer-facing notification ledger for the portal. Stores deduped service, parts, quote, and fleet notifications per portal customer.';

create unique index if not exists uq_portal_customer_notifications_dedupe
  on public.portal_customer_notifications(workspace_id, dedupe_key);

create index if not exists idx_portal_customer_notifications_customer_sent
  on public.portal_customer_notifications(portal_customer_id, sent_at desc);

create index if not exists idx_portal_customer_notifications_workspace_sent
  on public.portal_customer_notifications(workspace_id, sent_at desc);

alter table public.portal_customer_notifications enable row level security;

create policy "pcn_portal_select_self" on public.portal_customer_notifications for select
  using (portal_customer_id = public.get_portal_customer_id());

create policy "pcn_staff_select_workspace" on public.portal_customer_notifications for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "pcn_service_all" on public.portal_customer_notifications for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.record_portal_customer_notification(
  p_workspace_id text,
  p_portal_customer_id uuid,
  p_category text,
  p_event_type text,
  p_channel text,
  p_title text,
  p_body text,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_sent_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dedupe_key text;
begin
  if p_portal_customer_id is null then
    return;
  end if;

  v_dedupe_key := coalesce(nullif(trim(p_dedupe_key), ''), gen_random_uuid()::text);

  insert into public.portal_customer_notifications (
    workspace_id,
    portal_customer_id,
    category,
    event_type,
    channel,
    title,
    body,
    related_entity_type,
    related_entity_id,
    metadata,
    dedupe_key,
    sent_at
  ) values (
    p_workspace_id,
    p_portal_customer_id,
    p_category,
    p_event_type,
    p_channel,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id,
    coalesce(p_metadata, '{}'::jsonb),
    v_dedupe_key,
    coalesce(p_sent_at, now())
  )
  on conflict (workspace_id, dedupe_key) do nothing;
end;
$$;

comment on function public.record_portal_customer_notification is
  'Deduped insert helper for canonical customer-facing portal notifications.';

revoke all on function public.record_portal_customer_notification(text, uuid, text, text, text, text, text, text, uuid, jsonb, text, timestamptz) from public;
grant execute on function public.record_portal_customer_notification(text, uuid, text, text, text, text, text, text, uuid, jsonb, text, timestamptz) to service_role;

create or replace function public.portal_quote_reviews_emit_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.record_portal_customer_notification(
      new.workspace_id,
      new.portal_customer_id,
      'quotes',
      'quote_available',
      'portal',
      'Quote ready for review',
      'A new quote is ready in your customer portal for review and signature.',
      'portal_quote_review',
      new.id,
      jsonb_build_object(
        'deal_id', new.deal_id,
        'service_quote_id', new.service_quote_id,
        'status', new.status
      ),
      'quote:' || new.id::text || ':sent',
      now()
    );
  end if;

  return new;
end;
$$;

comment on function public.portal_quote_reviews_emit_notification() is
  'Writes one deduped quote_available portal notification when a quote enters sent state.';

drop trigger if exists portal_quote_reviews_emit_notification_trg on public.portal_quote_reviews;
create trigger portal_quote_reviews_emit_notification_trg
  after insert or update of status on public.portal_quote_reviews
  for each row
  execute function public.portal_quote_reviews_emit_notification();

select cron.schedule(
  'portal-notification-refresh',
  '15 * * * *',
  format(
    $sql$
    select net.http_post(
      url := '%s/functions/v1/portal-notification-refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', format('Bearer %s', current_setting('app.settings.service_role_key', true))
      ),
      body := '{"source":"cron"}'::jsonb
    );
    $sql$,
    current_setting('app.settings.supabase_url', true),
    current_setting('app.settings.service_role_key', true)
  )
);
