import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readMigration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readMigration("724_a78_price_lock_customer_attribute_closeout.sql");
const priceLockSql = readMigration("611_customer_price_lock_attribute.sql");
const oemWaveSql = readMigration("627_qep_oem_price_feed_wave.sql");

const compactCloseout = compact(closeoutSql);
const compactPriceLock = compact(priceLockSql);
const compactOemWave = compact(oemWaveSql);

describe("724_a78_price_lock_customer_attribute_closeout.sql contract", () => {
  it("marks only A7.8 shipped without promoting gated OEM reprice rows", () => {
    expect(compactCloseout).toContain("where task_id = 'a7.8'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).not.toContain("where task_id = 'a7.2'");
    expect(compactCloseout).not.toContain("where task_id = 'a7.3'");
    expect(compactCloseout).not.toContain("where task_id = 'a7.7'");
    expect(compactCloseout).not.toContain("where task_id = 'd3.13'");
    expect(compactCloseout).not.toContain("where task_id = 'd3.14'");
  });

  it("records schema-hook evidence with honest manual boundaries", () => {
    expect(compactCloseout).toContain("611_customer_price_lock_attribute.sql");
    expect(compactCloseout).toContain("627_qep_oem_price_feed_wave.sql oem-dp6");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("no customers are under price lock today");
    expect(compactCloseout).toContain("does not seed any locked customers");
    expect(compactCloseout).toContain("actual price-lock contract proof remains a future owner/customer-specific input");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("keeps the customer model price-lock fields additive and default-off", () => {
    expect(compactPriceLock).toContain("alter table public.qrm_companies");
    expect(compactPriceLock).toContain("add column if not exists price_lock_active boolean not null default false");
    expect(compactPriceLock).toContain("add column if not exists price_lock_reason text");
    expect(compactPriceLock).toContain("add column if not exists price_lock_expires_at date");
    expect(compactPriceLock).toContain("when true, oem reprice scans must suppress automatic repricing");
    expect(compactPriceLock).toContain("human-readable reason for a customer price lock");
    expect(compactPriceLock).toContain("optional expiration date for the customer price lock");
    expect(compactPriceLock).not.toContain("set price_lock_active = true");
  });

  it("keeps active-lock lookup indexed without exposing deleted accounts", () => {
    expect(compactPriceLock).toContain("create index if not exists idx_qrm_companies_price_lock_active");
    expect(compactPriceLock).toContain("on public.qrm_companies(workspace_id, price_lock_active)");
    expect(compactPriceLock).toContain("where price_lock_active = true and deleted_at is null");
  });

  it("projects price-lock fields through the security-invoker CRM compatibility view", () => {
    expect(compactPriceLock).toContain("create or replace view public.crm_companies");
    expect(compactPriceLock).toContain("with (security_invoker = true)");
    expect(compactPriceLock).toContain("public.mask_customer_ein(ein) as ein");
    expect(compactPriceLock).toContain("public.mask_customer_money_cents(credit_limit_cents) as credit_limit_cents");
    expect(compactPriceLock).toContain("price_lock_active");
    expect(compactPriceLock).toContain("price_lock_reason");
    expect(compactPriceLock).toContain("price_lock_expires_at");
    expect(compactPriceLock).toContain("includes oem-dp6 customer price-lock attributes");
  });

  it("keeps OEM-DP6 source-of-truth aligned to the future-hook scope", () => {
    const dp6Start = compactOemWave.indexOf("('oem-dp6'");
    expect(dp6Start).toBeGreaterThan(-1);
    const dp6Block = compactOemWave.slice(dp6Start, dp6Start + 900);

    expect(dp6Block).toContain("do any customers have negotiated price-lock contracts");
    expect(dp6Block).toContain("answered");
    expect(dp6Block).toContain("'none'");
    expect(dp6Block).toContain("no customers under price-lock today");
    expect(dp6Block).toContain("build a price-lock customer attribute anyway as a future hook");
  });
});
