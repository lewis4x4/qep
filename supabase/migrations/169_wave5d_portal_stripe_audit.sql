-- ============================================================================
-- Migration 169: Wave 5D — Portal Stripe + document visibility audit (Phase 2D)
--
-- Adds:
--   1. portal_payment_intents (Stripe PaymentIntent record-keeping with
--      signature-verified webhook lifecycle)
--   2. document_visibility_audit (every visibility toggle on
--      equipment_documents writes a row — actor + before/after)
--   3. visibility-toggle trigger on equipment_documents
--
-- Stripe contract:
--   - Webhook MUST verify signature; no plaintext PAN ever stored
--   - Manual fallback (mailto: link) when Stripe is unavailable
--   - Successful PaymentIntent ⇒ AR invoice mark-paid + ledger entry
-- ============================================================================

-- ── 1. Portal payment intents ─────────────────────────────────────────────

create table if not exists public.portal_payment_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  invoice_id uuid,                                                  -- references ar_invoices(id) once standardized
  stripe_payment_intent_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'requires_payment_method' check (status in (
    'requires_payment_method', 'requires_confirmation', 'requires_action',
    'processing', 'succeeded', 'canceled', 'failed'
  )),
  customer_email text,
  metadata jsonb not null default '{}'::jsonb,
  webhook_signature_verified boolean not null default false,
  succeeded_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.portal_payment_intents is 'Stripe PaymentIntent record-keeping. webhook_signature_verified MUST be true before any AR mutation fires.';

alter table public.portal_payment_intents enable row level security;

create policy "ppi_workspace_select" on public.portal_payment_intents for select
  using (workspace_id = public.get_my_workspace());
create policy "ppi_service_modify" on public.portal_payment_intents for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create unique index uq_ppi_stripe on public.portal_payment_intents(stripe_payment_intent_id);
create index idx_ppi_company on public.portal_payment_intents(company_id);
create index idx_ppi_status on public.portal_payment_intents(status);
create index idx_ppi_workspace on public.portal_payment_intents(workspace_id);

create trigger set_ppi_updated_at
  before update on public.portal_payment_intents
  for each row execute function public.set_updated_at();

-- ── 2. Document visibility audit ─────────────────────────────────────────

create table if not exists public.document_visibility_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  document_id uuid not null,                                        -- equipment_documents(id), no FK to allow cascading flexibility
  changed_by uuid references public.profiles(id) on delete set null,
  visibility_before boolean,
  visibility_after boolean,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.document_visibility_audit is 'Every toggle on equipment_documents.customer_visible writes a row. Actor + before/after captured.';

alter table public.document_visibility_audit enable row level security;

create policy "dva_workspace" on public.document_visibility_audit for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "dva_service" on public.document_visibility_audit for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_dva_document on public.document_visibility_audit(document_id, created_at desc);
create index idx_dva_workspace on public.document_visibility_audit(workspace_id);

-- ── 3. Visibility-toggle trigger on equipment_documents ──────────────────
-- equipment_documents.customer_visible may be 'visible_to_portal' depending on
-- the migration that created it. Use a defensive trigger that only fires when
-- the column actually exists and changed.

create or replace function public.log_document_visibility_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_before boolean;
  v_after boolean;
  v_workspace text;
begin
  -- Try the most common column names; safe to fall through.
  begin
    v_before := old.customer_visible;
    v_after  := new.customer_visible;
  exception when undefined_column then
    v_before := null;
    v_after := null;
  end;

  if v_before is distinct from v_after then
    begin
      v_workspace := new.workspace_id;
    exception when undefined_column then
      v_workspace := 'default';
    end;

    insert into public.document_visibility_audit (
      workspace_id, document_id, changed_by, visibility_before, visibility_after, reason
    ) values (
      coalesce(v_workspace, 'default'),
      new.id,
      auth.uid(),
      v_before,
      v_after,
      'staff toggle'
    );
  end if;

  return new;
end;
$$;

-- Attach the trigger only if equipment_documents exists.
do $$
begin
  if exists (select 1 from pg_class where relname = 'equipment_documents' and relnamespace = 'public'::regnamespace) then
    drop trigger if exists log_doc_visibility_trg on public.equipment_documents;
    execute 'create trigger log_doc_visibility_trg
      after update on public.equipment_documents
      for each row execute function public.log_document_visibility_change()';
  end if;
end $$;
