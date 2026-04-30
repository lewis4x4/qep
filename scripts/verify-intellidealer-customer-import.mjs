#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "./_shared/local-env.mjs";

loadLocalEnv(process.cwd());

const runId = process.argv[2];
if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
  console.error("Usage: bun ./scripts/verify-intellidealer-customer-import.mjs <run-id>");
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN.");
  process.exit(2);
}

const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  readFileSync("supabase/config.toml", "utf8").match(/^project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];

if (!projectRef) {
  console.error("Missing Supabase project ref.");
  process.exit(2);
}

const query = `
select jsonb_build_object(
  'run_status', (
    select status
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'mapped_master', (
    select count(*)
    from public.qrm_intellidealer_customer_master_stage
    where run_id = '${runId}'::uuid
      and canonical_company_id is not null
  ),
  'mapped_contacts', (
    select count(*)
    from public.qrm_intellidealer_customer_contacts_stage
    where run_id = '${runId}'::uuid
      and canonical_contact_id is not null
  ),
  'mapped_ar_agency', (
    select count(*)
    from public.qrm_intellidealer_customer_ar_agency_stage
    where run_id = '${runId}'::uuid
      and canonical_company_id is not null
      and canonical_agency_id is not null
  ),
  'mapped_profitability', (
    select count(*)
    from public.qrm_intellidealer_customer_profitability_stage
    where run_id = '${runId}'::uuid
      and canonical_company_id is not null
  ),
  'staged_contact_memos', (
    select count(*)
    from public.qrm_intellidealer_customer_contact_memos_stage
    where run_id = '${runId}'::uuid
  ),
  'staged_contact_memos_nonblank', (
    select count(*)
    from public.qrm_intellidealer_customer_contact_memos_stage
    where run_id = '${runId}'::uuid
      and nullif(memo, '') is not null
  ),
  'staged_contact_memos_unique_company_body', (
    select count(*)
    from (
      select distinct m.canonical_company_id, s.memo
      from public.qrm_intellidealer_customer_contact_memos_stage s
      join public.qrm_intellidealer_customer_master_stage m
        on m.run_id = s.run_id
       and m.company_code = s.company_code
       and m.division_code = s.division_code
       and m.customer_number = s.customer_number
      where s.run_id = '${runId}'::uuid
        and m.canonical_company_id is not null
        and nullif(s.memo, '') is not null
    ) unique_memos
  ),
  'canonical_company_memos_matching_stage', (
    select count(*)
    from public.qrm_company_memos memo
    where memo.deleted_at is null
      and exists (
        select 1
        from public.qrm_intellidealer_customer_contact_memos_stage s
        join public.qrm_intellidealer_customer_master_stage m
          on m.run_id = s.run_id
         and m.company_code = s.company_code
         and m.division_code = s.division_code
         and m.customer_number = s.customer_number
        where s.run_id = '${runId}'::uuid
          and m.canonical_company_id = memo.company_id
          and s.memo = memo.body
      )
  ),
  'staged_unique_memos_missing_canonical', (
    select count(*)
    from (
      select distinct m.workspace_id, m.canonical_company_id, s.memo
      from public.qrm_intellidealer_customer_contact_memos_stage s
      join public.qrm_intellidealer_customer_master_stage m
        on m.run_id = s.run_id
       and m.company_code = s.company_code
       and m.division_code = s.division_code
       and m.customer_number = s.customer_number
      where s.run_id = '${runId}'::uuid
        and m.canonical_company_id is not null
        and nullif(s.memo, '') is not null
    ) unique_memos
    where not exists (
      select 1
      from public.qrm_company_memos existing
      where existing.workspace_id = unique_memos.workspace_id
        and existing.company_id = unique_memos.canonical_company_id
        and existing.deleted_at is null
        and existing.body = unique_memos.memo
    )
  ),
  'customer_ar_agencies', (
    select count(*)
    from public.qrm_customer_ar_agencies
    where deleted_at is null
  ),
  'profitability_facts', (
    select count(*)
    from public.qrm_customer_profitability_import_facts
    where deleted_at is null
  ),
  'raw_card_rows', (
    select count(*)
    from public.qrm_customer_ar_agencies
    where card_number is not null
      and card_number !~* '^REDACTED:'
      and card_number !~ '^[*?xX-]+$'
  ),
  'redacted_card_rows', (
    select count(*)
    from public.qrm_customer_ar_agencies
    where card_number ~* '^REDACTED:'
  ),
  'import_errors', (
    select count(*)
    from public.qrm_intellidealer_customer_import_errors
    where run_id = '${runId}'::uuid
  )
) as verification;
`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  },
);

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);
