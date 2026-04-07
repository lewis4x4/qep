-- Knowledge base observability:
-- - retrieval analytics
-- - KB job run telemetry for embed / maintenance workflows

create table if not exists public.retrieval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  trace_id text not null,
  user_id uuid references public.profiles(id) on delete set null,
  query_text text not null,
  evidence_count integer not null default 0,
  top_source_type text,
  top_confidence double precision,
  latency_ms integer,
  feedback text check (feedback in ('helpful', 'not_helpful', 'irrelevant')),
  embedding_ok boolean not null default true,
  tool_rounds_used integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.retrieval_events is
  'Per-query retrieval telemetry for the QEP knowledge assistant.';

alter table public.retrieval_events enable row level security;

create policy "retrieval_events_elevated_select" on public.retrieval_events
  for select using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "retrieval_events_service_all" on public.retrieval_events
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_retrieval_events_workspace_created
  on public.retrieval_events (workspace_id, created_at desc);

create index idx_retrieval_events_trace
  on public.retrieval_events (trace_id);

create table if not exists public.kb_job_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_name text not null check (job_name in ('embed_crm', 'kb_maintenance')),
  status text not null check (status in ('started', 'success', 'error')),
  processed_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.kb_job_runs is
  'Execution telemetry for knowledge-base embedding and maintenance jobs.';

alter table public.kb_job_runs enable row level security;

create policy "kb_job_runs_elevated_select" on public.kb_job_runs
  for select using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "kb_job_runs_service_all" on public.kb_job_runs
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_kb_job_runs_job_created
  on public.kb_job_runs (job_name, created_at desc);

create or replace function public.kb_health_snapshot()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'documents', (
      select jsonb_build_object(
        'published', count(*) filter (where status = 'published'),
        'pending_review', count(*) filter (where status = 'pending_review'),
        'draft', count(*) filter (where status = 'draft'),
        'archived', count(*) filter (where status = 'archived'),
        'ingest_failed', count(*) filter (where status = 'ingest_failed'),
        'overdue_review', count(*) filter (
          where status = 'published'
            and review_due_at is not null
            and review_due_at <= now()
        )
      )
      from public.documents
    ),
    'top_knowledge_gaps', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', gap.id,
            'question', gap.question,
            'frequency', gap.frequency,
            'last_asked_at', gap.last_asked_at
          )
          order by gap.frequency desc, gap.last_asked_at desc
        ),
        '[]'::jsonb
      )
      from (
        select id, question, frequency, last_asked_at
        from public.knowledge_gaps
        where resolved = false
        order by frequency desc, last_asked_at desc
        limit 10
      ) gap
    ),
    'embeddings', (
      with stats as (
        select
          count(*) as total,
          count(*) filter (where updated_at >= now() - interval '24 hours') as fresh_last_24h
        from public.crm_embeddings
      )
      select jsonb_build_object(
        'total', stats.total,
        'fresh_last_24h', stats.fresh_last_24h,
        'fresh_pct', case
          when stats.total = 0 then 0
          else round((stats.fresh_last_24h::numeric / stats.total::numeric) * 100, 2)
        end
      )
      from stats
    ),
    'last_embed_crm_run', (
      select jsonb_build_object(
        'status', run.status,
        'processed_count', run.processed_count,
        'error_count', run.error_count,
        'finished_at', run.finished_at,
        'created_at', run.created_at
      )
      from public.kb_job_runs run
      where run.job_name = 'embed_crm'
      order by coalesce(run.finished_at, run.created_at) desc
      limit 1
    ),
    'retrieval_events_last_24h', (
      select count(*)
      from public.retrieval_events
      where created_at >= now() - interval '24 hours'
    )
  );
$$;

revoke execute on function public.kb_health_snapshot() from public;
grant execute on function public.kb_health_snapshot() to authenticated, service_role;
