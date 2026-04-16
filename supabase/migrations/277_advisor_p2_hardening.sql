-- ============================================================================
-- Migration 277: Post-audit P2 hardening — advisor cleanup
--
-- Closes three categories of Supabase linter findings that survived the
-- owner-dashboard audit:
--
--   1. security_definer_view  — 24 views in public use SECURITY DEFINER,
--      bypassing caller RLS. All have either baked-in role checks or
--      safely-readable base tables, so we flip them to security_invoker=true.
--      (v_branch_stack_ranking was already converted in migration 276.)
--
--   2. function_search_path_mutable — ~30 functions in public don't pin
--      search_path. Use a DO block to pin search_path = public, extensions,
--      pg_temp on every public function that is missing it. This is the
--      same pattern we use in owner_* RPCs (migration 276).
--
--   3. rls_disabled_in_public — public.qrm_rename_marker has RLS disabled.
--      Enable RLS with a deny-all default policy so PostgREST can't expose
--      the marker row. (Table has 1 row and is an internal rename ledger.)
-- ============================================================================

-- ── 1. Convert SECURITY DEFINER views to security_invoker=true ─────────────
alter view public.v_replenish_queue_enriched          set (security_invoker = true);
alter view public.crm_deals_elevated_full             set (security_invoker = true);
alter view public.v_parts_queue                        set (security_invoker = true);
alter view public.v_parts_intelligence                 set (security_invoker = true);
alter view public.parts_forecast_risk_summary          set (security_invoker = true);
alter view public.v_predictive_plays                   set (security_invoker = true);
alter view public.v_parts_stockout_risk                set (security_invoker = true);
alter view public.v_parts_dead_capital                 set (security_invoker = true);
alter view public.margin_analytics_view                set (security_invoker = true);
alter view public.v_rep_pipeline                       set (security_invoker = true);
alter view public.parts_inventory_reorder_status       set (security_invoker = true);
alter view public.v_parts_pricing_drift                set (security_invoker = true);
alter view public.v_parts_import_drift                 set (security_invoker = true);
alter view public.v_parts_margin_signal                set (security_invoker = true);
alter view public.v_parts_velocity                     set (security_invoker = true);
alter view public.v_machine_parts_connections          set (security_invoker = true);
alter view public.portal_trade_in_opportunities        set (security_invoker = true);
alter view public.price_change_impact                  set (security_invoker = true);
alter view public.equipment_lifecycle_summary          set (security_invoker = true);
alter view public.crm_deals_weighted                   set (security_invoker = true);
alter view public.v_parts_embedding_backlog            set (security_invoker = true);
alter view public.revenue_by_make_model                set (security_invoker = true);
alter view public.crm_deals_rep_safe                   set (security_invoker = true);
alter view public.v_rep_customers                      set (security_invoker = true);

-- ── 2. Pin search_path on every public function that's missing it ──────────
do $$
declare
  r record;
  pinned int := 0;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')  -- functions + procedures; skip aggregates
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
        where cfg like 'search_path=%'
      )
  loop
    begin
      execute format(
        'alter function %s set search_path = public, extensions, pg_temp',
        r.sig::text
      );
      pinned := pinned + 1;
    exception when others then
      -- Some trigger functions / system-dependent functions may refuse.
      -- Keep going; the advisor will tell us what's left.
      raise notice 'skipped %: %', r.sig, sqlerrm;
    end;
  end loop;
  raise notice 'search_path pinned on % functions', pinned;
end $$;

-- ── 3. qrm_rename_marker: enable RLS + deny-all default ───────────────────
alter table public.qrm_rename_marker enable row level security;

-- Only service_role can touch this; PostgREST callers see nothing.
drop policy if exists qrm_rename_marker_no_select on public.qrm_rename_marker;
create policy qrm_rename_marker_no_select on public.qrm_rename_marker
  for select using (false);

revoke all on public.qrm_rename_marker from anon, authenticated;

comment on table public.qrm_rename_marker is
  'Internal QRM rename ledger. RLS deny-all; service_role only via bypass.';

-- ============================================================================
-- Migration 277 complete.
-- ============================================================================
