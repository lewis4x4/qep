-- ============================================================================
-- Migration 211: QRM P2 Audit Follow-Ups
--
-- Bundles three independent audit follow-ups from the post-Day-9 P2 backlog
-- into a single migration so the deploy story stays clean. None of these
-- changes are related to each other beyond "this is the next round of
-- post-Day-9 cleanup that requires a DB change."
--
-- W3-1 — Tighten profile_role_blend.weight check to (0, 1] (was [0, 1]).
--        Rationale: weight=0 rows are functionally invisible (the frontend
--        and backend narrowers both drop them as tombstones), so allowing
--        the DB to store them creates dead data. Verify-before-apply: no
--        existing row has weight=0 (the migration 210 backfill writes 1.0
--        and the trigger writes 1.0, so this is safe by construction).
--
-- W3-2 — Add role_blend jsonb column to qrm_predictions, populated by the
--        Wave 2 W2-3 ledger code change. Default '[]'::jsonb so existing
--        rows remain valid. GIN index using jsonb_path_ops (cheapest GIN
--        variant) so future grader queries can group by blend without
--        parsing trace_steps.
--
-- W3-3 — Schedule deal-timing-scan via pg_cron at every 6 hours.
--        Rationale: deal-timing-scan was deployed for the first time in
--        the post-Day-9 batch (commit a55c025) but no migration ever
--        scheduled it. Without a schedule it sits dormant on remote.
--        Owner-decided cadence: '0 */6 * * *' (4 runs/day) — matches the
--        natural cadence of customer-side timing events (budget cycles,
--        fleet aging) without overwhelming the alert queue.
--
-- ── Dependency notes ─────────────────────────────────────────────────────
--
-- W3-2 depends on Wave 2's qrm-command-center commit being live in code
-- (to populate the new column on every request). Migration 211 should
-- apply BEFORE the new edge function bundle deploys — otherwise the
-- function would try to insert a column that doesn't exist yet. Safe
-- order: commit Wave 2 → apply Wave 3 → deploy Wave 2.
--
-- W3-1 has no application-layer dependency (it's a tightening of an
-- existing constraint).
--
-- W3-3 has no application-layer dependency (the function itself is
-- already deployed; this just makes pg_cron call it).
-- ============================================================================

-- ── W3-1: tighten profile_role_blend weight check ──────────────────────────

-- Defensive precondition: verify there are no weight=0 rows before
-- swapping the constraint. The migration 210 backfill + trigger both
-- write 1.0 so this should always be true, but we check to fail loudly
-- on any drift.
do $w3_1_precondition$
declare
  _zero_weight_count integer;
begin
  select count(*) into _zero_weight_count
  from public.profile_role_blend
  where weight = 0;
  if _zero_weight_count > 0 then
    raise exception 'Cannot tighten profile_role_blend weight check: % rows have weight=0', _zero_weight_count;
  end if;
end $w3_1_precondition$;

alter table public.profile_role_blend
  drop constraint profile_role_blend_weight_check;

alter table public.profile_role_blend
  add constraint profile_role_blend_weight_check
  check (weight > 0 and weight <= 1);

comment on constraint profile_role_blend_weight_check on public.profile_role_blend is
  'P2 W3-1: weight must be in (0, 1]. Tightened from [0, 1] to forbid weight=0 tombstones — the frontend + backend narrowers already drop them so allowing the DB to store them was creating dead data.';

-- ── W3-2: add role_blend column to qrm_predictions ─────────────────────────

alter table public.qrm_predictions
  add column role_blend jsonb not null default '[]'::jsonb;

comment on column public.qrm_predictions.role_blend is
  'Phase 0 P0.5 W2-3: weighted blend the ranker used at issue time. Shape: [{role: "iron_manager", weight: 0.6}, ...]. For single-role-1.0 users (everyone post-migration-210 backfill) this is [{role: <ironRole>, weight: 1.0}]. Populated by qrm-command-center edge function via _shared/qrm-command-center/prediction-ledger.ts buildPredictionRow().';

-- GIN index using jsonb_path_ops (the cheapest GIN variant — only
-- supports @> containment but that's all the grader needs to filter by
-- "predictions whose blend includes a manager weight of any value").
create index idx_qrm_predictions_role_blend_gin
  on public.qrm_predictions using gin (role_blend jsonb_path_ops);

-- ── W3-3: schedule deal-timing-scan via pg_cron ────────────────────────────
--
-- Pattern lifted verbatim from migration 059 — same vault config probe,
-- same net.http_post body shape, same idempotent unschedule + schedule
-- pair so reapplying this migration is safe.

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping deal-timing-scan cron: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping deal-timing-scan cron: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'app.settings.supabase_url not configured — deal-timing-scan cron NOT scheduled.';
    return;
  end if;

  _service_key := coalesce(
    current_setting('app.settings.service_role_key', true),
    ''
  );

  if _service_key = '' then
    raise notice 'service_role_key not available in app.settings — deal-timing-scan cron NOT scheduled.';
    return;
  end if;

  -- Idempotent: drop the prior schedule (if any) before re-creating.
  perform cron.unschedule('deal-timing-scan-periodic')
    where exists (select 1 from cron.job where jobname = 'deal-timing-scan-periodic');

  perform cron.schedule(
    'deal-timing-scan-periodic',
    '0 */6 * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/deal-timing-scan',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$sql$,
      _base_url, _service_key
    )
  );

  raise notice 'Scheduled deal-timing-scan-periodic every 6 hours (4 runs/day).';

exception
  when undefined_object then
    raise notice 'pg_cron / pg_net config missing — deal-timing-scan cron skipped.';
end $cron$;
