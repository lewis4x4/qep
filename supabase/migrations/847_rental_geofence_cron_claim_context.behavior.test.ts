import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withScratchPostgres } from "../../scripts/testing/scratch-postgres";

const migration = readFileSync(new URL("./847_rental_geofence_cron_claim_context.sql", import.meta.url), "utf8");
const originalCommand = "select public.rental_evaluate_geofence_crossings(null)";

test("scheduled geofence command supplies local claims without changing authority or job metadata", () => {
  withScratchPostgres(query => {
    // Model the verified hosted pg_cron signature. This tests the generated
    // command in real PostgreSQL, not the pg_cron extension or geofence business logic.
    query(`create schema cron; create schema auth;
      create role authenticated; create role service_role; create role migration_runner;
      create table cron.job(jobid bigint primary key, jobname text, schedule text,
        command text, database text, username text, active boolean);
      create function cron.alter_job(job_id bigint, schedule text default null,
        command text default null, database text default null, username text default null,
        active boolean default null) returns void language plpgsql security definer set search_path=pg_catalog,cron as $$begin
        update cron.job j set schedule=coalesce(alter_job.schedule,j.schedule),
          command=coalesce(alter_job.command,j.command), database=coalesce(alter_job.database,j.database),
          username=coalesce(alter_job.username,j.username), active=coalesce(alter_job.active,j.active)
          where j.jobid=job_id; end$$;
      grant usage on schema cron to migration_runner;
      grant select on cron.job to migration_runner;
      revoke all on function cron.alter_job(bigint,text,text,text,text,boolean) from public;
      grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to migration_runner;
      create function auth.role() returns text language sql stable as $$select coalesce(
        nullif(current_setting('request.jwt.claim.role',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
      create table public.invocations(role_claim text, claims jsonb);
      create function public.rental_evaluate_geofence_crossings(p_workspace_id text default null)
        returns jsonb language plpgsql security definer set search_path=public,extensions as $$begin
        if coalesce((select auth.role()),'') not in ('service_role','authenticated') then
          raise exception 'JWT role required' using errcode='42501'; end if;
        insert into invocations values(current_setting('request.jwt.claim.role',true),
          current_setting('request.jwt.claims',true)::jsonb);
        if current_setting('test.fail',true)='on' then raise exception 'injected evaluator failure'; end if;
        return '{}'::jsonb; end$$;
      revoke all on function public.rental_evaluate_geofence_crossings(text) from public,authenticated;
      grant execute on function public.rental_evaluate_geofence_crossings(text) to service_role;
      insert into cron.job values(78,'rental-geofence-evaluate','*/15 * * * *',
        '${originalCommand}','postgres','postgres',true);`);
    const authoritySql = `select json_build_object('definition',pg_get_functiondef(oid),'acl',proacl)::text
      from pg_proc where oid='public.rental_evaluate_geofence_crossings(text)'::regprocedure;`;
    const authority = query(authoritySql);
    const metadataSql = `select (to_jsonb(j)-'command')::text from cron.job j;`;
    const metadata = query(metadataSql);
    const migrate = () => query(`set default_transaction_isolation='serializable'; set role migration_runner; ${migration}`);
    expect(query(`select has_table_privilege('migration_runner','cron.job','SELECT'),
      has_table_privilege('migration_runner','cron.job','UPDATE');`)).toBe("t|f");
    expect(() => query(`set role migration_runner; select * from cron.job for update;`)).toThrow("permission denied");
    expect(() => query(originalCommand)).toThrow("JWT role required");
    migrate();
    expect(query(metadataSql)).toBe(metadata);
    expect(query(authoritySql)).toBe(authority);
    const command = query(`select command from cron.job where jobid=78;`);
    // Execute the exact persisted job command, with conflicting session claims.
    const result = query(`set request.jwt.claim.role='sentinel';
      set request.jwt.claims='{"role":"sentinel","kept":true}';
      begin; ${command}
      select 'during='||auth.role(); commit;
      select 'after='||auth.role();
      select 'claims='||current_setting('request.jwt.claims');`);
    expect(result).toContain("during=service_role");
    expect(result).toContain("after=sentinel");
    expect(result).toContain('claims={"role":"sentinel","kept":true}');
    expect(query(`select json_agg(i)::text from public.invocations i;`))
      .toBe('[{"role_claim":"service_role","claims":{"role": "service_role"}}]');
    // A fresh cron-like connection has no residual claims after autocommit.
    expect(query(`${command} select coalesce(nullif(auth.role(),''),'unset');`).split("\n").at(-1)).toBe("unset");
    expect(query(`select count(*) from public.invocations;`)).toBe("2");
    // PostgreSQL's error subtransaction restores both settings and rolls back
    // the evaluator effect before the surrounding connection can be reused.
    const failed = query(`set request.jwt.claim.role='sentinel';
      set request.jwt.claims='{"role":"sentinel","kept":true}'; set test.fail='on';
      do $test$ begin
        begin execute $job$${command}$job$;
          raise exception 'expected evaluator error was not raised';
        exception when others then
          if sqlerrm <> 'injected evaluator failure' then raise; end if;
        end;
      end $test$;
      select 'after='||auth.role();
      select 'claims='||current_setting('request.jwt.claims');`);
    expect(failed).toContain("after=sentinel");
    expect(failed).toContain('claims={"role":"sentinel","kept":true}');
    expect(query(`select count(*) from public.invocations;`)).toBe("2");
    expect(() => query(`set role authenticated; ${originalCommand};`)).toThrow("permission denied");
    // Reapplying preserves an intentionally inactive job and its nondefault schedule.
    query(`update cron.job set active=false,schedule='7 * * * *';`);
    const paused = query(metadataSql);
    migrate();
    expect(query(metadataSql)).toBe(paused);
  });
}, 30_000);

test("cron repair fails closed for missing job, wrong owner/database, or unexpected command", () => {
  withScratchPostgres(query => {
    query(`create schema cron; create role migration_runner;
      create table cron.job(jobid bigint,jobname text,schedule text,command text,database text,username text,active boolean);
      create function cron.alter_job(job_id bigint,schedule text default null,command text default null,
        database text default null,username text default null,active boolean default null)
        returns void language sql security definer set search_path=pg_catalog,cron as $$select null::void$$;
      grant usage on schema cron to migration_runner;
      grant select on cron.job to migration_runner;
      revoke all on function cron.alter_job(bigint,text,text,text,text,boolean) from public;
      grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to migration_runner;`);
    const migrate = () => query(`set default_transaction_isolation='serializable'; set role migration_runner; ${migration}`);
    expect(migrate).toThrow("query returned no rows");
    query(`insert into cron.job values(9,'rental-geofence-evaluate','*/15 * * * *',
      '${originalCommand}','postgres','other_owner',true);`);
    expect(migrate).toThrow("Unexpected rental-geofence-evaluate owner or database");
    query(`update cron.job set username='postgres',database='other_database';`);
    expect(migrate).toThrow("Unexpected rental-geofence-evaluate owner or database");
    query(`update cron.job set database='postgres',command='select 42';`);
    expect(migrate).toThrow("Unexpected rental-geofence-evaluate command");
    expect(query(`select command from cron.job;`)).toBe("select 42");
    query(`update cron.job set command='${originalCommand}';`);
    expect(migrate).toThrow("Rental geofence cron metadata changed beyond command");
    expect(query(`select command from cron.job;`)).toBe(originalCommand);
  });
}, 30_000);
