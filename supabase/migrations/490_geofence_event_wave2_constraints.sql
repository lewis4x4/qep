-- 490_geofence_event_wave2_constraints.sql
-- Wave 2 additive event-type taxonomy guard for geofence_events from Cross-Cutting.

-- Keep NOT VALID to avoid blocking local iteration if historical event_type values
-- need cleanup before Wave 3 tightening.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'geofence_events_event_type_check') then
    alter table public.geofence_events
      add constraint geofence_events_event_type_check
      check (event_type in ('enter','exit','dwell','shock','unauthorized')) not valid;
  end if;
end $$;
