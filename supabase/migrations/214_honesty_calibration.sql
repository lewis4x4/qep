-- ============================================================================
-- Migration 214: QRM Honesty Calibration Index (Phase 0 P0.6 / Day 10)
--
-- Creates the integrity substrate: a system-wide score that goes up when
-- reported state matches observed state and down when it diverges.
--
-- 3 tables:
--   1. qrm_honesty_probes     — probe registry (8 rows seeded: 6 live, 2 stubs)
--   2. qrm_honesty_observations — per-event discrepancy observations
--   3. qrm_honesty_daily       — per-workspace per-day rollup with honesty_index
--
-- Plus a cron schedule for qrm-honesty-scan (daily at 03:00 UTC) using
-- the modern pattern from migration 205/212/213.
--
-- Owner: Brian (demo owner seed ID 10000000-0000-4000-8000-000000000001)
-- per roadmap §15 Q2 default. Update when ownership is formally assigned.
--
-- Exit gate (Day 10): 8 probes registered, exactly 2 stubbed, exactly 6
-- producing observations when the function runs against real data.
-- ============================================================================

-- ── Table 1: qrm_honesty_probes (probe registry) ───────────────────────────

create table public.qrm_honesty_probes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  probe_name text not null,
  probe_type text not null check (probe_type in ('data_integrity', 'behavioral', 'compliance')),
  description text,
  is_enabled boolean not null default true,
  depends_on text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, probe_name)
);

comment on table public.qrm_honesty_probes is
  'Phase 0 P0.6: probe registry for the Honesty Calibration Index. 8 probes total: 6 live (is_enabled=true), 2 stubs (is_enabled=false with depends_on set). Each probe detects a specific class of data-integrity or behavioral discrepancy.';

alter table public.qrm_honesty_probes enable row level security;

-- Authenticated users can read the probe registry (it's metadata, not sensitive).
create policy "qrm_honesty_probes_select_authenticated"
  on public.qrm_honesty_probes for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- Only service role can write (the probes are seeded by this migration and
-- managed by the platform, not by operators).
create policy "qrm_honesty_probes_service_all"
  on public.qrm_honesty_probes for all
  using (auth.role() = 'service_role');

create trigger qrm_honesty_probes_set_updated_at
  before update on public.qrm_honesty_probes
  for each row execute function public.set_updated_at();

-- ── Seed 8 probes ───────────────────────────────────────────────────────────

insert into public.qrm_honesty_probes (workspace_id, probe_name, probe_type, description, is_enabled, depends_on) values
  ('default', 'high_prob_no_activity_14d', 'behavioral',
   'Flags deals with stage probability >= 70% but no activity in 14+ days. Suggests the probability is overstated or the rep is neglecting a hot deal.',
   true, null),
  ('default', 'close_imminent_no_activity', 'behavioral',
   'Flags deals expected to close within 7 days but with no activity in 14+ days. Close date may be stale.',
   true, null),
  ('default', 'closed_lost_no_reason', 'compliance',
   'Flags closed-lost deals with no loss_reason documented. Loss analysis requires knowing why the deal was lost.',
   true, null),
  ('default', 'deposit_state_mismatch', 'data_integrity',
   'Flags deals marked deposit_status=verified but with no matching verified deposits row. Data integrity failure.',
   true, null),
  ('default', 'margin_passed_no_pct', 'data_integrity',
   'Flags deals with margin_check_status=passed or approved_by_manager but margin_pct is null. The check passed on nothing.',
   true, null),
  ('default', 'retroactive_activity', 'behavioral',
   'Flags activities where occurred_at is > 48 hours after created_at. May indicate a rep backdating an activity to reset decay or meet KPIs.',
   true, null),
  ('default', 'meaningful_contact_decay_proximity', 'behavioral',
   'STUB — flags activities created within 24h of an accounts decay threshold. Depends on Phase 2 Slice 2.X meaningful-contact calculation engine.',
   false, 'phase-2-slice-2.x-meaningful-contact'),
  ('default', 'protected_account_gaming', 'behavioral',
   'STUB — flags disproportionate protected-account ratios, protective-timing, and chronic-protection patterns. Depends on Phase 3 Slice 3.3 Account Command Center override workflow.',
   false, 'phase-3-slice-3.3-account-override');

-- ── Table 2: qrm_honesty_observations ───────────────────────────────────────

create table public.qrm_honesty_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  probe_id uuid not null references public.qrm_honesty_probes(id) on delete cascade,
  observed_at timestamptz not null default now(),
  observation_type text not null,
  entity_type text,
  entity_id uuid,
  expected_state text not null,
  actual_state text not null,
  discrepancy_score numeric not null check (discrepancy_score >= 0 and discrepancy_score <= 1),
  attributed_user_id uuid references public.profiles(id) on delete set null,
  -- Default owner = demo owner seed ID per roadmap §15 Q2. Replace with
  -- Brian's real user_id once ownership is formally assigned.
  assigned_owner_id uuid not null default '10000000-0000-4000-8000-000000000001',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.qrm_honesty_observations is
  'Phase 0 P0.6: per-event honesty observations produced by the nightly qrm-honesty-scan function. Each row records one discrepancy between reported and observed state.';

alter table public.qrm_honesty_observations enable row level security;

-- Service role: full access (the scan function writes, the grader reads).
create policy "qrm_honesty_observations_service_all"
  on public.qrm_honesty_observations for all
  using (auth.role() = 'service_role');

-- Inserts: service role only.
create policy "qrm_honesty_observations_insert_service"
  on public.qrm_honesty_observations for insert
  with check (auth.role() = 'service_role');

-- Reads: managers + owners + admins see all observations.
create policy "qrm_honesty_observations_select_elevated"
  on public.qrm_honesty_observations for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

-- Indexes
create index idx_qrm_honesty_observations_workspace_time
  on public.qrm_honesty_observations (workspace_id, observed_at desc);

create index idx_qrm_honesty_observations_probe_time
  on public.qrm_honesty_observations (probe_id, observed_at desc);

create index idx_qrm_honesty_observations_user_time
  on public.qrm_honesty_observations (attributed_user_id, observed_at desc)
  where attributed_user_id is not null;

-- ── Table 3: qrm_honesty_daily (per-workspace per-day rollup) ──────────────

create table public.qrm_honesty_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rollup_date date not null,
  total_observations integer not null default 0,
  total_discrepancy numeric not null default 0,
  honesty_index numeric not null check (honesty_index >= 0 and honesty_index <= 1),
  probe_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, rollup_date)
);

comment on table public.qrm_honesty_daily is
  'Phase 0 P0.6: daily rollup of the Honesty Calibration Index per workspace. honesty_index = 1 - (total_discrepancy / max(total_observations, 1)). Not yet visible to operators — ownership view arrives in Phase 3.';

alter table public.qrm_honesty_daily enable row level security;

-- Service role: full access (the scan function writes/upserts).
create policy "qrm_honesty_daily_service_all"
  on public.qrm_honesty_daily for all
  using (auth.role() = 'service_role');

-- Reads: managers + owners + admins see the daily rollup.
create policy "qrm_honesty_daily_select_elevated"
  on public.qrm_honesty_daily for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

create trigger qrm_honesty_daily_set_updated_at
  before update on public.qrm_honesty_daily
  for each row execute function public.set_updated_at();

create index idx_qrm_honesty_daily_workspace_date
  on public.qrm_honesty_daily (workspace_id, rollup_date desc);

-- ── Cron: qrm-honesty-scan-nightly at 03:00 UTC ────────────────────────────
--
-- Same modern pattern as migration 205 / 212 / 213: hardcoded URL +
-- x-internal-service-secret extracted from flow-runner.
--
-- 03:00 UTC = 10pm CT. Runs after qrm-prediction-scorer (02:00) and
-- before morning-briefing (11:00). Low-traffic window.

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot schedule qrm-honesty-scan';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot schedule qrm-honesty-scan';
  end if;

  v_secret := split_part(
    split_part(
      (select command from cron.job where jobname = 'flow-runner' limit 1),
      $tag1$x-internal-service-secret', '$tag1$,
      2
    ),
    $tag2$'$tag2$,
    1
  );

  if v_secret is null or v_secret = '' then
    raise exception 'Could not extract internal-service-secret from flow-runner cron command.';
  end if;

  raise notice 'Resolved internal-service-secret from flow-runner (% chars)', length(v_secret);

  if exists (select 1 from cron.job where jobname = 'qrm-honesty-scan-nightly') then
    perform cron.unschedule('qrm-honesty-scan-nightly');
    raise notice 'Unscheduled existing qrm-honesty-scan-nightly';
  end if;

  perform cron.schedule(
    'qrm-honesty-scan-nightly',
    '0 3 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/qrm-honesty-scan',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled qrm-honesty-scan-nightly at 0 3 * * * (daily 03:00 UTC)';
end;
$do$;
