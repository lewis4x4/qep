-- 485_technician_profile_wave2_columns.sql
-- Wave 2 technician profile extensions from Phase-4 and Cross-Cutting.

alter table public.technician_profiles
  add column if not exists work_order_rate_per_hour_cents bigint,
  add column if not exists work_order_cost_per_hour_cents bigint,
  add column if not exists work_order_account text,
  add column if not exists service_location text,
  add column if not exists inside_outside_shift text,
  add column if not exists road_technician boolean not null default false,
  add column if not exists drag_and_stick boolean not null default false,
  add column if not exists weekly_schedule jsonb not null default '{"mon":9,"tue":9,"wed":9,"thu":9,"fri":9,"sat":0,"sun":0}'::jsonb,
  add column if not exists shop_class text;

comment on column public.technician_profiles.work_order_rate_per_hour_cents is 'Billable WO rate per hour in cents from IntelliDealer technician profile.';
comment on column public.technician_profiles.work_order_cost_per_hour_cents is 'Cost WO rate per hour in cents for recovery calculations.';
comment on column public.technician_profiles.weekly_schedule is 'IntelliTech weekly capacity grid hours by day.';
comment on column public.technician_profiles.shop_class is 'Inside/outside/both shop class from employee/service scheduling.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'technician_profiles_shop_class_chk') then
    alter table public.technician_profiles
      add constraint technician_profiles_shop_class_chk
      check (shop_class is null or shop_class in ('inside','outside','both')) not valid;
  end if;
end $$;
