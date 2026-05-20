alter table public.voice_captures
  add column if not exists summary_bullets text[];

comment on column public.voice_captures.summary_bullets is
  'Best-effort 5-8 short bullet summary of the voice capture transcript for sales review/history UI. Null means not generated or generation failed.';
