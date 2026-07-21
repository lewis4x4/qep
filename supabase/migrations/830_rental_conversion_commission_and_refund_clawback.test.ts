import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/830_rental_conversion_commission_and_refund_clawback.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();
const conversionDealHelper = readFileSync(
  join(
    process.cwd(),
    "supabase/functions/_shared/rental-conversion-deal.ts",
  ),
  "utf8",
).replace(/\s+/g, " ");

function functionSql(name: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("830 rental conversion commission + refund clawback", () => {
  it("keeps commission truth unit-, contract-, and payee-specific without rewriting asset cost", () => {
    expect(compact).toContain(
      "create table if not exists public.rental_unit_commission_ledger",
    );
    expect(compact).toContain(
      "equipment_id uuid not null references public.qrm_equipment(id) on delete restrict",
    );
    expect(compact).toContain(
      "rental_contract_id uuid not null references public.rental_contracts(id) on delete restrict",
    );
    expect(compact).toContain(
      "salesperson_id uuid not null references public.profiles(id) on delete restrict",
    );
    expect(compact).toContain(
      "rental_contract_commission_id uuid not null references public.rental_contract_commissions(id) on delete restrict",
    );
    expect(compact).toContain("split_pct_snapshot numeric(5, 2) not null");
    expect(compact).toContain(
      "origin_paid_entry_id uuid references public.rental_unit_commission_ledger(id) on delete restrict",
    );
    expect(compact).not.toMatch(/update public\.qrm_equipment/);
    expect(compact).not.toMatch(/insert into public\.gl_/);
  });

  it("allocates one exact five-percent source total across snapshotted payee splits", () => {
    expect(compact).toContain(
      "commission_rate_pct numeric(7, 6) not null default 0.050000 check (commission_rate_pct = 0.050000)",
    );
    const paid = functionSql("rental_record_unit_commission_paid");
    expect(paid).toContain(
      "v_total_commission := round(p_rent_basis_cents::numeric * 0.050000)::bigint",
    );
    expect(paid).toContain("v_split.salesperson_id, v_split.id, v_split.split_pct");
    expect(paid).toContain(
      "active rental contract commission splits must total 100",
    );
    expect(compact).toContain(
      "all payee rows in one source event sum to +round(source rent x 5%) or its exact negative",
    );
    for (const refundKind of [
      "credit_memo",
      "correction",
      "goodwill_refund",
      "cash_refund",
      "other_rent_refund",
    ]) {
      expect(compact).toContain(`'${refundKind}'`);
    }
  });

  it("makes paid and refund recording service-only and source-semantic under concurrency", () => {
    expect(compact).toContain(
      "create index if not exists idx_rental_unit_commission_ledger_source_replay on public.rental_unit_commission_ledger (workspace_id, source_event_key)",
    );
    const paid = functionSql("rental_record_unit_commission_paid");
    const refund = functionSql("rental_record_rent_refund_clawback");
    expect(paid).toContain("requires service_role");
    expect(refund).toContain("requires service_role");
    expect(paid).toContain("rental-commission-source:");
    expect(refund).toContain("rental-commission-source:");
    expect(paid).toContain("rental-commission-unit:");
    expect(refund).toContain("rental-commission-unit:");
    expect(paid).toContain("source_rent_basis_cents <> p_rent_basis_cents");
    expect(refund).toContain(
      "source_rent_basis_cents <> p_refunded_rent_cents",
    );
    expect(paid).toContain(
      "paid commission rent basis exceeds invoice rental charge",
    );
    expect(refund).toContain(
      "refund clawback exceeds attributable prior paid commission",
    );
    expect(refund).toContain("for update");
    expect(compact).toContain(
      "uq_rental_unit_commission_paid_source_payee",
    );
    expect(compact).toContain(
      "uq_rental_unit_commission_refund_source_origin",
    );
  });

  it("claws refunds only against original attributable paid entries", () => {
    const refund = functionSql("rental_record_rent_refund_clawback");
    const provenance = functionSql("rental_validate_unit_commission_provenance");
    expect(refund).toContain("refund.origin_paid_entry_id = paid.id");
    expect(refund).toContain("v_origin.salesperson_id");
    expect(refund).toContain("v_origin.rental_contract_commission_id");
    expect(refund).toContain("-v_allocated_clawback");
    expect(provenance).toContain(
      "refund clawback must reference the original attributable paid commission",
    );
    expect(refund).toContain("source key/reference");
  });

  it("freezes the exact RN9 formula against NET prior unit commission", () => {
    expect(compact).toContain(
      "conversion_rate_pct numeric(7, 6) not null default 0.150000 check (conversion_rate_pct = 0.150000)",
    );
    expect(compact).toContain(
      "round(gross_margin_cents::numeric * conversion_rate_pct)::bigint - prior_net_rental_commission_cents",
    );
    expect(compact).toContain(
      "negotiated_rent_credit_cents bigint not null default 0",
    );
    const calculate = functionSql("rental_calculate_conversion_commission");
    expect(calculate).toContain("and l.equipment_id = p_equipment_id");
    expect(calculate).not.toContain("and l.entry_kind = 'rental_commission_paid'");
    expect(calculate).toContain(
      "negotiated rent credit exceeds net attributable paid rent on the unit",
    );
  });

  it("does not auto-apply all accrued rent as the negotiated conversion credit", () => {
    expect(conversionDealHelper).toContain(
      "const amountDollars = Math.max(0, purchaseCents) / 100",
    );
    expect(conversionDealHelper).not.toContain(
      "Math.max(0, purchaseCents - accruedCents)",
    );
    expect(conversionDealHelper).toContain(
      "negotiated_rent_credit_cents: null",
    );
    expect(conversionDealHelper).toContain(
      "negotiated_rent_credit_required: true",
    );
  });

  it("requires canonical rental conversion provenance and finance-controlled posting", () => {
    const validate = functionSql("rental_validate_conversion_commission");
    const post = functionSql("rental_post_conversion_commission");
    expect(validate).toContain("join public.qrm_deals q on q.id = d.crm_deal_id");
    expect(validate).toContain(
      "join public.rental_contracts c on c.id = q.rental_contract_id",
    );
    expect(validate).toContain("from public.qrm_deal_equipment de");
    expect(validate).toContain("de.role::text in ('subject', 'rental')");
    expect(post).toContain("p.role::text in ('admin', 'manager', 'owner')");
    expect(post).toContain("if v_deal.commission_paid then");
    expect(post).toContain(
      "v_deal.salesman_id is distinct from v_row.sale_salesperson_id",
    );
    expect(post).toContain("set commission_rate_pct = 0.1500");
    expect(post).toContain(
      "commission_cents = v_row.net_conversion_commission_cents",
    );
  });

  it("does not turn a negative formula result into silent employee debt", () => {
    const validate = functionSql("rental_validate_conversion_commission");
    const guard = functionSql("rental_guard_conversion_commission_mutation");
    expect(validate).toContain("new.status := 'exception'");
    expect(guard).toContain(
      "negative conversion settlement cannot post; void and resolve",
    );
    expect(compact).not.toContain("greatest(0, gross_margin_cents");
  });

  it("is append-only with tenant-scoped finance reads and least privilege", () => {
    expect(compact).toContain(
      "rental unit commission ledger is append-only",
    );
    expect(compact).toContain(
      "workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'finance_admin', 'manager', 'owner')",
    );
    expect(compact).toContain(
      "revoke all on table public.rental_unit_commission_ledger from public, anon, authenticated",
    );
    expect(compact).toContain(
      "revoke all on function public.rental_record_rent_refund_clawback( text, uuid, uuid, uuid, bigint, text, text, text, uuid, timestamptz, jsonb ) from public, anon, authenticated",
    );
  });

  it("keeps L12.1 honestly unshipped until canonical event producers pass acceptance", () => {
    expect(compact).toContain("where task_id = 'l12.1'");
    expect(compact).toContain("set ship_state = 'in_progress'");
    expect(compact).toContain(
      "blocking_decision = 'blk-rental-commission-source-wiring'",
    );
    expect(compact).toContain("'ship_state', 'in_progress'");
    expect(compact).toContain("'owner_answers', jsonb_build_array('rn9', 'rn10')");
    expect(compact).toContain("'backend_state', 'backend_ready_unshipped'");
    expect(compact).toContain("mission alignment conditional pass");
    expect(compact).toContain("no refund source was invented");
  });
});
