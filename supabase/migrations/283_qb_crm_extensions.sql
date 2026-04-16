-- ============================================================================
-- Migration 283: QB CRM Extensions
--
-- Additive enrichment for Quote Builder Moonshot (Slice 01).
-- Extends qrm_companies with classification/territory/status fields.
-- Extends qrm_equipment with purchase tracking for replacement cycle intelligence.
-- Recreates the crm_companies and crm_equipment views to expose the new columns.
--
-- DISCOVERY: In the live DB, crm_* are VIEWS backed by qrm_* base tables.
-- All ALTER TABLE operations target the base tables.
-- ============================================================================

-- ── qrm_companies (base table) ───────────────────────────────────────────────

alter table public.qrm_companies
  add column if not exists legal_name       text,
  add column if not exists dba              text,
  add column if not exists phone            text,
  add column if not exists website          text,
  add column if not exists classification   text
    check (classification in (
      'standard','gmu','forestry','construction',
      'land_clearing','rental','logging','other'
    )),
  add column if not exists territory_code   text,
  add column if not exists county           text,
  add column if not exists status           text
    default 'active'
    check (status in ('active','inactive','prospect','archived')),
  add column if not exists notes            text;

create index if not exists idx_qrm_companies_classification
  on public.qrm_companies(classification)
  where deleted_at is null;

create index if not exists idx_qrm_companies_territory
  on public.qrm_companies(territory_code)
  where deleted_at is null;

create index if not exists idx_qrm_companies_county
  on public.qrm_companies(county)
  where deleted_at is null;

create index if not exists idx_qrm_companies_status
  on public.qrm_companies(status)
  where deleted_at is null;

-- ── Recreate crm_companies view with new columns ─────────────────────────────

create or replace view public.crm_companies
  with (security_invoker = true)
  as
  select
    id,
    workspace_id,
    name,
    parent_company_id,
    assigned_rep_id,
    hubspot_company_id,
    address_line_1,
    address_line_2,
    city,
    state,
    postal_code,
    country,
    metadata,
    created_at,
    updated_at,
    deleted_at,
    -- QB Moonshot additions
    legal_name,
    dba,
    phone,
    website,
    classification,
    territory_code,
    county,
    status,
    notes
  from public.qrm_companies;

-- ── qrm_equipment (base table) ───────────────────────────────────────────────

alter table public.qrm_equipment
  add column if not exists purchased_from_qep  boolean default false,
  add column if not exists purchase_date       date;

create index if not exists idx_qrm_equipment_purchased_from_qep
  on public.qrm_equipment(purchased_from_qep)
  where purchased_from_qep = true and deleted_at is null;

-- ── Recreate crm_equipment view with new columns ─────────────────────────────
-- Multiple views (margin_analytics_view, v_predictive_plays, v_rep_customers,
-- v_rep_pipeline, v_replenish_queue_enriched) depend on crm_equipment.
-- CREATE OR REPLACE preserves those dependencies — only allowed when new
-- columns are appended at the end and existing columns are unchanged.

create or replace view public.crm_equipment
  with (security_invoker = true)
  as
  select
    id,
    workspace_id,
    company_id,
    primary_contact_id,
    name,
    asset_tag,
    serial_number,
    metadata,
    created_at,
    updated_at,
    deleted_at,
    make,
    model,
    year,
    category,
    vin_pin,
    condition,
    availability,
    ownership,
    engine_hours,
    mileage,
    fuel_type,
    weight_class,
    operating_capacity,
    location_description,
    latitude,
    longitude,
    purchase_price,
    current_market_value,
    replacement_cost,
    daily_rental_rate,
    weekly_rental_rate,
    monthly_rental_rate,
    warranty_expires_on,
    last_inspection_at,
    next_service_due_at,
    notes,
    photo_urls,
    intake_stage,
    readiness_status,
    readiness_blocker_reason,
    sale_ready_at,
    aging_bucket,
    -- QB Moonshot additions
    purchased_from_qep,
    purchase_date
  from public.qrm_equipment;
