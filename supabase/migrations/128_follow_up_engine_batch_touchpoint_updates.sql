-- ============================================================================
-- Migration 128: Batch apply AI follow-up touchpoint updates (follow-up-engine)
--
-- Replaces N per-row UPDATEs from the hourly cron with one statement so total
-- DB round-trips stay < 10 per run (see punch list 2C).
-- ============================================================================

create or replace function public.batch_apply_follow_up_touchpoint_ai(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  update public.follow_up_touchpoints t
  set
    suggested_message = r.suggested_message,
    content_generated_at = r.content_generated_at::timestamptz,
    content_context = coalesce(r.content_context, '{}'::jsonb),
    status = case when coalesce(r.set_overdue, false) then 'overdue' else t.status end,
    updated_at = now()
  from jsonb_to_recordset(p_rows) as r(
    id uuid,
    suggested_message text,
    content_generated_at text,
    content_context jsonb,
    set_overdue boolean
  )
  where t.id = r.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.batch_apply_follow_up_touchpoint_ai(jsonb) is
  'Service-role batch update for follow-up-engine: suggested_message, content, optional overdue.';

revoke all on function public.batch_apply_follow_up_touchpoint_ai(jsonb) from public;
grant execute on function public.batch_apply_follow_up_touchpoint_ai(jsonb) to service_role;
