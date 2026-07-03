import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readMigration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readMigration("716_a71_oem_price_sheet_schema_closeout.sql");
const priceSheetsSql = readMigration("287_qb_price_sheets.sql");
const priceSheetColumnsSql = readMigration("294_qb_price_sheet_columns.sql");
const sheetWatchdogSql = readMigration("306_qb_sheet_watchdog.sql");
const dealerTiersSql = readMigration("541_ycena_oem_price_book_import_tiers.sql");
const priceFeedsSql = readMigration("610_oem_price_feeds_phase1.sql");
const oemResolverSql = readMigration("612_oem_master_schema_resolver.sql");

const compactCloseout = compact(closeoutSql);
const compactPriceSheets = compact(priceSheetsSql);
const compactPriceSheetColumns = compact(priceSheetColumnsSql);
const compactSheetWatchdog = compact(sheetWatchdogSql);
const compactDealerTiers = compact(dealerTiersSql);
const compactPriceFeeds = compact(priceFeedsSql);
const compactOemResolver = compact(oemResolverSql);

describe("716_a71_oem_price_sheet_schema_closeout.sql contract", () => {
  it("marks only A7.1 shipped without changing dependent gated rows", () => {
    expect(compactCloseout).toContain("where task_id = 'a7.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).not.toContain("where task_id = 'a7.2'");
    expect(compactCloseout).not.toContain("where task_id = 'a7.3'");
    expect(compactCloseout).not.toContain("where task_id = 'd3.13'");
    expect(compactCloseout).not.toContain("where task_id = 'd3.14'");
  });

  it("records schema evidence and keeps external OEM proof out of scope", () => {
    expect(compactCloseout).toContain("287_qb_price_sheets.sql");
    expect(compactCloseout).toContain("610_oem_price_feeds_phase1.sql");
    expect(compactCloseout).toContain("612_oem_master_schema_resolver.sql");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("schema-only closeout");
    expect(compactCloseout).toContain("does not ingest real oem price books");
    expect(compactCloseout).toContain("does not unblock a7.2/a7.3");
    expect(compactCloseout).toContain("d3.13 oem price-data nda/legal clearance");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("keeps uploaded sheet headers, line rows, and sheet version links available", () => {
    expect(compactPriceSheets).toContain("create table public.qb_price_sheets");
    expect(compactPriceSheets).toContain("create table public.qb_price_sheet_items");
    expect(compactPriceSheets).toContain("effective_from date");
    expect(compactPriceSheets).toContain("effective_to date");
    expect(compactPriceSheets).toContain("supersedes_price_sheet_id uuid references public.qb_price_sheets(id)");
    expect(compactPriceSheets).toContain("price_sheet_id uuid not null references public.qb_price_sheets(id) on delete cascade");
    expect(compactPriceSheets).toContain("extracted jsonb not null");
    expect(compactPriceSheets).toContain("review_status text not null default 'pending'");
  });

  it("preserves parser metadata, row diff storage, and source linkage", () => {
    expect(compactPriceSheetColumns).toContain("add column if not exists sheet_type text");
    expect(compactPriceSheetColumns).toContain("add column if not exists extraction_metadata jsonb");
    expect(compactPriceSheetColumns).toContain("add column if not exists diff jsonb");

    expect(compactSheetWatchdog).toContain("add column if not exists source_id uuid");
    expect(compactSheetWatchdog).toContain("references public.qb_brand_sheet_sources(id) on delete set null");
    expect(compactSheetWatchdog).toContain("create index idx_qb_price_sheets_source");
  });

  it("keeps canonical OEM metadata and dealer-cost resolver wiring", () => {
    expect(compactOemResolver).toContain("create table if not exists public.oems");
    expect(compactOemResolver).toContain("unique (workspace_id, oem_key)");
    expect(compactOemResolver).toContain("add column if not exists oem_id uuid references public.oems(id) on delete set null");
    expect(compactOemResolver).toContain("add column if not exists oem_key text");
    expect(compactOemResolver).toContain("add column if not exists source_format text");
    expect(compactOemResolver).toContain("add column if not exists source_cadence text");
    expect(compactOemResolver).toContain("add column if not exists resolver_metadata jsonb not null default '{}'::jsonb");
    expect(compactOemResolver).toContain("create or replace function public.resolve_oem_cost");

    for (const key of ["'asv'", "'yanmar'", "'bandit'", "'develon'", "'cmi'"]) {
      expect(compactOemResolver).toContain(key);
    }

    expect(compactDealerTiers).toContain("create table if not exists public.oem_dealer_cost_tiers");
    expect(compactDealerTiers).toContain("discount_off_list_pct numeric(7, 4) not null");
    expect(compactDealerTiers).toContain("effective_from date not null");
    expect(compactDealerTiers).toContain("effective_to date");
  });

  it("keeps price-change events and diff rows ready for future repricing", () => {
    expect(compactPriceFeeds).toContain("create table public.qb_price_change_events");
    expect(compactPriceFeeds).toContain("price_sheet_id uuid not null references public.qb_price_sheets(id) on delete cascade");
    expect(compactPriceFeeds).toContain("prior_price_sheet_id uuid references public.qb_price_sheets(id) on delete set null");
    expect(compactPriceFeeds).toContain("materiality_rule jsonb not null");
    expect(compactPriceFeeds).toContain("approval_policy jsonb not null");
    expect(compactPriceFeeds).toContain("create table public.qb_price_change_items");
    expect(compactPriceFeeds).toContain("item_type text not null check (item_type in ('list_price','freight','rebate','incentive'))");
    expect(compactPriceFeeds).toContain("normalized_code text");
    expect(compactPriceFeeds).toContain("old_price_cents bigint");
    expect(compactPriceFeeds).toContain("new_price_cents bigint");
    expect(compactPriceFeeds).toContain("delta_cents bigint not null default 0");
    expect(compactPriceFeeds).toContain("delta_pct numeric");
    expect(compactPriceFeeds).toContain("change_kind text not null check (change_kind in ('new','removed','increased','decreased','unchanged'))");
  });

  it("keeps OEM price schema RLS scoped instead of public-open", () => {
    for (const table of [
      "public.oems",
      "public.oem_dealer_cost_tiers",
      "public.qb_price_change_events",
      "public.qb_price_change_items",
    ]) {
      const source = table === "public.oems"
        ? compactOemResolver
        : table === "public.oem_dealer_cost_tiers"
          ? compactDealerTiers
          : compactPriceFeeds;

      expect(source).toContain(`alter table ${table} enable row level security`);
    }

    expect(compactPriceFeeds).toContain("create policy \"qb_price_change_events_service\"");
    expect(compactPriceFeeds).toContain("create policy \"qb_price_change_items_elevated_select\"");
    expect(compactOemResolver).toContain("create policy \"oems_elevated_all\"");
    expect(compactDealerTiers).toContain("create policy \"oem_dealer_cost_tiers_elevated_all\"");
  });
});
