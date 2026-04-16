-- ============================================================================
-- Migration 274: owner_briefs cache table + owner_team_signals RPC
--
-- 1. owner_briefs — stores the latest Claude-generated morning narrative.
--    The owner-morning-brief edge fn checks this table first and only calls
--    the LLM if the cache is older than 60 minutes (or refresh=true).
--
-- 2. owner_team_signals() — per-rep YTD performance grid for Tier 5. Pulls
--    from qrm_deals + qrm_activities with defensive try/except.
-- ============================================================================

create table if not exists public.owner_briefs (
  workspace_id text primary key,
  brief_text text not null,
  model text,
  tokens_in integer,
  tokens_out integer,
  event_count integer,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.owner_briefs enable row level security;

-- Service role writes; owners read.
drop policy if exists owner_briefs_select on public.owner_briefs;
create policy owner_briefs_select on public.owner_briefs
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('owner', 'admin')
    )
  );

comment on table public.owner_briefs is
  '60-min cache for the AI Owner Brief narrative on /owner. Keyed per workspace.';

grant select on public.owner_briefs to authenticated;

-- ── RPC: owner_team_signals ─────────────────────────────────────────────────

create or replace function public.owner_team_signals(
  p_workspace text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_reps jsonb;
begin
  ws := coalesce(p_workspace, public.get_my_workspace(), 'default');

  begin
    select coalesce(jsonb_agg(row_to_json(t) order by (t.ytd_bookings) desc nulls last), '[]'::jsonb)
    into v_reps
    from (
      select
        coalesce(p.full_name, p.email, 'unassigned')              as rep_name,
        d.owner_id                                                as rep_id,
        count(*) filter (where d.status = 'closed_won'
                         and d.created_at >= date_trunc('year', now()))::int
                                                                  as ytd_wins,
        coalesce(sum(d.amount) filter (
          where d.status = 'closed_won'
            and d.created_at >= date_trunc('year', now())
        ), 0)::numeric(14,2)                                      as ytd_bookings,
        count(*) filter (where d.status not in ('closed_won', 'closed_lost')
                         or d.status is null)::int                as open_deals,
        round(
          count(*) filter (where d.status = 'closed_won')::numeric
          / nullif(count(*) filter (where d.status in ('closed_won', 'closed_lost')), 0)
          * 100, 1
        )                                                         as close_rate_pct,
        avg(extract(days from (d.updated_at - d.created_at)))
          filter (where d.status = 'closed_won')                  as avg_close_days
      from public.qrm_deals d
      left join public.profiles p on p.id = d.owner_id
      where d.workspace_id = ws
        and d.deleted_at is null
        and d.owner_id is not null
      group by d.owner_id, p.full_name, p.email
      order by ytd_bookings desc
      limit p_limit
    ) t;
  exception when others then v_reps := '[]'::jsonb; end;

  return jsonb_build_object(
    'generated_at', now(),
    'workspace_id', ws,
    'reps', v_reps
  );
end;
$$;

grant execute on function public.owner_team_signals(text, integer) to authenticated;
