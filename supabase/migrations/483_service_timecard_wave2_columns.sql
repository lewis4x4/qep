-- 483_service_timecard_wave2_columns.sql
-- Wave 2 segment linkage for service_timecards from Phase-4.

alter table public.service_timecards
  add column if not exists segment_id uuid references public.service_job_segments(id) on delete set null;

comment on column public.service_timecards.segment_id is 'Wave 1 service job segment worked on by this timecard row.';

create index if not exists idx_service_timecards_segment
  on public.service_timecards (workspace_id, segment_id, clocked_in_at desc)
  where segment_id is not null;
comment on index public.idx_service_timecards_segment is 'Purpose: technician recovery and segment labor rollups.';
