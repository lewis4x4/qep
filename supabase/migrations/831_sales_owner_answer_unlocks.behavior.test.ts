import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function postgresBin(name: string): string | null {
  for (const directory of [
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const initdb = postgresBin("initdb");
const pgCtl = postgresBin("pg_ctl");
const psql = postgresBin("psql");
const postgresBehavior = initdb && pgCtl && psql ? describe : describe.skip;

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

const bootstrap = String.raw`
create extension if not exists pgcrypto;
create schema auth;
create role anon;
create role authenticated;
create role service_role;

create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

create function public.get_my_workspace() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.workspace_id', true), ''), 'default')
$$;
create function public.get_my_role() returns text language sql stable as $$
  select nullif(current_setting('app.user_role', true), '')
$$;
create function public.qep_finance_can_read() returns boolean language sql stable as $$
  select true
$$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create type public.prospect_status as enum ('early', 'sold');
create table public.profiles (
  id uuid primary key,
  full_name text,
  role text,
  is_active boolean not null default true
);
create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id),
  workspace_id text not null,
  primary key (profile_id, workspace_id)
);

create table public.finance_approval_principals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  approval_scope text not null check (approval_scope in ('quarter_reopen')),
  approval_role text not null check (approval_role in ('owner', 'finance_controller')),
  expected_name text not null,
  profile_id uuid references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, approval_scope, approval_role)
);
alter table public.finance_approval_principals enable row level security;

create table public.quarter_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  status text not null,
  updated_at timestamptz not null default now()
);
create table public.quarter_reopen_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  request_id uuid not null references public.quarter_reopen_requests(id),
  approval_role text not null,
  approver_id uuid not null references public.profiles(id),
  decision text not null,
  attestation text not null
);

create table public.qrm_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  name text not null,
  assigned_rep_id uuid,
  business_email text,
  business_cell text,
  phone text,
  status text,
  credit_limit_cents bigint,
  credit_limit_set_by uuid,
  credit_limit_set_at timestamptz,
  credit_hold boolean,
  credit_hold_reason text,
  credit_hold_set_at timestamptz,
  payment_terms_code text,
  terms_code text,
  primary_contact_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.qrm_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  first_name text,
  last_name text,
  email text,
  phone text,
  cell text,
  primary_company_id uuid,
  assigned_rep_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.qrm_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  company_id uuid,
  primary_contact_id uuid,
  assigned_rep_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
create table public.qrm_prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  prospect_status public.prospect_status,
  source text,
  salesperson_id uuid,
  selling text,
  company_name_unconverted text,
  comments text,
  company_id uuid,
  modified_at timestamptz
);

create table public.quote_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  deal_id uuid,
  contact_id uuid,
  status text not null default 'draft',
  is_prospect_quote boolean not null default false,
  created_by uuid references public.profiles(id),
  quote_number text,
  customer_company text,
  customer_name text,
  customer_email text,
  customer_phone text,
  sent_at timestamptz,
  sent_via text,
  accepted_at timestamptz,
  requires_requote boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.quote_packages enable row level security;

create table public.quote_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  deal_id uuid,
  signer_name text not null,
  signer_email text,
  signer_ip text,
  signer_user_agent text,
  signature_image_url text,
  signed_snapshot jsonb,
  signed_via text,
  document_hash text,
  is_valid boolean not null default true,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.quote_signatures enable row level security;
create function public.signature_in_my_workspace(p_package_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.quote_packages quote
    where quote.id = p_package_id
      and quote.workspace_id = public.get_my_workspace()
  )
$$;
create policy "signatures_workspace" on public.quote_signatures
  for all using (public.signature_in_my_workspace(quote_package_id))
  with check (public.signature_in_my_workspace(quote_package_id));
create policy "signatures_service" on public.quote_signatures
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table public.quote_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  document_artifact_id uuid,
  channel text not null,
  status text not null,
  recipient text,
  subject text,
  message_body text,
  provider text,
  provider_message_id text,
  error_message text,
  follow_up_at timestamptz,
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.quote_send_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null,
  document_artifact_id uuid not null,
  status text not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  error_detail text
);

create function public.quote_send_package_commit_v599(
  p_workspace_id text, p_quote_package_id uuid, p_sent_at timestamptz,
  p_document_artifact_id uuid, p_recipient text, p_subject text,
  p_message_body text, p_provider text, p_follow_up_at timestamptz,
  p_created_by uuid, p_metadata jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.quote_delivery_events (
    workspace_id, quote_package_id, document_artifact_id, channel, status,
    recipient, subject, message_body, provider, follow_up_at, created_by, metadata
  ) values (
    p_workspace_id, p_quote_package_id, p_document_artifact_id, 'email', 'sent',
    p_recipient, p_subject, p_message_body, p_provider, p_follow_up_at,
    p_created_by, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  update public.quote_packages
  set status = 'sent', sent_at = p_sent_at, sent_via = 'email'
  where id = p_quote_package_id and workspace_id = p_workspace_id;
  return v_id;
end
$$;

create table public.qrm_in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null,
  kind text not null,
  title text not null,
  body text,
  deal_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create table public.qb_brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  code text not null,
  name text not null
);
create table public.qb_price_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id uuid,
  filename text not null,
  file_url text not null,
  status text not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  effective_from date,
  effective_to date,
  updated_at timestamptz not null default now()
);
create table public.qb_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id uuid not null,
  program_code text not null,
  program_type text not null,
  name text not null,
  stack_kind text,
  effective_from date not null,
  effective_to date not null,
  details jsonb not null default '{}'::jsonb,
  source_document_url text,
  active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.qb_price_sheet_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  price_sheet_id uuid not null,
  program_code text not null,
  program_type text not null,
  extracted jsonb not null default '{}'::jsonb,
  proposed_program_id uuid,
  action text not null,
  review_status text not null,
  applied_at timestamptz
);
create table public.qb_program_stacking_rules (
  id uuid primary key default gen_random_uuid(),
  program_type_a text not null,
  program_type_b text not null,
  can_combine boolean not null
);
alter table public.qb_program_stacking_rules enable row level security;
create policy "qb_program_stacking_rules_write" on public.qb_program_stacking_rules
  for all using (true) with check (true);

create table public.qb_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  status text not null default 'draft',
  applied_program_ids uuid[],
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.quote_availability_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid,
  requested_by uuid not null,
  assigned_to uuid,
  requested_machine_label text not null,
  customer_need text,
  urgency text not null,
  sla_due_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'Ryan McKenzie', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'Tina McKenzie', 'finance_admin'),
  ('33333333-3333-4333-8333-333333333333', 'Tina McKenzie', 'owner');
insert into public.profile_workspaces (profile_id, workspace_id) values
  ('11111111-1111-4111-8111-111111111111', 'default'),
  ('22222222-2222-4222-8222-222222222222', 'default'),
  ('33333333-3333-4333-8333-333333333333', 'foreign');
insert into public.finance_approval_principals (
  workspace_id, approval_scope, approval_role, expected_name, profile_id
) values
  ('default', 'quarter_reopen', 'owner', 'Ryan McKenzie', '11111111-1111-4111-8111-111111111111'),
  ('default', 'quarter_reopen', 'finance_controller', 'Tina McKenzie', null);
`;

postgresBehavior("831 behavior on scratch PostgreSQL", () => {
  it("compiles and enforces immutable principals, tenant recipients, mute, and atomic acceptance", () => {
    const root = mkdtempSync(join(tmpdir(), "qep-831-"));
    const data = join(root, "data");
    const socket = join(root, "socket");
    const log = join(root, "postgres.log");
    const port = String(25000 + Math.floor(Math.random() * 10_000));
    let started = false;

    try {
      mkdirSync(socket);
      run(initdb!, ["-D", data, "--auth=trust", "--username=postgres"]);
      run(pgCtl!, [
        "-D", data,
        "-o", `-F -k ${socket} -p ${port} -c listen_addresses=''`,
        "-l", log,
        "start",
      ]);
      started = true;

      let sequence = 0;
      const query = (sql: string): string => {
        const path = join(root, `q-${sequence++}.sql`);
        writeFileSync(path, sql);
        return run(psql!, [
          "-v", "ON_ERROR_STOP=1",
          "-h", socket,
          "-p", port,
          "-U", "postgres",
          "-d", "postgres",
          "-At",
          "-f", path,
        ]);
      };

      query(bootstrap);
      query(readFileSync(
        join(process.cwd(), "supabase/migrations/831_sales_owner_answer_unlocks.sql"),
        "utf8",
      ));

      const principalResult = query(String.raw`
        set request.jwt.claim.role = 'authenticated';
        set app.workspace_id = 'default';
        set app.user_role = 'owner';
        set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
        select public.is_sales_credit_principal('default');
        set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
        select public.is_sales_credit_principal('default');
        select readiness_status
        from public.v_finance_approval_principal_readiness
        where workspace_id = 'default'
          and approval_scope = 'sales_credit'
          and approval_role = 'finance_controller';
      `);
      expect(principalResult).toMatch(/\nf\n[\s\S]*\nt\n[\s\S]*profile_binding_required/);

      const principalBindingResult = query(String.raw`
        set request.jwt.claim.role = 'authenticated';
        set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
        set app.workspace_id = 'default';
        set app.user_role = 'owner';
        set role authenticated;
        do $$
        begin
          begin
            update public.finance_approval_principals
            set profile_id = '22222222-2222-4222-8222-222222222222'
            where workspace_id = 'default'
              and approval_scope = 'sales_credit'
              and approval_role = 'finance_controller';
            raise exception 'direct owner principal mutation was accepted';
          exception when insufficient_privilege then
            null;
          end;

          begin
            perform public.finance_bind_approval_principal(
              'default', 'sales_credit', 'finance_controller',
              '22222222-2222-4222-8222-222222222222',
              'Owner attempted an authenticated bind'
            );
            raise exception 'authenticated principal bind was accepted';
          exception when insufficient_privilege then
            null;
          end;
        end
        $$;
        reset role;

        set request.jwt.claim.role = 'service_role';
        set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
        set role service_role;
        select (public.finance_bind_approval_principal(
          'default', 'sales_credit', 'finance_controller',
          '22222222-2222-4222-8222-222222222222',
          'Bind verified Tina principal profile'
        )).profile_id;
        select (public.finance_bind_approval_principal(
          'default', 'sales_credit', 'finance_controller',
          '22222222-2222-4222-8222-222222222222',
          'Idempotent verified Tina retry'
        )).profile_id;
        do $$
        begin
          begin
            perform public.finance_bind_approval_principal(
              'default', 'sales_credit', 'finance_controller',
              '11111111-1111-4111-8111-111111111111',
              'Conflicting Ryan replacement attempt'
            );
            raise exception 'conflicting principal rebind was accepted';
          exception when raise_exception then
            if sqlerrm <> 'approval-principal binding is immutable' then
              raise;
            end if;
          end;
        end
        $$;
        reset role;

        select concat(
          has_table_privilege(
            'authenticated',
            'public.finance_approval_principals',
            'UPDATE'
          ),
          ':',
          (select profile_id
           from public.finance_approval_principals
           where workspace_id = 'default'
             and approval_scope = 'sales_credit'
             and approval_role = 'finance_controller'),
          ':',
          (select count(*)
           from public.finance_approval_principal_binding_events
           where workspace_id = 'default'
             and approval_scope = 'sales_credit'
             and approval_role = 'finance_controller'),
          ':',
          (select bound_profile_id
           from public.finance_approval_principal_binding_events
           where workspace_id = 'default'
             and approval_scope = 'sales_credit'
             and approval_role = 'finance_controller')
        );
      `);
      expect(principalBindingResult.trim()).toMatch(
        /f(?:alse)?:22222222-2222-4222-8222-222222222222:1:22222222-2222-4222-8222-222222222222$/,
      );

      const crossTenantResult = query(String.raw`
        do $$
        begin
          begin
            insert into public.quote_availability_requests (
              workspace_id, requested_by, assigned_to, requested_machine_label, urgency
            ) values (
              'default',
              '11111111-1111-4111-8111-111111111111',
              '33333333-3333-4333-8333-333333333333',
              'ASV RT-135',
              'normal'
            );
            raise exception 'foreign assignee was accepted';
          exception when check_violation then
            null;
          end;
        end
        $$;
        select count(*) from public.quote_availability_requests;
      `);
      expect(crossTenantResult.trim().endsWith("0")).toBe(true);

      const provenanceRefreshResult = query(String.raw`
        create table public.test_source_row_update_audit (
          source_row_id uuid not null
        );
        create function public.test_capture_source_row_update()
        returns trigger language plpgsql as $$
        begin
          insert into public.test_source_row_update_audit (source_row_id)
          values (new.id);
          return new;
        end
        $$;
        create trigger test_capture_source_row_update_trg
          after update on public.qb_price_sheet_programs
          for each row execute function public.test_capture_source_row_update();

        insert into public.qb_brands (id, workspace_id, code, name) values
          ('88888888-8888-4888-8888-888888888880', 'default', 'BULK', 'Bulk OEM');
        insert into public.qb_programs (
          id, workspace_id, brand_id, program_code, program_type, name,
          effective_from, effective_to
        ) values
          (
            '88888888-8888-4888-8888-888888888881', 'default',
            '88888888-8888-4888-8888-888888888880', 'BULK-CASH',
            'cash_in_lieu', 'Bulk Cash', '2026-01-01', '2026-12-31'
          ),
          (
            '88888888-8888-4888-8888-888888888882', 'default',
            '88888888-8888-4888-8888-888888888880', 'BULK-APR',
            'low_rate_financing', 'Bulk APR', '2026-01-01', '2026-12-31'
          );
        insert into public.qb_price_sheets (
          id, workspace_id, brand_id, filename, file_url, status,
          effective_from, effective_to
        ) values
          (
            '99999999-9999-4999-8999-999999999991', 'default',
            '88888888-8888-4888-8888-888888888880', 'bulk-cash.pdf',
            'https://example.test/bulk-cash.pdf', 'pending_review',
            '2026-01-01', '2026-12-31'
          ),
          (
            '99999999-9999-4999-8999-999999999992', 'default',
            '88888888-8888-4888-8888-888888888880', 'bulk-apr.pdf',
            'https://example.test/bulk-apr.pdf', 'pending_review',
            '2026-01-01', '2026-12-31'
          );
        insert into public.qb_price_sheet_programs (
          id, workspace_id, price_sheet_id, program_code, program_type,
          proposed_program_id, action, review_status, applied_at
        ) values
          (
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1', 'default',
            '99999999-9999-4999-8999-999999999991', 'BULK-CASH',
            'cash_in_lieu', '88888888-8888-4888-8888-888888888881',
            'update', 'approved', now()
          ),
          (
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2', 'default',
            '99999999-9999-4999-8999-999999999992', 'BULK-APR',
            'low_rate_financing', '88888888-8888-4888-8888-888888888882',
            'update', 'approved', now()
          );

        update public.qb_price_sheets
        set status = 'published',
            reviewed_by = '11111111-1111-4111-8111-111111111111',
            reviewed_at = now()
        where id in (
          '99999999-9999-4999-8999-999999999991',
          '99999999-9999-4999-8999-999999999992'
        );

        select concat(
          (select count(*)
           from public.qb_programs
           where id in (
             '88888888-8888-4888-8888-888888888881',
             '88888888-8888-4888-8888-888888888882'
           )
             and stack_policy_provenance = 'manufacturer_worksheet'
             and source_price_sheet_id is not null),
          ':',
          (select count(distinct source_price_sheet_id)
           from public.qb_programs
           where id in (
             '88888888-8888-4888-8888-888888888881',
             '88888888-8888-4888-8888-888888888882'
           )),
          ':',
          (select count(*) from public.test_source_row_update_audit)
        );
      `);
      expect(provenanceRefreshResult.trim().endsWith("2:2:0")).toBe(true);

      const stackingPolicyResult = query(String.raw`
        insert into public.qb_brands (id, workspace_id, code, name) values
          ('44444444-4444-4444-8444-444444444440', 'default', 'ASV', 'ASV');
        insert into public.qb_programs (
          id, workspace_id, brand_id, program_code, program_type, name,
          effective_from, effective_to
        ) values
          (
            '44444444-4444-4444-8444-444444444441', 'default',
            '44444444-4444-4444-8444-444444444440', 'CASH-26',
            'cash_in_lieu', 'Cash 2026', '2026-01-01', '2026-12-31'
          ),
          (
            '55555555-5555-4555-8555-555555555552', 'default',
            '44444444-4444-4444-8444-444444444440', 'APR-26',
            'low_rate_financing', 'APR 2026', '2026-01-01', '2026-12-31'
          );
        insert into public.qb_price_sheets (
          id, workspace_id, brand_id, filename, file_url, status,
          reviewed_by, reviewed_at, effective_from, effective_to
        ) values
          (
            '66666666-6666-4666-8666-666666666661', 'default',
            '44444444-4444-4444-8444-444444444440', 'asv-2026.pdf',
            'https://example.test/asv-2026.pdf', 'published',
            '11111111-1111-4111-8111-111111111111', now(),
            '2026-01-01', '2026-12-31'
          ),
          (
            '66666666-6666-4666-8666-666666666662', 'foreign',
            '44444444-4444-4444-8444-444444444440', 'foreign.pdf',
            'https://example.test/foreign.pdf', 'published',
            '11111111-1111-4111-8111-111111111111', now(),
            '2026-01-01', '2026-12-31'
          );
        do $$
        begin
          begin
            insert into public.qb_price_sheet_programs (
              workspace_id, price_sheet_id, program_code, program_type,
              proposed_program_id, action, review_status, applied_at
            ) values (
              'default', '66666666-6666-4666-8666-666666666662', 'CASH-26',
              'cash_in_lieu', '44444444-4444-4444-8444-444444444441',
              'update', 'approved', now()
            );
            raise exception 'cross-workspace source sheet was accepted';
          exception when check_violation then
            null;
          end;
        end
        $$;
        insert into public.qb_price_sheet_programs (
          id, workspace_id, price_sheet_id, program_code, program_type,
          proposed_program_id, action, review_status, applied_at
        ) values
          (
            '77777777-7777-4777-8777-777777777771', 'default',
            '66666666-6666-4666-8666-666666666661', 'CASH-26',
            'cash_in_lieu', '44444444-4444-4444-8444-444444444441',
            'update', 'approved', now()
          ),
          (
            '77777777-7777-4777-8777-777777777772', 'default',
            '66666666-6666-4666-8666-666666666661', 'APR-26',
            'low_rate_financing', '55555555-5555-4555-8555-555555555552',
            'update', 'approved', now()
          );
        insert into public.qb_program_pair_policies (
          workspace_id, brand_id, program_a_id, program_b_id, can_combine,
          effective_from, effective_to, source_price_sheet_id,
          source_program_row_a_id, source_program_row_b_id,
          reviewed_by, reviewed_at, notes
        ) values (
          'default', '44444444-4444-4444-8444-444444444440',
          '44444444-4444-4444-8444-444444444441',
          '55555555-5555-4555-8555-555555555552', false,
          '2026-01-01', '2026-06-30',
          '66666666-6666-4666-8666-666666666661',
          '77777777-7777-4777-8777-777777777771',
          '77777777-7777-4777-8777-777777777772',
          '11111111-1111-4111-8111-111111111111', now(),
          'Manufacturer worksheet blocks pair'
        );
        do $$
        begin
          begin
            insert into public.qb_program_pair_policies (
              workspace_id, brand_id, program_a_id, program_b_id, can_combine,
              effective_from, effective_to, source_price_sheet_id,
              source_program_row_a_id, source_program_row_b_id,
              reviewed_by, reviewed_at
            ) values (
              'default', '44444444-4444-4444-8444-444444444440',
              '44444444-4444-4444-8444-444444444441',
              '55555555-5555-4555-8555-555555555552', true,
              '2026-06-01', '2026-12-31',
              '66666666-6666-4666-8666-666666666661',
              '77777777-7777-4777-8777-777777777771',
              '77777777-7777-4777-8777-777777777772',
              '11111111-1111-4111-8111-111111111111', now()
            );
            raise exception 'overlapping policy was accepted';
          exception when exclusion_violation then
            null;
          end;
        end
        $$;
        do $$
        begin
          begin
            insert into public.qb_quotes (
              workspace_id, status, applied_program_ids, sent_at
            ) values (
              'default', 'sent', array[
                '44444444-4444-4444-8444-444444444441'::uuid,
                '55555555-5555-4555-8555-555555555552'::uuid
              ], '2026-04-15T12:00:00Z'
            );
            raise exception 'blocked program pair was accepted for customer send';
          exception when check_violation then
            null;
          end;

          begin
            insert into public.qb_quotes (
              workspace_id, status, applied_program_ids, sent_at
            ) values (
              'default', 'sent', array[
                '44444444-4444-4444-8444-444444444441'::uuid,
                '55555555-5555-4555-8555-555555555552'::uuid
              ], '2026-10-15T12:00:00Z'
            );
            raise exception 'missing effective program policy was accepted for customer send';
          exception when sqlstate '55000' then
            null;
          end;
        end
        $$;
        insert into public.qb_quotes (
          workspace_id, status, applied_program_ids, sent_at
        ) values (
          'default', 'sent', array[
            '44444444-4444-4444-8444-444444444441'::uuid
          ], '2026-04-15T12:00:00Z'
        );
        update public.qb_program_pair_policies
        set can_combine = true
        where workspace_id = 'default';
        insert into public.qb_quotes (
          workspace_id, status, applied_program_ids, sent_at
        ) values (
          'default', 'sent', array[
            '44444444-4444-4444-8444-444444444441'::uuid,
            '55555555-5555-4555-8555-555555555552'::uuid
          ], '2026-04-15T12:00:00Z'
        );
        select concat(
          (select count(*) from public.qb_program_pair_policies),
          ':',
          (select count(*) from public.qb_quotes)
        );
      `);
      expect(stackingPolicyResult.trim().endsWith("1:2")).toBe(true);

      const muteResult = query(String.raw`
        set request.jwt.claim.role = 'authenticated';
        set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
        set app.workspace_id = 'default';
        insert into public.quote_availability_requests (
          workspace_id, requested_by, assigned_to, requested_machine_label, urgency
        ) values (
          'default',
          '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111',
          'ASV RT-135',
          'normal'
        );
        select muted_channel
        from public.set_sales_availability_alert_mute('sms', null);
        select count(*)
        from public.sales_availability_alert_deliveries
        where recipient_user_id = '11111111-1111-4111-8111-111111111111'
          and channel = 'sms'
          and status = 'muted';
      `);
      expect(muteResult.trim().endsWith("1")).toBe(true);

      const acceptResult = query(String.raw`
        set request.jwt.claim.role = 'service_role';
        insert into public.quote_packages (
          id, workspace_id, status, is_prospect_quote, created_by, quote_number,
          customer_company, customer_name, customer_email, customer_phone
        ) values (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'default',
          'sent',
          true,
          '11111111-1111-4111-8111-111111111111',
          'Q-831',
          'New Prospect LLC',
          'Pat Prospect',
          'pat@example.com',
          '555-0100'
        );
        insert into public.quote_delivery_events (
          workspace_id, quote_package_id, channel, status, provider, created_by
        ) values (
          'default',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'email',
          'sent',
          'test',
          '11111111-1111-4111-8111-111111111111'
        );
        select (public.accept_quote_package_with_signature(
          'default',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'Pat Prospect',
          'pat@example.com',
          '127.0.0.1',
          'test',
          'data:image/png;base64,AA==',
          '{"terms_accepted":true}'::jsonb,
          'deal_room',
          repeat('a', 64)
        ) ->> 'status');
        select concat(
          (select count(*) from public.quote_signatures where quote_package_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          ':',
          (select count(*) from public.quote_prospect_lifecycles where quote_package_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and lifecycle_status = 'customer_cash_only'),
          ':',
          (select count(*) from public.sales_customer_credit_approval_requests where quote_package_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'pending')
        );
      `);
      expect(acceptResult).toContain("accepted\n1:1:1");
    } finally {
      if (started) {
        spawnSync(pgCtl!, ["-D", data, "stop", "-m", "immediate"], { encoding: "utf8" });
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
