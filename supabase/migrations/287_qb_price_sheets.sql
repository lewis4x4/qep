-- ============================================================================
-- Migration 287: QB Price Sheets
--
-- qb_price_sheets      — uploaded PDF/Excel files awaiting admin review
-- qb_price_sheet_items — Claude-extracted rows awaiting approval before catalog publish
--
-- Ingestion flow (Slice 04): admin uploads → Claude extracts → review → publish.
-- ============================================================================

create table public.qb_price_sheets (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                text not null default 'default',
  brand_id                    uuid references public.qb_brands(id),
  filename                    text not null,
  file_url                    text not null,
  file_type                   text check (file_type in ('pdf','xlsx','xls','csv')),
  uploaded_by                 uuid references auth.users(id),
  uploaded_at                 timestamptz not null default now(),
  effective_from              date,
  effective_to                date,
  status                      text not null default 'pending_review' check (status in (
    'pending_review','extracting','extracted','published','rejected','superseded'
  )),
  extraction_metadata         jsonb,
  reviewed_by                 uuid references auth.users(id),
  reviewed_at                 timestamptz,
  published_at                timestamptz,
  supersedes_price_sheet_id   uuid references public.qb_price_sheets(id),
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index idx_qb_price_sheets_workspace     on public.qb_price_sheets(workspace_id);
create index idx_qb_price_sheets_brand_status  on public.qb_price_sheets(brand_id, status);

create trigger set_qb_price_sheets_updated_at
  before update on public.qb_price_sheets
  for each row execute function public.set_updated_at();

create table public.qb_price_sheet_items (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                text not null default 'default',
  price_sheet_id              uuid not null references public.qb_price_sheets(id) on delete cascade,
  item_type                   text not null check (item_type in ('model','attachment','freight','note')),
  extracted                   jsonb not null,
  proposed_model_id           uuid references public.qb_equipment_models(id),
  proposed_attachment_id      uuid references public.qb_attachments(id),
  action                      text not null check (action in ('create','update','no_change','skip')),
  confidence                  numeric(3,2),
  review_status               text not null default 'pending' check (review_status in (
    'pending','approved','rejected','modified'
  )),
  reviewer_notes              text,
  applied_at                  timestamptz,
  created_at                  timestamptz not null default now()
);

create index idx_qb_price_sheet_items_sheet on public.qb_price_sheet_items(price_sheet_id, review_status);
