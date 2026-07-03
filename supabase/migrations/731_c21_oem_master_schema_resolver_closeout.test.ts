import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readMigration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readMigration("731_c21_oem_master_schema_resolver_closeout.sql");
const priceSheetsSql = readMigration("287_qb_price_sheets.sql");
const dealerTiersSql = readMigration("541_ycena_oem_price_book_import_tiers.sql");
const oemResolverSql = readMigration("612_oem_master_schema_resolver.sql");
const a71CloseoutSql = readMigration("716_a71_oem_price_sheet_schema_closeout.sql");

const compactCloseout = compact(closeoutSql);
const compactPriceSheets = compact(priceSheetsSql);
const compactDealerTiers = compact(dealerTiersSql);
const compactOemResolver = compact(oemResolverSql);
const compactA71Closeout = compact(a71CloseoutSql);

describe("731_c21_oem_master_schema_resolver_closeout.sql contract", () => {
  it("marks only C2.1 shipped and leaves dependent/manual rows untouched", () => {
    expect(compactCloseout).toContain("where task_id = 'c2.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).not.toContain("where task_id = 'c2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.5'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.6'");
    expect(compactCloseout).not.toContain("where task_id = 'd2.3'");
  });

  it("keeps parser/import and external OEM file boundaries explicit", () => {
    expect(compactCloseout).toContain("admin ui");
    expect(compactCloseout).toContain("parser work");
    expect(compactCloseout).toContain("asv/yanmar sample import");
    expect(compactCloseout).toContain("bobcat");
    expect(compactCloseout).toContain("vermeer");
    expect(compactCloseout).toContain("does not ingest or claim any live oem files");
    expect(compactCloseout).toContain("sample files/contracts remain external/manual blockers");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("creates canonical OEM master records with workspace-scoped RLS", () => {
    expect(compactOemResolver).toContain("create table if not exists public.oems");
    expect(compactOemResolver).toContain("workspace_id text not null default public.get_my_workspace()");
    expect(compactOemResolver).toContain("oem_key text not null");
    expect(compactOemResolver).toContain("parent_oem_key text");
    expect(compactOemResolver).toContain("display_name text not null");
    expect(compactOemResolver).toContain("source_format text not null default 'unknown'");
    expect(compactOemResolver).toContain("price_sheet_cadence text not null default 'unknown'");
    expect(compactOemResolver).toContain("metadata jsonb not null default '{}'::jsonb");
    expect(compactOemResolver).toContain("unique (workspace_id, oem_key)");
    expect(compactOemResolver).toContain("alter table public.oems enable row level security");
    expect(compactOemResolver).toContain("create policy \"oems_service_all\"");
    expect(compactOemResolver).toContain("create policy \"oems_elevated_all\"");
    expect(compactOemResolver).toContain("create policy \"oems_workspace_member_select\"");
  });

  it("extends qb_price_sheets with OEM resolver metadata", () => {
    expect(compactPriceSheets).toContain("create table public.qb_price_sheets");
    expect(compactPriceSheets).toContain("create table public.qb_price_sheet_items");
    expect(compactOemResolver).toContain("alter table public.qb_price_sheets add column if not exists oem_id uuid references public.oems(id) on delete set null");
    expect(compactOemResolver).toContain("add column if not exists oem_key text");
    expect(compactOemResolver).toContain("add column if not exists source_format text");
    expect(compactOemResolver).toContain("add column if not exists source_cadence text");
    expect(compactOemResolver).toContain("add column if not exists resolver_metadata jsonb not null default '{}'::jsonb");
    expect(compactOemResolver).toContain("qb_price_sheets_source_format_chk");
    expect(compactOemResolver).toContain("qb_price_sheets_source_cadence_chk");
    expect(compactOemResolver).toContain("create index if not exists idx_qb_price_sheets_oem");
    expect(compactOemResolver).toContain("create index if not exists idx_qb_price_sheets_oem_id");
  });

  it("preserves effective-dated dealer-cost tiers and ASV/Yanmar YCENA seeds", () => {
    expect(compactDealerTiers).toContain("create table if not exists public.oem_dealer_cost_tiers");
    expect(compactDealerTiers).toContain("parent_oem_key text not null");
    expect(compactDealerTiers).toContain("brand_key text not null");
    expect(compactDealerTiers).toContain("discount_off_list_pct numeric(7, 4) not null");
    expect(compactDealerTiers).toContain("effective_from date not null");
    expect(compactDealerTiers).toContain("effective_to date");
    expect(compactDealerTiers).toContain("source_reference text");
    expect(compactDealerTiers).toContain("create index if not exists idx_oem_dealer_cost_tiers_active");
    expect(compactDealerTiers).toContain("alter table public.oem_dealer_cost_tiers enable row level security");
    expect(compactDealerTiers).toContain("create policy \"oem_dealer_cost_tiers_service_all\"");
    expect(compactDealerTiers).toContain("create policy \"oem_dealer_cost_tiers_elevated_all\"");
    expect(compactDealerTiers).toContain("create policy \"oem_dealer_cost_tiers_rep_select\"");
    expect(compactDealerTiers).toContain("'ycena', 'asv', 'asv', 30.0000::numeric");
    expect(compactDealerTiers).toContain("'ycena', 'yanmar', 'yanmar compact equipment', 30.0000::numeric");
  });

  it("links canonical OEMs to tiers and price sheets", () => {
    expect(compactOemResolver).toContain("alter table public.oem_dealer_cost_tiers add column if not exists oem_id uuid references public.oems(id) on delete set null");
    expect(compactOemResolver).toContain("create index if not exists idx_oem_dealer_cost_tiers_oem_id");
    expect(compactOemResolver).toContain("update public.oem_dealer_cost_tiers tier set oem_id = o.id from public.oems o");
    expect(compactOemResolver).toContain("update public.qb_price_sheets ps set oem_key = regexp_replace(lower(b.code)");
    expect(compactOemResolver).toContain("update public.qb_price_sheets ps set oem_id = o.id");
    for (const key of ["'ycena'", "'asv'", "'yanmar'", "'bandit'", "'develon'", "'barko'", "'prinoth'", "'cmi'"]) {
      expect(compactOemResolver).toContain(key);
    }
  });

  it("defines a stable workspace/effective-date resolver RPC", () => {
    expect(compactOemResolver).toContain("create or replace function public.resolve_oem_cost");
    expect(compactOemResolver).toContain("returns table ( dealer_cost_cents bigint");
    expect(compactOemResolver).toContain("language sql stable security definer set search_path = ''");
    expect(compactOemResolver).toContain("coalesce(nullif(p_workspace_id, ''), public.get_my_workspace(), 'default')");
    expect(compactOemResolver).toContain("greatest(coalesce(p_list_price_cents, 0), 0)::numeric");
    expect(compactOemResolver).toContain("join public.oem_dealer_cost_tiers t");
    expect(compactOemResolver).toContain("t.effective_from <= args.effective_on");
    expect(compactOemResolver).toContain("t.effective_to is null or t.effective_to >= args.effective_on");
    expect(compactOemResolver).toContain("round(c.list_price_cents * (1 - (c.discount_off_list_pct / 100.0)))::bigint");
    expect(compactOemResolver).toContain("order by c.match_rank, c.effective_from desc, c.created_at desc");
    expect(compactOemResolver).toContain("grant execute on function public.resolve_oem_cost(text, text, bigint, date, text) to authenticated, service_role");
  });

  it("cross-references the existing A7.1 schema closeout without widening C2.1 scope", () => {
    expect(compactA71Closeout).toContain("612_oem_master_schema_resolver.sql creates canonical oems");
    expect(compactA71Closeout).toContain("exposes resolve_oem_cost");
    expect(compactA71Closeout).toContain("schema-only closeout");
    expect(compactCloseout).toContain("supabase/migrations/716_a71_oem_price_sheet_schema_closeout.sql");
  });
});
