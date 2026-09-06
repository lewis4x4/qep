-- pg_cron connects as postgres without PostgREST JWT settings. Supply only the
-- scheduled evaluator's transaction-local claims; preserve its body and ACL.
begin;

do $migration$
declare
  v_job cron.job%rowtype;
  v_after cron.job%rowtype;
  v_command constant text := $command$do $scheduled$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.rental_evaluate_geofence_crossings(null);
end
$scheduled$;$command$;
begin
  if to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then
    raise exception 'Expected cron.alter_job signature unavailable';
  end if;

  -- Hosted postgres may read cron.job but cannot take UPDATE row locks. Use
  -- the extension API exclusively for mutations and serialize cooperating
  -- repairs without additional table grants. Apply in SERIALIZABLE isolation
  -- to reject concurrent changes made by other scheduler administrators.
  perform pg_advisory_xact_lock(hashtextextended('rental-geofence-evaluate', 0));
  -- STRICT also rejects duplicate names owned by different database roles.
  select * into strict v_job from cron.job
    where jobname = 'rental-geofence-evaluate';
  if v_job.username <> 'postgres' or v_job.database <> 'postgres'
     or v_job.username is null or v_job.database is null then
    raise exception 'Unexpected rental-geofence-evaluate owner or database';
  end if;
  if v_job.command is distinct from 'select public.rental_evaluate_geofence_crossings(null)'
     and v_job.command is distinct from v_command then
    raise exception 'Unexpected rental-geofence-evaluate command; review before replacing';
  end if;

  perform cron.alter_job(job_id := v_job.jobid, command := v_command);
  select * into strict v_after from cron.job where jobid = v_job.jobid;
  if v_after.command is distinct from v_command
     or (to_jsonb(v_after) - 'command') is distinct from (to_jsonb(v_job) - 'command') then
    raise exception 'Rental geofence cron metadata changed beyond command';
  end if;
end
$migration$;

commit;
