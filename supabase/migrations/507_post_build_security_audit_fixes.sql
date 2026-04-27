-- 507_post_build_security_audit_fixes.sql
-- Post-build P0/P1 security remediations.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.service_jobs
  add column if not exists tracking_token_sha256 text;

comment on column public.service_jobs.tracking_token_sha256 is
  'SHA-256 hash of service_jobs.tracking_token for public status verification without selecting the plaintext token in public edge functions.';

update public.service_jobs
set tracking_token_sha256 = encode(extensions.digest(convert_to(tracking_token, 'UTF8'), 'sha256'), 'hex')
where tracking_token is not null
  and (
    tracking_token_sha256 is null
    or tracking_token_sha256 <> encode(extensions.digest(convert_to(tracking_token, 'UTF8'), 'sha256'), 'hex')
  );

create unique index if not exists idx_service_jobs_tracking_token_sha256
  on public.service_jobs(tracking_token_sha256)
  where tracking_token_sha256 is not null;

create or replace function public.set_service_job_tracking_token_sha256()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tracking_token is null then
    new.tracking_token_sha256 := null;
  else
    new.tracking_token_sha256 := encode(extensions.digest(convert_to(new.tracking_token, 'UTF8'), 'sha256'), 'hex');
  end if;
  return new;
end;
$$;

revoke execute on function public.set_service_job_tracking_token_sha256() from public;

drop trigger if exists trg_service_jobs_tracking_token_sha256 on public.service_jobs;
create trigger trg_service_jobs_tracking_token_sha256
  before insert or update of tracking_token on public.service_jobs
  for each row
  execute function public.set_service_job_tracking_token_sha256();

revoke all on
  public.mv_service_jobs_wip,
  public.mv_service_wip_aging,
  public.qrm_customer_profitability_mv,
  public.mv_customer_ar_aging,
  public.mv_customer_fiscal_ytd
from public, anon, authenticated;

grant select on
  public.mv_service_jobs_wip,
  public.mv_service_wip_aging,
  public.qrm_customer_profitability_mv,
  public.mv_customer_ar_aging,
  public.mv_customer_fiscal_ytd
to service_role;
