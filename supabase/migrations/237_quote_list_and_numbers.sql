-- ============================================================================
-- 237 · Quote list & numbers — Foundation for quote management
--
-- Adds: quote_number generation, customer contact fields on quote_packages.
-- ============================================================================

-- ── Customer contact columns ────────────────────────────────────────────────

alter table public.quote_packages
  add column if not exists quote_number  text unique,
  add column if not exists customer_name text,
  add column if not exists customer_company text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text;

-- ── Quote number generator ──────────────────────────────────────────────────
-- Format: QEP-YYYY-NNNN, scoped per workspace per year.
-- Uses advisory lock to prevent collisions under concurrent inserts.

create or replace function public.generate_quote_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _workspace text;
  _year      int;
  _next_seq  int;
begin
  _workspace := coalesce(NEW.workspace_id, 'default');
  _year      := extract(year from now())::int;

  -- Serialise per-workspace-per-year via advisory lock
  perform pg_advisory_xact_lock(hashtext('quote_number_' || _workspace || '_' || _year::text));

  select coalesce(max(
    nullif(
      regexp_replace(quote_number, '^QEP-\d{4}-', ''),
      quote_number
    )::int
  ), 0) + 1
  into _next_seq
  from public.quote_packages
  where workspace_id = _workspace
    and quote_number like 'QEP-' || _year::text || '-%';

  NEW.quote_number := 'QEP-' || _year::text || '-' || lpad(_next_seq::text, 4, '0');

  return NEW;
end;
$$;

-- Only fire when quote_number is not already set (allows manual override)
create trigger trg_generate_quote_number
  before insert on public.quote_packages
  for each row
  when (NEW.quote_number is null)
  execute function public.generate_quote_number();

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index if not exists idx_quote_packages_quote_number
  on public.quote_packages(quote_number);

create index if not exists idx_quote_packages_customer_company
  on public.quote_packages(customer_company)
  where customer_company is not null;

create index if not exists idx_quote_packages_created_at_desc
  on public.quote_packages(created_at desc);
