import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/834_sales_availability_alert_mute_idempotency.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("834 availability-alert mute idempotency", () => {
  it("fixes forward the live RPC without changing its security boundary", () => {
    expect(compact).toContain(
      "create or replace function public.set_sales_availability_alert_mute",
    );
    expect(compact).toContain("security definer");
    expect(compact).toContain("set search_path = ''");
    expect(compact).toContain("active workspace membership required");
    expect(compact).toContain(
      "revoke all on function public.set_sales_availability_alert_mute(text, timestamptz) from public, anon, service_role",
    );
    expect(compact).toContain(
      "grant execute on function public.set_sales_availability_alert_mute(text, timestamptz) to authenticated",
    );
  });

  it("serializes enqueue and mute changes with the same deterministic lock", () => {
    expect(compact).toContain(
      "create or replace function public.enqueue_sales_availability_alert",
    );
    expect(compact).toContain(
      "select coalesce(array_agg(profile.id order by profile.id), '{}'::uuid[]) into v_recipient_user_ids",
    );
    expect(compact).toContain(
      "foreach v_recipient_user_id in array v_recipient_user_ids",
    );
    expect(compact).toContain("select unnest(v_recipient_user_ids) as user_id");
    expect(compact).toContain(
      "not (delivery.recipient_user_id = any(v_recipient_user_ids))",
    );
    expect(compact.match(/pg_catalog\.hashtextextended\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(compact).toContain(
      "grant execute on function public.enqueue_sales_availability_alert(uuid) to service_role",
    );
  });

  it("does not rewrite an unchanged preference", () => {
    expect(compact).toContain(
      "insert into public.sales_availability_alert_preferences as preference",
    );
    expect(compact).toContain(
      "preference.muted_channel is distinct from excluded.muted_channel",
    );
    expect(compact).toContain(
      "preference.muted_until is distinct from excluded.muted_until",
    );
    expect(compact).toContain("if not found then select preference.* into v_row");
  });

  it("changes only delivery rows whose effective mute state transitions", () => {
    expect(compact).toContain(
      "delivery.status in ('queued', 'failed')",
    );
    expect(compact).toContain("delivery.status = 'muted'");
    expect(compact).toContain(
      "v_channel_is_muted and delivery.channel = p_channel",
    );
    expect(compact).not.toContain(
      "delivery.status in ('queued', 'muted')",
    );
    expect(compact).toContain(
      "public.sales_availability_alert_deliveries.status = 'failed' and excluded.status = 'muted'",
    );
    expect(compact).toContain(
      "public.sales_availability_alert_deliveries.status = 'cancelled'",
    );
  });

  it("reconciles timed mute expiry on server time", () => {
    expect(compact).toContain(
      "create or replace function public.reconcile_my_sales_availability_alert_mute_expiry()",
    );
    expect(compact).toContain(
      "create or replace function public.reconcile_expired_sales_availability_alert_mutes()",
    );
    expect(compact).toContain("preference.muted_until <= now()");
    expect(compact).toContain("idx_sales_alert_preferences_expiry");
    expect(compact).toContain("sales-availability-mute-expiry");
    expect(compact).toContain("'* * * * *'");
    expect(compact).toContain(
      "grant execute on function public.reconcile_my_sales_availability_alert_mute_expiry() to authenticated",
    );
    expect(compact).toContain(
      "grant execute on function public.reconcile_expired_sales_availability_alert_mutes() to service_role",
    );
  });

  it("preserves terminal and in-flight deliveries", () => {
    for (const status of [
      "sending",
      "sent",
      "delivered",
      "dead_letter",
      "cancelled",
    ]) {
      expect(compact).not.toContain(`delivery.status = '${status}'`);
    }
    expect(compact).not.toContain("delete from");
    expect(compact).not.toContain("truncate table");
  });

  it("documents additive rollback and fix-forward posture", () => {
    expect(compact).toContain("rolling back the frontend remains");
    expect(compact).toContain("compatible with this migration");
    expect(compact).toContain("keep this database correction live");
    expect(compact).toContain("new numbered fix-forward migration");
    expect(compact).toContain("never restore");
    expect(compact).toContain("migration 831's broad delivery refresh");
  });
});
