import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, lstatSync, unlinkSync, rmdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const pgBin = ["/opt/homebrew/opt/postgresql@18/bin", "/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/opt/postgresql@16/bin"].find((path) => existsSync(join(path, "initdb")));
const pgTest = pgBin ? test : test.skip;
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C", LANG: "C" } });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
pgTest("844 compares versions under lock and preserves score/finalize/subject guards", () => {
  const parent = join(homedir(), ".hermes/tmp/agent-runs"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "qep-844-")); chmodSync(root, 0o700);
  const data = join(root, "data"); const sock = join(root, "socket"); mkdirSync(sock);
  const port = String(30000 + Math.floor(Math.random() * 15000)); let started = false;
  const manifest = join(root, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ schema_version: 1, run_id: root.split("/").at(-1), created_by: "codex", artifacts: [] }), { mode: 0o600 });
  let serial = 0;
  const query = (sql: string) => {
    const path = join(root, `query-${serial++}.sql`); writeFileSync(path, sql, { mode: 0o600 });
    return run(join(pgBin!, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-h", sock, "-p", port, "-U", "postgres", "-d", "postgres", "-At", "-f", path]);
  };
  try {
    run(join(pgBin!, "initdb"), ["-D", data, "--auth=trust", "--username=postgres"]);
    run(join(pgBin!, "pg_ctl"), ["-D", data, "-o", `-F -k ${sock} -p ${port} -c listen_addresses=''`, "-l", join(root, "postgres.log"), "start"]); started = true;
    query(`create role anon; create role authenticated; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.actor',true),'')::uuid $$;
      create table employee_performance_appraisals(id uuid primary key, workspace_id text, subject_employee_id uuid, subject_profile_id uuid, reviewer_profile_id uuid, deleted_at timestamptz, updated_at timestamptz not null, status text, manager_summary text, cost_of_living_raise_pct numeric, key_strengths jsonb, improvement_areas jsonb, goals_next_period jsonb, finalized_by uuid, finalized_at timestamptz, manager_signed_by uuid, manager_signed_at timestamptz, manager_signature_name text, employee_acknowledged_by uuid, employee_acknowledged_at timestamptz, employee_signature_name text, employee_comments text);
      create table employee_performance_appraisal_scores(appraisal_id uuid, category_key text, score integer, notes text, updated_at timestamptz);
      -- Isolated access fixtures; domain mutation bodies below are the actual641 functions.
      create function employee_appraisal_can_read(text,uuid,uuid,uuid) returns boolean language sql stable as $$ select $1=current_setting('app.workspace',true) and auth.uid() in ($3,$4) $$;
      create function employee_appraisal_can_manage(text,uuid,uuid) returns boolean language sql stable as $$ select $1=current_setting('app.workspace',true) and auth.uid()=$3 $$;
      create function employee_performance_appraisal_recompute(uuid) returns void language sql as $$ select $$;
      insert into employee_performance_appraisals(id,workspace_id,subject_employee_id,subject_profile_id,reviewer_profile_id,updated_at,status) values('00000000-0000-0000-0000-000000000001','test','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','2020-01-01','draft');
      insert into employee_performance_appraisal_scores values('00000000-0000-0000-0000-000000000001','safety',5,null,now());
      grant select,update on employee_performance_appraisals,employee_performance_appraisal_scores to authenticated;`);
    const source = readFileSync(join(process.cwd(), "supabase/migrations/641_workforce_performance_appraisals.sql"), "utf8");
    for (const action of ["score", "finalize", "acknowledge"]) {
      const fn = source.match(new RegExp(`create or replace function public.employee_appraisal_${action}\\([\\s\\S]*?\\$\\$;`));
      if (!fn) throw new Error(`Missing641 ${action}`); query(fn[0]);
    }
    query(readFileSync(join(process.cwd(), "supabase/migrations/844_workforce_appraisal_version_guards.sql"), "utf8"));
    const manager = "set role authenticated; set app.workspace='test'; set app.actor='00000000-0000-0000-0000-000000000004';";
    const score = query(`${manager} select employee_appraisal_mutate_versioned('00000000-0000-0000-0000-000000000001','score','2020-01-01','{"scores":[{"category_key":"safety","score":9}],"manager_summary":"Saved draft"}');`);
    expect(score).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:/);
    expect(query("select score from employee_performance_appraisal_scores;")).toContain("9");
    const stale = query(`${manager} do $$ begin
      perform employee_appraisal_mutate_versioned('00000000-0000-0000-0000-000000000001','score','2020-01-01','{"scores":[{"category_key":"safety","score":1}]}');
      raise exception 'stale version incorrectly accepted'; exception when serialization_failure then null; end $$;
      select score from employee_performance_appraisal_scores;`);
    expect(stale).toContain("9");
    const finalize = query(`${manager} select employee_appraisal_mutate_versioned(id,'finalize',updated_at,'{"manager_signature_name":"Fixture Manager"}') from employee_performance_appraisals;
      select status from employee_performance_appraisals;`);
    expect(finalize).toContain("finalized");
    const signed = query(`set role authenticated; set app.workspace='test'; set app.actor='00000000-0000-0000-0000-000000000003';
      select employee_appraisal_mutate_versioned(id,'acknowledge',updated_at,'{"employee_signature_name":"Fixture Subject"}') from employee_performance_appraisals;
      select employee_signature_name from employee_performance_appraisals;`);
    expect(signed).toContain("Fixture Subject");
    const privilege = query("select has_function_privilege('authenticated','public.employee_appraisal_score(uuid,jsonb,text,numeric,jsonb,jsonb,jsonb)','EXECUTE'); select has_table_privilege('authenticated','public.employee_performance_appraisals','UPDATE');");
    expect(privilege.trim()).toBe("f\nf");
  } finally {
    if (started) run(join(pgBin!, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
    // Exact provenance: root was freshly created by this test before initdb;
    // record each generated path, validate manifests, then remove only those paths.
    const files: string[] = []; const dirs: string[] = [];
    const walk = (dir: string) => { for (const entry of readdirSync(dir)) { const path = join(dir, entry); if (lstatSync(path).isDirectory()) { walk(path); dirs.push(path); } else files.push(path); } };
    walk(root);
    for (let offset=0; offset<files.length; offset+=900) {
      const batch = files.slice(offset, offset+900).filter((path) => path!==manifest);
      writeFileSync(manifest, JSON.stringify({ schema_version:1, run_id:root.split("/").at(-1), created_by:"codex", artifacts:batch }), { mode:0o600 });
      const steward = join(homedir(), ".local/bin/jarvis-storage-steward");
      if (existsSync(steward)) run(steward, ["cleanup-run", "--manifest", manifest]);
      for (const path of batch) unlinkSync(path);
    }
    unlinkSync(manifest); for (const dir of dirs) rmdirSync(dir); rmdirSync(root);
  }
}, 30_000);
