-- ============================================================================
-- Migration 186: Wave 6.11 Flare upgrade — Phases G/J
--
-- (G) Declare the flare-artifacts Storage bucket + RLS policies on
--     storage.objects so the bucket exists explicitly (replaces the
--     fragile "create on first run from edge fn" pattern).
--
-- (J) Add 'aha_moment' as a 5th severity. Captures positive feedback
--     signal — routes to Slack only, never email/Linear/Paperclip.
--
-- (J) Upgrade flare_dedupe_count with a p_first_error parameter so the
--     "seen N times this week" chip considers console-error message
--     similarity in addition to route + description.
-- ============================================================================

-- ── 1. Storage bucket + RLS (idempotent) ────────────────────────────────

-- Bucket creation (no-op if it already exists)
insert into storage.buckets (id, name, public)
  values ('flare-artifacts', 'flare-artifacts', false)
  on conflict (id) do nothing;

-- Bucket RLS: workspace-prefix scoping. Path convention is
-- {workspace_id}/{report_id}/{filename}, so the workspace_id is the
-- first path segment.
do $$
begin
  -- Drop any prior policies we own (in case the migration reruns)
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'flare_artifacts_workspace_read'
  ) then
    drop policy "flare_artifacts_workspace_read" on storage.objects;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'flare_artifacts_workspace_insert'
  ) then
    drop policy "flare_artifacts_workspace_insert" on storage.objects;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'flare_artifacts_service_all'
  ) then
    drop policy "flare_artifacts_service_all" on storage.objects;
  end if;
end $$;

-- Workspace read: any authed user in the workspace can SELECT objects
-- in their workspace prefix. Used by /admin/flare detail drawer.
create policy "flare_artifacts_workspace_read" on storage.objects for select
  using (
    bucket_id = 'flare-artifacts'
    and (storage.foldername(name))[1] = public.get_my_workspace()
  );

-- Workspace insert: only the edge fn writes via service role; this
-- policy is just a guardrail in case a client ever attempts upload.
create policy "flare_artifacts_workspace_insert" on storage.objects for insert
  with check (
    bucket_id = 'flare-artifacts'
    and (storage.foldername(name))[1] = public.get_my_workspace()
  );

-- Service role bypass for the edge fn (which already runs as service role)
create policy "flare_artifacts_service_all" on storage.objects for all
  using (auth.role() = 'service_role' and bucket_id = 'flare-artifacts')
  with check (auth.role() = 'service_role' and bucket_id = 'flare-artifacts');

-- ── 2. Add 'aha_moment' severity (Phase J) ──────────────────────────────

alter table public.flare_reports drop constraint if exists flare_reports_severity_check;
alter table public.flare_reports add constraint flare_reports_severity_check
  check (severity in ('blocker', 'bug', 'annoyance', 'idea', 'aha_moment'));

-- Same for the AI severity recommendation column
alter table public.flare_reports drop constraint if exists flare_reports_ai_severity_recommendation_check;
alter table public.flare_reports add constraint flare_reports_ai_severity_recommendation_check
  check (ai_severity_recommendation is null or ai_severity_recommendation in
    ('blocker', 'bug', 'annoyance', 'idea', 'aha_moment'));

-- ── 3. Upgrade flare_dedupe_count with first-error similarity ───────────

create or replace function public.flare_dedupe_count(
  p_route text,
  p_description text,
  p_threshold numeric default 0.4,
  p_first_error text default null
) returns integer
language plpgsql
security invoker
stable
as $$
declare
  v_count integer;
begin
  select count(*)::int into v_count
    from public.flare_reports f
    where f.workspace_id = public.get_my_workspace()
      and f.created_at > now() - interval '7 days'
      and f.status != 'duplicate'
      and (
        f.route = p_route
        or extensions.similarity(lower(f.user_description), lower(p_description)) >= p_threshold
        or (
          p_first_error is not null
          and jsonb_array_length(coalesce(f.console_errors, '[]'::jsonb)) > 0
          and extensions.similarity(
            lower(coalesce((f.console_errors -> 0 ->> 'message'), '')),
            lower(p_first_error)
          ) >= p_threshold
        )
      );
  return coalesce(v_count, 0);
end;
$$;

comment on function public.flare_dedupe_count(text, text, numeric, text) is
  'Wave 6.11 Phase J: fuzzy dedupe count over the last 7 days. Matches on exact route OR pg_trgm similarity ≥ threshold on user_description OR first console_error message similarity. Powers the "seen N times this week" chip.';
