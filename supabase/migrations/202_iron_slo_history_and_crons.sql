-- ============================================================================
-- Migration 202: Wave 7 Iron Companion v1.9 — SLO history + decay cron
--
-- Closes the v1.6 (SLO compute fn) and v1.8 (memory affinity decay fn)
-- observability loops by:
--
--   1. iron_slo_history: per-workspace, per-day snapshot of the JSONB output
--      of public.iron_compute_slos(). One row per snapshot.
--
--   2. AFTER trigger on iron_slo_history that detects pass→fail transitions
--      across each metric vs. the most recent prior snapshot, and fires
--      enqueue_exception (source='data_quality') exactly once per breach.
--      Bounded by snapshot frequency (1/day), not by metric query frequency,
--      so noise is minimal.
--
--   3. Two pg_cron jobs (no edge function — both targets are SECURITY DEFINER
--      SQL functions that the cron worker can call directly):
--        iron-slo-snapshot-nightly  → 04:00 UTC daily
--        iron-memory-decay-nightly  → 05:00 UTC daily
--
-- Schedule rationale:
--   • 04:00 UTC for the SLO snapshot is intentionally AFTER the v1.7 jobs
--     (pattern-mining 02:00, red-team 03:00) so the snapshot reflects the
--     full day's activity including any cron failures.
--   • 05:00 UTC for memory decay is AFTER the snapshot so today's affinity
--     activity is fully captured before decay multiplies the scores.
--
-- This is a SQL-only slice — no edge function, no client code. The history
-- table is queryable via the existing /admin/flow Iron health card path;
-- a follow-up slice will surface a trend graph from this table.
-- ============================================================================

-- ── 1. iron_slo_history table ─────────────────────────────────────────────

create table if not exists public.iron_slo_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  snapshot jsonb not null,
  computed_at timestamptz not null default now()
);

comment on table public.iron_slo_history is
  'Wave 7 Iron Companion v1.9: per-workspace nightly snapshot of public.iron_compute_slos(). One row per snapshot. Powers trend analysis and pass→fail breach detection via the AFTER trigger.';

create index if not exists idx_iron_slo_history_workspace_recent
  on public.iron_slo_history (workspace_id, computed_at desc);

alter table public.iron_slo_history enable row level security;

create policy iron_slo_history_manager_read on public.iron_slo_history for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_slo_history_service_all on public.iron_slo_history for all
  to service_role using (true) with check (true);

-- ── 2. Pass→fail transition detection trigger ────────────────────────────
--
-- AFTER INSERT trigger compares the new snapshot's per-metric pass flags
-- against the most recent PRIOR snapshot for the same workspace. For each
-- metric where prior was true (or null = first snapshot is exempt) AND
-- new is false, fire enqueue_exception once.
--
-- The trigger is intentionally one-shot per breach. If the metric stays
-- failing across multiple snapshots, only the first transition fires an
-- exception. Recovery (fail→pass) is silent.

create or replace function public.iron_slo_breach_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior jsonb;
  v_metric record;
  v_metrics_to_check text[] := array[
    'classify_pass',
    'execute_pass',
    'undo_pass',
    'dead_letter_pass',
    'cost_pass'
  ];
  v_metric_label text;
  v_breach_count integer := 0;
begin
  -- Find the most recent prior snapshot for this workspace (any row before
  -- the one we just inserted). NULL = first snapshot ever, exempt from
  -- breach detection.
  select snapshot into v_prior
  from public.iron_slo_history
  where workspace_id = new.workspace_id
    and id <> new.id
  order by computed_at desc
  limit 1;

  if v_prior is null then
    return new;
  end if;

  -- Iterate metric pass flags
  foreach v_metric_label in array v_metrics_to_check loop
    if (v_prior ->> v_metric_label)::boolean is true
       and (new.snapshot ->> v_metric_label)::boolean is false
    then
      -- Pass → fail transition detected
      perform public.enqueue_exception(
        p_source => 'data_quality',
        p_title => format('Iron SLO breach: %s', replace(v_metric_label, '_pass', '')),
        p_severity => 'warn',
        p_detail => format(
          'The %s SLO transitioned from pass to fail. See iron_slo_history.id=%s for the full snapshot. Compare to the prior snapshot to identify which target was violated.',
          replace(v_metric_label, '_pass', ''),
          new.id
        ),
        p_payload => jsonb_build_object(
          'workspace_id', new.workspace_id,
          'metric', replace(v_metric_label, '_pass', ''),
          'snapshot_id', new.id,
          'computed_at', new.computed_at,
          'prior_snapshot', v_prior,
          'new_snapshot', new.snapshot
        )
      );
      v_breach_count := v_breach_count + 1;
    end if;
  end loop;

  if v_breach_count > 0 then
    raise notice 'iron-slo: % breach(es) detected for workspace %, exceptions enqueued', v_breach_count, new.workspace_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.iron_slo_breach_trigger() from public;

drop trigger if exists trg_iron_slo_breach on public.iron_slo_history;
create trigger trg_iron_slo_breach
  after insert on public.iron_slo_history
  for each row execute function public.iron_slo_breach_trigger();

-- ── 3. pg_cron registrations ──────────────────────────────────────────────
--
-- These are inline-SQL crons (matches mig 179 pattern, NOT mig 200's HTTP
-- pattern) because both targets are SECURITY DEFINER SQL functions that
-- the cron worker can call directly. No pg_net, no edge function, no
-- service_role_key needed.

do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping iron SLO + decay crons: pg_cron not available.';
    return;
  end if;

  -- ── iron-slo-snapshot-nightly: 04:00 UTC daily ────────────────────────
  perform cron.unschedule('iron-slo-snapshot-nightly')
    where exists (select 1 from cron.job where jobname = 'iron-slo-snapshot-nightly');

  perform cron.schedule(
    'iron-slo-snapshot-nightly',
    '0 4 * * *',
    $sql$insert into public.iron_slo_history (workspace_id, snapshot)
        select 'default', public.iron_compute_slos('default');$sql$
  );

  -- ── iron-memory-decay-nightly: 05:00 UTC daily ────────────────────────
  perform cron.unschedule('iron-memory-decay-nightly')
    where exists (select 1 from cron.job where jobname = 'iron-memory-decay-nightly');

  perform cron.schedule(
    'iron-memory-decay-nightly',
    '0 5 * * *',
    $sql$select public.iron_decay_memory();$sql$
  );

  raise notice 'Iron v1.9 crons registered: iron-slo-snapshot-nightly (04:00 UTC), iron-memory-decay-nightly (05:00 UTC).';
end;
$cron$;
