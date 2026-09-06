import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { withScratchPostgres } from "../../scripts/testing/scratch-postgres";

test("receipt RLS preserves actor/workspace isolation and plans session helpers once", () => {
  withScratchPostgres(query => {
    query(`create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
      create function public.get_my_workspace() returns text language sql stable as $$select current_setting('test.workspace')$$;
      grant usage on schema auth to authenticated;
      create table public.sales_offline_action_receipts(workspace_id text,user_id uuid,action_id integer);
      alter table public.sales_offline_action_receipts enable row level security;
      grant select on public.sales_offline_action_receipts to authenticated;
      create policy sales_offline_receipts_own on public.sales_offline_action_receipts for select to authenticated
        using(user_id=auth.uid() and workspace_id=public.get_my_workspace());
      insert into public.sales_offline_action_receipts values
        ('A','00000000-0000-0000-0000-000000000001',1),
        ('B','00000000-0000-0000-0000-000000000001',2),
        ('A','00000000-0000-0000-0000-000000000002',3);`);
    query(readFileSync(new URL("./846_sales_receipt_policy_initplan.sql", import.meta.url), "utf8"));
    const session = `set role authenticated; set test.actor='00000000-0000-0000-0000-000000000001'; set test.workspace='A';`;
    expect(query(session + `select array_agg(action_id) from public.sales_offline_action_receipts;`).split("\n").at(-1)).toBe("{1}");
    expect(query(session + `set test.workspace='B'; select array_agg(action_id) from public.sales_offline_action_receipts;`).split("\n").at(-1)).toBe("{2}");
    expect(query(session + `set test.actor='00000000-0000-0000-0000-000000000002'; select array_agg(action_id) from public.sales_offline_action_receipts;`).split("\n").at(-1)).toBe("{3}");
    const output = query(session + `explain (analyze, format json) select * from public.sales_offline_action_receipts;`);
    const plan = JSON.parse(output.slice(output.indexOf("[")))[0].Plan;
    const initPlans = plan.Plans.filter((node: Record<string, unknown>) => node["Parent Relationship"] === "InitPlan");
    expect(initPlans.length).toBe(2);
    expect(initPlans.map((node: Record<string, unknown>) => node["Actual Loops"])).toEqual([1, 1]);
    expect(plan["Actual Rows"]).toBe(1);
  });
}, 30_000);
