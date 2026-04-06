-- ============================================================================
-- Migration 148: Price File Intelligence
--
-- Moonshot 2: Rylee's vision — "always be aware we're quoting the most
-- up to date pricing."
--
-- 1. Price history audit trail (auto-populated by trigger)
-- 2. Impact analysis on open quotes when prices change
-- 3. Requote flag on quote_packages
-- ============================================================================

-- ── 1. Catalog price history ────────────────────────────────────────────────

create table public.catalog_price_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  catalog_entry_id uuid not null references public.catalog_entries(id) on delete cascade,
  price_type text not null check (price_type in ('list_price', 'dealer_cost', 'msrp')),
  old_value numeric,
  new_value numeric,
  change_pct numeric(5,2),
  changed_at timestamptz not null default now(),
  source text, -- 'csv_import', 'manual', 'intellidealer_sync'
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.catalog_price_history is 'Append-only audit trail of catalog price changes. Auto-populated by trigger.';

alter table public.catalog_price_history enable row level security;
create policy "price_history_workspace" on public.catalog_price_history for select
  using (workspace_id = public.get_my_workspace());
create policy "price_history_service" on public.catalog_price_history for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_price_history_catalog on public.catalog_price_history(catalog_entry_id);
create index idx_price_history_date on public.catalog_price_history(changed_at desc);
create index idx_price_history_workspace on public.catalog_price_history(workspace_id);

-- ── 2. Auto-capture trigger on catalog_entries price changes ────────────────

create or replace function public.track_catalog_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.list_price is distinct from NEW.list_price and NEW.list_price is not null then
    insert into public.catalog_price_history (workspace_id, catalog_entry_id, price_type, old_value, new_value, change_pct, source)
    values (
      NEW.workspace_id, NEW.id, 'list_price', OLD.list_price, NEW.list_price,
      case when OLD.list_price > 0 then round(((NEW.list_price - OLD.list_price) / OLD.list_price) * 100, 2) else null end,
      'manual'
    );
  end if;

  if OLD.dealer_cost is distinct from NEW.dealer_cost and NEW.dealer_cost is not null then
    insert into public.catalog_price_history (workspace_id, catalog_entry_id, price_type, old_value, new_value, change_pct, source)
    values (
      NEW.workspace_id, NEW.id, 'dealer_cost', OLD.dealer_cost, NEW.dealer_cost,
      case when OLD.dealer_cost > 0 then round(((NEW.dealer_cost - OLD.dealer_cost) / OLD.dealer_cost) * 100, 2) else null end,
      'manual'
    );
  end if;

  if OLD.msrp is distinct from NEW.msrp and NEW.msrp is not null then
    insert into public.catalog_price_history (workspace_id, catalog_entry_id, price_type, old_value, new_value, change_pct, source)
    values (
      NEW.workspace_id, NEW.id, 'msrp', OLD.msrp, NEW.msrp,
      case when OLD.msrp > 0 then round(((NEW.msrp - OLD.msrp) / OLD.msrp) * 100, 2) else null end,
      'manual'
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists catalog_price_change_audit on public.catalog_entries;
create trigger catalog_price_change_audit
  after update of list_price, dealer_cost, msrp on public.catalog_entries
  for each row
  execute function public.track_catalog_price_change();

-- ── 3. Requote flag on quote_packages ───────────────────────────────────────

alter table public.quote_packages
  add column if not exists requires_requote boolean default false,
  add column if not exists requote_reason text;

comment on column public.quote_packages.requires_requote is 'Flagged when a referenced catalog price changed after quote was created';
