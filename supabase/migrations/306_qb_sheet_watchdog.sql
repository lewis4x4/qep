-- Migration 306: Auto Price Sheet Watchdog (Slice 16)
--
-- The moonshot: most watchdog tools detect changes. This one goes further —
-- when a new sheet lands, it auto-kicks extract-price-sheet, renders a diff
-- against the prior published version, and (critically) shows the blast
-- radius on **in-flight quotes**: "approving this new ASV book would reprice
-- 4 open quotes by a combined +$8,400."
--
-- Schema breakdown:
--   qb_brand_sheet_sources — where to watch per brand. URL-based for MVP;
--     the schema tolerates nullable url so Slice 16b can add email-inbox
--     sources without another migration.
--
--   qb_sheet_watch_events — append-only event trail: every check, every
--     change-detected, every downstream extract trigger, every error.
--     Powers the "Health" strip in the Sources admin UI and gives us
--     observability when a poll starts silently failing.
--
--   qb_price_sheets.source_id — FK back to the source so an auto-ingested
--     sheet knows where it came from. Null for manually-uploaded sheets.
--
-- RLS matches the rest of the qb_* admin surfaces: admin/manager/owner
-- write, any authenticated workspace member can read.

-- ── Sources: URLs/mailboxes we poll per brand ──────────────────────────────

create table public.qb_brand_sheet_sources (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         text not null default 'default',
  brand_id             uuid not null references public.qb_brands(id) on delete cascade,

  -- Label shown in the admin UI (e.g. "ASV public price book page")
  label                text not null,

  -- What to watch. For v1 this is always an https URL. Nullable for future
  -- email-inbox sources that key off from/subject instead.
  url                  text,

  -- Poll cadence. 24h default — most manufacturers refresh quarterly at most.
  check_freq_hours     integer not null default 24
                       check (check_freq_hours between 1 and 720),

  -- Most recent poll result so the watchdog can skip unchanged fetches.
  last_checked_at      timestamptz,
  last_hash            text,          -- sha256 of the response body
  last_etag            text,          -- for conditional GETs
  last_http_status     integer,
  last_error           text,          -- populated on failure, cleared on success

  -- How many consecutive failures we've seen. Drives admin UI alerting.
  consecutive_failures integer not null default 0,

  notes                text,
  active               boolean not null default true,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.qb_brand_sheet_sources is
  'URLs (and later mailboxes) that the price-sheet watchdog polls for new '
  'manufacturer sheets. One row per source; a brand can have multiple.';

-- One label per brand keeps the admin UI unambiguous.
create unique index ux_qb_brand_sheet_sources_brand_label
  on public.qb_brand_sheet_sources(workspace_id, brand_id, label);

-- Indexed lookup for the cron that picks "due for check" sources.
create index idx_qb_brand_sheet_sources_due
  on public.qb_brand_sheet_sources(active, last_checked_at)
  where active = true;

create trigger set_qb_brand_sheet_sources_updated_at
  before update on public.qb_brand_sheet_sources
  for each row execute function public.set_updated_at();

-- ── Event log: observability for every poll + change detection ─────────────

create table public.qb_sheet_watch_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null default 'default',
  source_id     uuid not null references public.qb_brand_sheet_sources(id) on delete cascade,

  -- What happened. Keep this list small and explicit.
  event_type    text not null check (event_type in (
    'checked_unchanged',    -- poll completed, hash matched → no-op
    'change_detected',      -- poll completed, hash differs → new sheet queued
    'sheet_extracted',      -- extract-price-sheet finished successfully
    'error',                -- poll or downstream extract failed
    'manual_trigger'        -- admin hit "Check now"
  )),

  -- Free-form context. For change_detected: { old_hash, new_hash, http_status }.
  -- For error: { message, stage }.
  detail        jsonb,

  -- If this event created a qb_price_sheets row, link to it so the admin
  -- UI can jump straight to the review/approval surface.
  price_sheet_id uuid references public.qb_price_sheets(id) on delete set null,

  created_at    timestamptz not null default now()
);

comment on table public.qb_sheet_watch_events is
  'Append-only event log for every watchdog poll. Drives health indicator '
  'in Sources admin + gives ops a timeline when something goes wrong.';

create index idx_qb_sheet_watch_events_source_created
  on public.qb_sheet_watch_events(source_id, created_at desc);

create index idx_qb_sheet_watch_events_workspace_created
  on public.qb_sheet_watch_events(workspace_id, created_at desc);

create index idx_qb_sheet_watch_events_type
  on public.qb_sheet_watch_events(event_type, created_at desc);

-- ── qb_price_sheets: link back to the source that produced it ──────────────

alter table public.qb_price_sheets
  add column if not exists source_id uuid
    references public.qb_brand_sheet_sources(id) on delete set null;

create index idx_qb_price_sheets_source
  on public.qb_price_sheets(source_id)
  where source_id is not null;

comment on column public.qb_price_sheets.source_id is
  'If populated, this sheet was auto-ingested by the watchdog from the '
  'linked source. Null for manual uploads. Lets the approval UI show '
  '"Auto-detected from <source label>" and links back to the event trail.';

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.qb_brand_sheet_sources enable row level security;
alter table public.qb_sheet_watch_events enable row level security;

-- Service role: unrestricted (edge functions call as service).
create policy "qb_brand_sheet_sources_service" on public.qb_brand_sheet_sources
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_sheet_watch_events_service" on public.qb_sheet_watch_events
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Sources: any workspace member reads, admin/manager/owner writes.
create policy "qb_brand_sheet_sources_select" on public.qb_brand_sheet_sources
  for select using (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
  );
create policy "qb_brand_sheet_sources_write" on public.qb_brand_sheet_sources
  for all using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  ) with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- Events: read-only for workspace members. All writes flow through service role.
create policy "qb_sheet_watch_events_select" on public.qb_sheet_watch_events
  for select using (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
  );
