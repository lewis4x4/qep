-- Morning briefing storage: personalized daily summaries per user.

create table public.morning_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id text not null default 'default',
  briefing_date date not null default current_date,
  content text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, briefing_date)
);

alter table public.morning_briefings enable row level security;

create policy "morning_briefings_own" on public.morning_briefings
  for select using (user_id = auth.uid());

create policy "morning_briefings_elevated_select" on public.morning_briefings
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "morning_briefings_service" on public.morning_briefings
  for all using (auth.role() = 'service_role');

create index idx_morning_briefings_user_date
  on public.morning_briefings (user_id, briefing_date desc);
