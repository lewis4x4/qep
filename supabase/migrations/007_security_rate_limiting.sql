-- SEC-QEP-006: Per-user rate limiting on AI endpoints
-- Stores a rolling log of requests per user per endpoint.
-- check_rate_limit() atomically cleans the window, counts, and inserts.

create table public.rate_limit_log (
  id         bigserial    primary key,
  user_id    uuid         not null references auth.users(id) on delete cascade,
  endpoint   text         not null,
  created_at timestamptz  not null default now()
);

create index rate_limit_log_lookup_idx
  on public.rate_limit_log (user_id, endpoint, created_at desc);

alter table public.rate_limit_log enable row level security;

-- Only the service role (edge functions) may read/write this table directly
create policy "rate_limit_service_only" on public.rate_limit_log
  for all using (auth.role() = 'service_role');

-- Atomic rate-limit check: cleans old entries, counts the window, inserts on pass.
-- Returns true (allow) or false (reject).
create or replace function public.check_rate_limit(
  p_user_id       uuid,
  p_endpoint      text,
  p_max_requests  int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        int;
begin
  v_window_start := now() - (p_window_seconds || ' seconds')::interval;

  -- Remove expired entries for this user+endpoint
  delete from public.rate_limit_log
  where user_id = p_user_id
    and endpoint = p_endpoint
    and created_at < v_window_start;

  -- Count requests still in the window
  select count(*) into v_count
  from public.rate_limit_log
  where user_id = p_user_id
    and endpoint = p_endpoint
    and created_at >= v_window_start;

  if v_count >= p_max_requests then
    return false;
  end if;

  -- Record this request
  insert into public.rate_limit_log (user_id, endpoint)
  values (p_user_id, p_endpoint);

  return true;
end;
$$;

-- Only service_role may call this function (edge functions use service role key)
revoke execute on function public.check_rate_limit(uuid, text, int, int) from public;
grant  execute on function public.check_rate_limit(uuid, text, int, int) to service_role;
