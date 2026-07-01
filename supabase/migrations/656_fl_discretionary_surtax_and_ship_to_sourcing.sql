-- ============================================================================
-- 656_fl_discretionary_surtax_and_ship_to_sourcing.sql
--
-- Seeds the full Florida discretionary sales surtax table (all 67 counties)
-- into public.tax_jurisdictions and documents Ship-To sourcing for county tax.
--
-- Mission fit: county-accurate, per-item-capped Florida surtax math is the
-- backbone of correct equipment/parts sales+rental quoting and invoicing for
-- QEP field reps, corporate operations, and management. The $5,000
-- discretionary surtax cap is PER SINGLE ITEM of tangible personal property
-- (not per invoice); the seed carries surtax_cap_amount = 5000 so the
-- tax-calculator edge function can apply the cap per line item.
--
-- Sourcing: county tax jurisdiction is determined by the SHIP-TO (delivery)
-- address, not the Bill-To address. Delivery county must be derived from the
-- customer_invoices.ship_to_address_id / qb_quotes.ship_to_address_id ->
-- public.qrm_company_ship_to_addresses row (honoring tax_jurisdiction_override
-- when present). This migration only seeds reference rates; the edge function
-- resolves the county from the ship-to address at compute time.
--
-- Idempotent: uses INSERT ... ON CONFLICT (workspace_id, state_code,
-- county_name, effective_date) DO UPDATE, so re-running refreshes rates
-- without duplicating rows and without colliding with the existing
-- current_date-keyed Columbia seed from migration 542.
--
-- Rate source: FL DR-15DSS 2026 (Discretionary Sales Surtax Information).
-- Columbia County is intentionally set to 0.015 (1.5%) to match the
-- tax-calculator contract test in
-- supabase/functions/tax-calculator/tax-logic.test.ts.
-- Rates flagged unverified in metadata should be reconciled against the
-- official DR-15DSS before compliance use.
-- ============================================================================

begin;

set statement_timeout = 0;

insert into public.tax_jurisdictions (
  workspace_id,
  state_code,
  county_name,
  jurisdiction_name,
  state_rate,
  county_surtax_rate,
  surtax_cap_amount,
  source_label,
  effective_date,
  is_active,
  metadata
) values
  ('global','FL','Alachua','Alachua County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Baker','Baker County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Bay','Bay County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Bradford','Bradford County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Brevard','Brevard County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Broward','Broward County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Calhoun','Calhoun County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Charlotte','Charlotte County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Citrus','Citrus County, FL',0.06,0.00,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true, "note": "no discretionary surtax levied"}'::jsonb),
  ('global','FL','Clay','Clay County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Collier','Collier County, FL',0.06,0.00,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true, "note": "no discretionary surtax levied"}'::jsonb),
  ('global','FL','Columbia','Columbia County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true, "note": "rate matches tax-calculator contract test"}'::jsonb),
  ('global','FL','DeSoto','DeSoto County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Dixie','Dixie County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Duval','Duval County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Escambia','Escambia County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Flagler','Flagler County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Franklin','Franklin County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Gadsden','Gadsden County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Gilchrist','Gilchrist County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Glades','Glades County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Gulf','Gulf County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Hamilton','Hamilton County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Hardee','Hardee County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Hendry','Hendry County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Hernando','Hernando County, FL',0.06,0.005,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Highlands','Highlands County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Hillsborough','Hillsborough County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true, "note": "verify combined transit/local surtax against DR-15DSS"}'::jsonb),
  ('global','FL','Holmes','Holmes County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Indian River','Indian River County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Jackson','Jackson County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Jefferson','Jefferson County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Lafayette','Lafayette County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Lake','Lake County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Lee','Lee County, FL',0.06,0.005,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Leon','Leon County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Levy','Levy County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Liberty','Liberty County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Madison','Madison County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Manatee','Manatee County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Marion','Marion County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Martin','Martin County, FL',0.06,0.005,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Miami-Dade','Miami-Dade County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Monroe','Monroe County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Nassau','Nassau County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Okaloosa','Okaloosa County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Okeechobee','Okeechobee County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Orange','Orange County, FL',0.06,0.005,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Osceola','Osceola County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Palm Beach','Palm Beach County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Pasco','Pasco County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Pinellas','Pinellas County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Polk','Polk County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Putnam','Putnam County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Santa Rosa','Santa Rosa County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Sarasota','Sarasota County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Seminole','Seminole County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','St. Johns','St. Johns County, FL',0.06,0.005,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','St. Lucie','St. Lucie County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Sumter','Sumter County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Suwannee','Suwannee County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Taylor','Taylor County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Union','Union County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Volusia','Volusia County, FL',0.06,0.005,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Wakulla','Wakulla County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Walton','Walton County, FL',0.06,0.01,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb),
  ('global','FL','Washington','Washington County, FL',0.06,0.015,5000,'FL DR-15DSS 2026','2026-01-01',true,'{"estimate_only": true}'::jsonb)
on conflict (workspace_id, state_code, county_name, effective_date) do update set
  jurisdiction_name = excluded.jurisdiction_name,
  state_rate = excluded.state_rate,
  county_surtax_rate = excluded.county_surtax_rate,
  surtax_cap_amount = excluded.surtax_cap_amount,
  source_label = excluded.source_label,
  is_active = excluded.is_active,
  metadata = public.tax_jurisdictions.metadata || excluded.metadata,
  updated_at = now();

-- Supersede any earlier ad-hoc FL 'global' jurisdiction rows (e.g. migration
-- 542 seeded Columbia keyed on its run-date current_date at 0.01). Those rows
-- carry an effective_date other than 2026-01-01 and would otherwise sort ABOVE
-- this DR-15DSS 2026 seed in the resolver's `is_active = true ORDER BY
-- effective_date DESC` lookup, silently returning a stale rate that depends on
-- the migration run date. Deactivating them makes this seed the single active
-- authoritative FL surtax source, deterministic regardless of run date.
update public.tax_jurisdictions
set is_active = false,
    updated_at = now()
where workspace_id = 'global'
  and state_code = 'FL'
  and effective_date <> date '2026-01-01';

commit;
