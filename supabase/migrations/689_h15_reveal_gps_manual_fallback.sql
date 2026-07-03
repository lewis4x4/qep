-- ============================================================================
-- Migration 689: H15.1 Reveal GPS/manual mileage fallback
--
-- Adds provider-neutral mileage source fields for future Verizon Reveal/GPS
-- ingestion while preserving manual mileage as the zero-blocking fallback for
-- field service and haul workflows.
-- ============================================================================

BEGIN;

alter table public.telematics_feeds
  add column if not exists last_odometer_miles numeric(12, 2);

comment on column public.telematics_feeds.last_odometer_miles is
  'H15 provider-neutral odometer/mileage reading from GPS/telematics adapters, including future Verizon Reveal vehicle feeds.';

alter table public.service_jobs
  add column if not exists field_mileage_miles numeric(10, 2),
  add column if not exists field_mileage_source text not null default 'manual',
  add column if not exists field_mileage_recorded_at timestamptz,
  add column if not exists field_mileage_provider text,
  add column if not exists field_mileage_provider_trip_id text,
  add column if not exists field_mileage_metadata jsonb not null default '{}'::jsonb;

comment on column public.service_jobs.field_mileage_miles is
  'H15 field-service one-way or billable mileage. Manual entry is the required fallback when Verizon Reveal/GPS is absent.';
comment on column public.service_jobs.field_mileage_source is
  'H15 source for field_mileage_miles: manual, verizon_reveal, generic_telematics, or none.';
comment on column public.service_jobs.field_mileage_recorded_at is
  'H15 timestamp for the mileage source reading or manual entry.';
comment on column public.service_jobs.field_mileage_provider is
  'H15 provider key for GPS mileage, for example verizon_reveal or generic_telematics.';
comment on column public.service_jobs.field_mileage_provider_trip_id is
  'H15 provider trip/route identifier used to reconcile GPS mileage to the service work order.';
comment on column public.service_jobs.field_mileage_metadata is
  'H15 mileage reconciliation metadata, including odometer/hour-meter context and provider payload references.';

alter table public.traffic_tickets
  add column if not exists mileage_source text not null default 'manual',
  add column if not exists mileage_provider text,
  add column if not exists mileage_provider_trip_id text,
  add column if not exists mileage_metadata jsonb not null default '{}'::jsonb;

comment on column public.traffic_tickets.mileage_source is
  'H15 source for service haul mileage: manual fallback, verizon_reveal, generic_telematics, or none.';
comment on column public.traffic_tickets.mileage_provider is
  'H15 provider key for haul GPS mileage.';
comment on column public.traffic_tickets.mileage_provider_trip_id is
  'H15 provider trip/route identifier for haul GPS mileage reconciliation.';
comment on column public.traffic_tickets.mileage_metadata is
  'H15 haul mileage reconciliation metadata, including GPS/manual provenance and dispatch context.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_jobs_h15_field_mileage_nonnegative_chk') then
    alter table public.service_jobs
      add constraint service_jobs_h15_field_mileage_nonnegative_chk
      check (field_mileage_miles is null or field_mileage_miles >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_h15_field_mileage_source_chk') then
    alter table public.service_jobs
      add constraint service_jobs_h15_field_mileage_source_chk
      check (field_mileage_source in ('manual', 'verizon_reveal', 'generic_telematics', 'none')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'traffic_tickets_h15_mileage_source_chk') then
    alter table public.traffic_tickets
      add constraint traffic_tickets_h15_mileage_source_chk
      check (mileage_source in ('manual', 'verizon_reveal', 'generic_telematics', 'none')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'telematics_feeds_h15_odometer_nonnegative_chk') then
    alter table public.telematics_feeds
      add constraint telematics_feeds_h15_odometer_nonnegative_chk
      check (last_odometer_miles is null or last_odometer_miles >= 0) not valid;
  end if;
end $$;

create index if not exists idx_service_jobs_h15_field_mileage_source
  on public.service_jobs(workspace_id, field_mileage_source, field_mileage_recorded_at desc)
  where field_mileage_miles is not null;

comment on index public.idx_service_jobs_h15_field_mileage_source is
  'H15 audit index for field-service mileage source review and Reveal/manual fallback reconciliation.';

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%689_h15_reveal_gps_manual_fallback.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.5, Section 5 ADD (Verizon Reveal)') ||
      ' | supabase/migrations/689_h15_reveal_gps_manual_fallback.sql' ||
      ' | supabase/functions/_shared/service-mileage-source.ts' ||
      ' | supabase/functions/_shared/telematics-adapter.ts' ||
      ' | supabase/functions/_shared/adapters/generic-telematics.ts' ||
      ' | supabase/functions/telematics-ingest/index.ts' ||
      ' | supabase/functions/service-haul-router/index.ts' ||
      ' | supabase/functions/service-quote-engine/index.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H15.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H15.1 shipped: provider-neutral mileage fields now support future Verizon Reveal/GPS readings, telematics feeds retain odometer mileage, service jobs and haul tickets record mileage source/provider/trip metadata, service-haul-router keeps manual mileage as the default source, and service-quote-engine adds field-mileage quote charges from manual or provider-derived job mileage without requiring live Reveal credentials.'
  END,
  updated_at = now()
WHERE task_id = 'H15.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H15.1',
  'update',
  jsonb_build_object(
    'reason', 'h15_reveal_gps_manual_fallback',
    'migration', '689_h15_reveal_gps_manual_fallback.sql',
    'mission_alignment', 'pass: field and haul mileage can be costed and audited now with a manual fallback, while future Verizon Reveal/GPS readings have a provider-neutral landing zone that does not block service execution',
    'implementation_evidence', jsonb_build_array(
      'public.telematics_feeds.last_odometer_miles',
      'public.service_jobs.field_mileage_miles/source/provider_trip_id/metadata',
      'public.traffic_tickets.mileage_source/provider_trip_id/metadata',
      'supabase/functions/_shared/service-mileage-source.ts source normalization',
      'supabase/functions/_shared/telematics-adapter.ts odometer mileage reading contract',
      'supabase/functions/telematics-ingest/index.ts last_odometer_miles persistence',
      'supabase/functions/service-haul-router/index.ts manual/default haul mileage source audit',
      'supabase/functions/service-quote-engine/index.ts field mileage optional quote line'
    )
  ),
  'codex'
);

COMMIT;
