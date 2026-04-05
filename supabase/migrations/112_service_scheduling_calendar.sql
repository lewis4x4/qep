-- ============================================================================
-- Migration 112: Calendar-aware scheduling — branch business hours + slot size
-- ============================================================================

alter table public.service_branch_config
  add column if not exists business_hours jsonb not null default '{
    "weekdays": [
      {"dow": 1, "open": "08:00", "close": "17:00"},
      {"dow": 2, "open": "08:00", "close": "17:00"},
      {"dow": 3, "open": "08:00", "close": "17:00"},
      {"dow": 4, "open": "08:00", "close": "17:00"},
      {"dow": 5, "open": "08:00", "close": "17:00"}
    ]
  }'::jsonb;

alter table public.service_branch_config
  add column if not exists appointment_slot_minutes integer not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_branch_config_slot_minutes_chk'
  ) then
    alter table public.service_branch_config
      add constraint service_branch_config_slot_minutes_chk
      check (appointment_slot_minutes >= 15 and appointment_slot_minutes <= 480);
  end if;
end $$;

comment on column public.service_branch_config.business_hours is
  'JSON: { "weekdays": [ { "dow": 1-5 Mon-Fri, "open": "HH:MM", "close": "HH:MM" } ] } — used by service-calendar-slots.';
comment on column public.service_branch_config.appointment_slot_minutes is
  'Default appointment granularity for suggested open slots.';
