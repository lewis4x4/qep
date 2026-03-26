-- HubSpot Follow-Up Automation Schema

create table public.hubspot_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  hub_id text not null,
  hub_domain text,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scopes text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, hub_id)
);

alter table public.hubspot_connections enable row level security;

create policy "hubspot_connections_owner" on public.hubspot_connections
  for all using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('owner', 'manager')
    )
  );

create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger_stage text not null default 'quote_sent',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.follow_up_sequences enable row level security;

create policy "sequences_select_authenticated" on public.follow_up_sequences
  for select using (auth.role() = 'authenticated');

create policy "sequences_write_elevated" on public.follow_up_sequences
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
    )
  );

create type public.followup_step_type as enum ('task', 'email', 'call_log', 'stalled_alert');

create table public.follow_up_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.follow_up_sequences(id) on delete cascade,
  step_number integer not null,
  day_offset integer not null,
  step_type public.followup_step_type not null,
  subject text,
  body_template text,
  task_priority text default 'MEDIUM',
  created_at timestamptz not null default now(),
  unique(sequence_id, step_number)
);

alter table public.follow_up_steps enable row level security;

create policy "steps_select_authenticated" on public.follow_up_steps
  for select using (auth.role() = 'authenticated');

create policy "steps_write_elevated" on public.follow_up_steps
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
    )
  );

create type public.enrollment_status as enum ('active', 'completed', 'paused', 'cancelled');

create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.follow_up_sequences(id),
  deal_id text not null,
  deal_name text,
  contact_id text,
  contact_name text,
  owner_id text,
  hub_id text not null,
  enrolled_at timestamptz not null default now(),
  current_step integer not null default 1,
  next_step_due_at timestamptz,
  status public.enrollment_status not null default 'active',
  completed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(deal_id, sequence_id)
);

alter table public.sequence_enrollments enable row level security;

create policy "enrollments_service_all" on public.sequence_enrollments
  for all using (auth.role() = 'service_role');

create policy "enrollments_select_elevated" on public.sequence_enrollments
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
    )
  );

create type public.activity_type as enum (
  'task_created', 'email_sent', 'call_logged',
  'stalled_alert', 'enrollment_created', 'enrollment_completed',
  'enrollment_cancelled', 'deal_stage_change'
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references public.sequence_enrollments(id),
  deal_id text,
  hub_id text,
  activity_type public.activity_type not null,
  step_number integer,
  hubspot_engagement_id text,
  payload jsonb default '{}',
  error text,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "activity_log_service_all" on public.activity_log
  for all using (auth.role() = 'service_role');

create policy "activity_log_select_elevated" on public.activity_log
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
    )
  );

create trigger set_hubspot_connections_updated_at before update on public.hubspot_connections
  for each row execute function public.set_updated_at();
create trigger set_sequences_updated_at before update on public.follow_up_sequences
  for each row execute function public.set_updated_at();
create trigger set_enrollments_updated_at before update on public.sequence_enrollments
  for each row execute function public.set_updated_at();

-- Default 5-step post-quote sequence seed
insert into public.follow_up_sequences (name, description, trigger_stage, is_active)
values (
  'Post-Quote Follow-Up (5-Step)',
  'Automated follow-up sequence triggered when a deal moves to the quote_sent stage.',
  'quote_sent',
  true
);
