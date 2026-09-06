import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { withScratchPostgres, hasScratchPostgres } from "../../scripts/testing/scratch-postgres";

(hasScratchPostgres ? describe : describe.skip)("profile authority boundary", () => {
  it("blocks own privilege fields while preserving preferences and authorized administration", () => {
    withScratchPostgres((query) => {
      query(`create role authenticated; create role anon; create role service_role;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
        create function auth.role() returns text language sql stable as $$select current_setting('request.role',true)$$;
        create table profiles(id uuid primary key,role text,full_name text,is_support boolean default false,iron_role text,audience text,is_agent_service_account boolean default false,agent_service_key text);
        create function get_my_role() returns text language sql stable security definer as $$select role from public.profiles where id=auth.uid()$$;
        grant usage on schema public,auth to authenticated;
        grant select,update on profiles to authenticated;
        alter table profiles enable row level security;
        create policy own_read on profiles for select using (id=auth.uid());
        create policy own_update on profiles for update using (id=auth.uid()) with check(id=auth.uid());
        create policy owner_update on profiles for all using(get_my_role()='owner');
        insert into profiles(id,role,full_name) values('10000000-0000-0000-0000-000000000001','rep','Advisor'),('10000000-0000-0000-0000-000000000002','owner','Owner');`);
      query(readFileSync(new URL('./839_profile_authority_guard.sql',import.meta.url),'utf8'));
      expect(query(`set role authenticated;set request.role='authenticated';set request.uid='10000000-0000-0000-0000-000000000001';update profiles set full_name='Updated' where id=auth.uid();select full_name from profiles where id=auth.uid();`)).toContain('Updated');
      for (const patch of ["role='owner'","is_support=true","iron_role='iron_manager'","audience='stakeholder'","is_agent_service_account=true","agent_service_key='privileged'"]) {
        expect(() => query(`set role authenticated;set request.role='authenticated';set request.uid='10000000-0000-0000-0000-000000000001';update profiles set ${patch} where id=auth.uid();`)).toThrow('Only an owner');
      }
      expect(query(`set role authenticated;set request.role='authenticated';set request.uid='10000000-0000-0000-0000-000000000002';update profiles set role='manager' where id='10000000-0000-0000-0000-000000000001';select role from profiles where id='10000000-0000-0000-0000-000000000001';`)).toContain('manager');
    });
  });
});
