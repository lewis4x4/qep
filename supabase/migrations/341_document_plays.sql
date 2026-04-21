-- Migration 341 — Document Plays Engine (Slice VI)
--
-- Plays are operator-visible cards. Each one is a predicted, still-open
-- action on a document: "this rental expires in 7 days and has no renewal
-- edge — offer a draft." Plays live in a dedicated table (not an audit
-- log) because they have lifecycle state and uniqueness semantics.
--
-- The engine that fills this table is a pure SQL function,
-- public.run_document_plays_engine(p_workspace_id, p_document_id?):
-- it queries document_obligations, upserts document_plays on
-- (workspace_id, business_key), and pushes exception_queue rows for
-- high-severity entries. It can run over a whole workspace (hourly
-- cron) or against a single document (chained from document-twin).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_play_kind') then
    create type public.document_play_kind as enum (
      'expiring_warranty', 'expiring_rental', 'undelivered_po_line',
      'unpaid_invoice_aging', 'unexecuted_amendment', 'missing_signature',
      'pending_insurance_cert', 'service_interval_breach',
      'return_flagged_for_preinspection'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'document_play_status') then
    create type public.document_play_status as enum
      ('open','actioned','dismissed','expired','fulfilled');
  end if;
end
$$;

create table if not exists public.document_plays (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  business_key text not null,
  play_kind public.document_play_kind not null,
  document_id uuid references public.documents(id) on delete cascade,
  from_obligation_id uuid references public.document_obligations(id) on delete set null,
  projection_window text not null check (projection_window in ('7d','14d','30d','60d','90d')),
  projected_due_date timestamptz,
  probability real not null check (probability between 0 and 1),
  reason text not null,
  signal_type text not null,
  recommended_action jsonb not null default '{}'::jsonb,
  suggested_owner_user_id uuid references public.profiles(id) on delete set null,
  status public.document_play_status not null default 'open',
  actioned_by uuid references public.profiles(id) on delete set null,
  actioned_at timestamptz,
  action_note text,
  computation_batch_id uuid not null,
  input_signals jsonb not null default '{}'::jsonb,
  trace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, business_key)
);

create index if not exists idx_document_plays_owner_open
  on public.document_plays (suggested_owner_user_id, status)
  where status = 'open';
create index if not exists idx_document_plays_workspace_status_due
  on public.document_plays (workspace_id, status, projected_due_date);
create index if not exists idx_document_plays_document
  on public.document_plays (document_id, status);

alter table public.document_plays enable row level security;

drop policy if exists document_plays_select on public.document_plays;
create policy document_plays_select on public.document_plays
  for select
  using (workspace_id = public.get_my_workspace());

drop policy if exists document_plays_update_owner on public.document_plays;
create policy document_plays_update_owner on public.document_plays
  for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner')
  );

drop policy if exists document_plays_write on public.document_plays;
create policy document_plays_write on public.document_plays
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.document_plays is
  'Slice VI: predicted, actionable plays derived from document_obligations. One open row per (workspace_id, business_key). Lifecycle: open → actioned | dismissed | expired | fulfilled.';

alter type public.document_audit_event_type add value if not exists 'play_generated';
alter type public.document_audit_event_type add value if not exists 'play_actioned';
alter type public.document_audit_event_type add value if not exists 'play_dismissed';
alter type public.document_audit_event_type add value if not exists 'play_expired';
alter type public.document_audit_event_type add value if not exists 'play_fulfilled';
