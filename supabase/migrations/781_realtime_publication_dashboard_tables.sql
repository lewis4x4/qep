-- ============================================================
-- 781_realtime_publication_dashboard_tables.sql
--
-- Fix: frontend realtime subscriptions listen on tables that were
-- never added to the `supabase_realtime` publication, so the
-- subscriptions receive no events and the features silently fall
-- back to polling (or nothing at all).
--
-- Review: docs/reviews/2026-07-08-full-codebase-review.md
--   "Realtime subscriptions are dead weight: only parts_requests /
--    parts_request_activity were ever added to the supabase_realtime
--    publication (m245) — the Track 5.7 dashboard and quote-approval
--    subscriptions listen to tables that never publish."
--
-- Frontend subscription inventory (which hook each table serves):
--
--   apps/web/src/features/dashboards/hooks/useDashboardRealtime.ts
--   (Track 5 Slice 5.7 Iron dashboards; table map in
--   apps/web/src/features/dashboards/lib/realtime-tables.ts):
--     qrm_deals               (iron_manager, iron_advisor, iron_woman)
--     prospecting_kpis        (iron_manager, iron_advisor)
--     demos                   (iron_manager, iron_man)
--     trade_valuations        (iron_manager)
--     qrm_equipment           (iron_manager)
--     manufacturer_incentives (iron_manager)
--     qrm_predictions         (iron_manager)
--     follow_up_touchpoints   (iron_advisor)
--     deposits                (iron_woman)
--     equipment_intake        (iron_woman, iron_man)
--     rental_returns          (iron_man)
--
--   qrm_deals / qrm_equipment are the BASE tables behind the crm_deals /
--   crm_equipment compatibility views. Publications reject views
--   (ERROR 22023), and postgres_changes events carry base-table names
--   from the WAL, so the views must never appear here — realtime-tables.ts
--   subscribes to the base names for the same reason.
--
--   apps/web/src/features/quote-builder/hooks/useApprovalBypass.ts
--   (Phase 1 quote-approval feedback loop, UPDATE + id filter):
--     quote_approval_cases
--
--   apps/web/src/features/parts-companion/pages/QueuePage.tsx:
--     parts_requests — already published by migration 245; not
--     re-added here (the guard below would skip it anyway).
--
-- Notes:
--   - Each ADD TABLE is guarded against pg_publication_tables so the
--     migration is idempotent and safe to re-run, and the relation must
--     be an ordinary table (relkind 'r') — to_regclass alone also
--     matches views, which ALTER PUBLICATION rejects outright.
--   - All of these tables were created with `id uuid primary key`, so
--     they carry REPLICA IDENTITY DEFAULT (primary key) — sufficient
--     for postgres_changes; no REPLICA IDENTITY FULL needed.
--   - Supabase Realtime respects RLS on postgres_changes: subscribers
--     only receive rows their policies allow, so publishing these
--     tables does not widen data access.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    -- useDashboardRealtime.ts (Track 5.7 Iron dashboards)
    'qrm_deals',
    'prospecting_kpis',
    'demos',
    'trade_valuations',
    'qrm_equipment',
    'manufacturer_incentives',
    'qrm_predictions',
    'follow_up_touchpoints',
    'deposits',
    'equipment_intake',
    'rental_returns',
    -- useApprovalBypass.ts (quote-approval feedback loop)
    'quote_approval_cases'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = t
        and c.relkind = 'r'
    ) then
      raise notice 'realtime publication: public.% is not an ordinary table, skipping', t;
      continue;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Rollback (manual):
-- alter publication supabase_realtime drop table public.qrm_deals;
-- alter publication supabase_realtime drop table public.prospecting_kpis;
-- alter publication supabase_realtime drop table public.demos;
-- alter publication supabase_realtime drop table public.trade_valuations;
-- alter publication supabase_realtime drop table public.qrm_equipment;
-- alter publication supabase_realtime drop table public.manufacturer_incentives;
-- alter publication supabase_realtime drop table public.qrm_predictions;
-- alter publication supabase_realtime drop table public.follow_up_touchpoints;
-- alter publication supabase_realtime drop table public.deposits;
-- alter publication supabase_realtime drop table public.equipment_intake;
-- alter publication supabase_realtime drop table public.rental_returns;
-- alter publication supabase_realtime drop table public.quote_approval_cases;
