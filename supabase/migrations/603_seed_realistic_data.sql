-- ============================================================================
-- 603_seed_realistic_data.sql
-- QB-14 / A5.10 realistic demo seed.
--
-- Deterministic, idempotent seed data for QRM + Quote Builder demos.
-- Uses QRM base tables only; CRM compatibility views are left for app reads and
-- verification. This seed has no VitalEdge/IntelliDealer/API dependency.
-- ============================================================================

-- ── Companies ────────────────────────────────────────────────────────────────
create temporary table qb14_company_seed on commit drop as
with ord as (
  select generate_series(1, 60) as i
), shaped as (
  select
    i,
    case i
      when 1 then 'Big Oak Underbrushing'
      when 2 then 'Precision Land Services'
      when 3 then 'DREC'
      when 4 then 'Apex Timber Holdings'
      when 5 then 'Apex Timber Lake City'
      when 6 then 'Gulf Coast Right-of-Way'
      when 7 then 'Pine River Rentals'
      when 8 then 'North Florida Forestry Group'
      when 9 then 'Suwannee Land Clearing'
      when 10 then 'Okefenokee Site Prep'
      when 11 then 'Coastal Utility Contractors'
      when 12 then 'RidgeLine Mulching'
      else format(
        '%s %s',
        (array['Keystone','Sawgrass','Ironwood','Magnolia','Live Oak','Cypress','Palmetto','Timberline'])[((i - 13) % 8) + 1],
        (array['Site Services','Forestry Works','Land Management','Utility Group','Rental Fleet','Mulching Co','Timber Operations','Civil Contractors'])[((i - 13) / 8) + 1]
      )
    end as name,
    (array['north_florida','gulf_coast','south_georgia','central_florida'])[((i - 1) % 4) + 1] as territory_code,
    (array['forestry','construction','land_clearing','rental','logging','standard'])[((i - 1) % 6) + 1] as classification,
    (array['Lake City','Tallahassee','Valdosta','Ocala','Pensacola','Waycross','Gainesville','Panama City'])[((i - 1) % 8) + 1] as city,
    (array['FL','FL','GA','FL','FL','GA','FL','FL'])[((i - 1) % 8) + 1] as state,
    (array['Columbia','Leon','Lowndes','Marion','Escambia','Ware','Alachua','Bay'])[((i - 1) % 8) + 1] as county
  from ord
)
select
  ('b014c000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
  'default'::text as workspace_id,
  name,
  name || ' LLC' as legal_name,
  case when i in (1, 2, 3, 7, 12) then name else null end as dba,
  format('(904) 555-%s', lpad((1000 + i)::text, 4, '0')) as phone,
  format('%s Demo Yard Road', 100 + i) as address_line_1,
  city,
  state,
  lpad((32000 + i)::text, 5, '0') as postal_code,
  'USA'::text as country,
  classification,
  territory_code,
  county,
  'active'::text as status,
  ('QB14-' || lpad(i::text, 4, '0'))::text as legacy_customer_number,
  upper(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) as search_1,
  upper(regexp_replace(coalesce(city, '') || state || lpad(i::text, 3, '0'), '[^a-zA-Z0-9]', '', 'g')) as search_2,
  case i
    when 1 then 'Beau Tillman'
    when 2 then 'Nora Kline'
    when 3 then 'Drew Carter'
    else (array['Avery Brooks','Cam Hayes','Morgan Lee','Quinn Parker','Taylor Reed','Jordan Blake'])[((i - 1) % 6) + 1]
  end as owner_name,
  jsonb_build_object(
    'seedBatchId', 'qb14-realistic-demo-2026-05-20',
    'seedSource', 'qb14_demo_seed',
    'liveImport', false,
    'provenance', 'deterministic_demo_seed',
    'externalDependency', null,
    'accountSegment', classification,
    'qepTerritory', territory_code,
    'seedOrdinal', i
  ) as metadata
from shaped;

insert into public.qrm_companies (
  id, workspace_id, name, legal_name, dba, phone, address_line_1, city, state,
  postal_code, country, classification, territory_code, county, status,
  legacy_customer_number, search_1, search_2, owner_name, metadata
)
select
  id, workspace_id, name, legal_name, dba, phone, address_line_1, city, state,
  postal_code, country, classification, territory_code, county, status,
  legacy_customer_number, search_1, search_2, owner_name, metadata
from qb14_company_seed
on conflict (id) do update set
  workspace_id = excluded.workspace_id,
  name = excluded.name,
  legal_name = excluded.legal_name,
  dba = excluded.dba,
  phone = excluded.phone,
  address_line_1 = excluded.address_line_1,
  city = excluded.city,
  state = excluded.state,
  postal_code = excluded.postal_code,
  country = excluded.country,
  classification = excluded.classification,
  territory_code = excluded.territory_code,
  county = excluded.county,
  status = excluded.status,
  legacy_customer_number = excluded.legacy_customer_number,
  search_1 = excluded.search_1,
  search_2 = excluded.search_2,
  owner_name = excluded.owner_name,
  metadata = excluded.metadata,
  updated_at = now(),
  deleted_at = null
where public.qrm_companies.metadata->>'seedBatchId' = 'qb14-realistic-demo-2026-05-20';

-- ── Contacts ─────────────────────────────────────────────────────────────────
create temporary table qb14_contact_seed on commit drop as
with ord as (
  select generate_series(1, 200) as i
), shaped as (
  select
    i,
    (((i - 1) % 60) + 1) as company_ord,
    (array['Mason','Hannah','Jordan','Elena','Wes','Riley','Avery','Cam','Nora','Drew','Parker','Quinn','Taylor','Morgan','Casey','Blake','Harper','Logan','Reese','Sawyer'])[((i - 1) % 20) + 1] as first_name,
    (array['Tillman','Kline','Carter','Rivera','Bryant','Shaw','Brooks','Hayes','Pike','Torres','Maddox','Parker','Reed','Lee','Stone','Bennett','Collins','Ward','Bell','Foster'])[((i - 1) % 20) + 1] as last_name,
    (array['Owner','Fleet Manager','Operations Manager','Superintendent','Rental Coordinator','Procurement Manager','Service Manager','Controller'])[((i - 1) % 8) + 1] as title
  from ord
)
select
  ('b014c001-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
  'default'::text as workspace_id,
  first_name,
  last_name,
  lower(format('%s.%s.%s@qep-demo.local', first_name, last_name, i)) as email,
  format('(904) 556-%s', lpad((2000 + i)::text, 4, '0')) as phone,
  title,
  ('b014c000-0000-4000-8000-' || lpad(company_ord::text, 12, '0'))::uuid as primary_company_id,
  jsonb_build_object(
    'seedBatchId', 'qb14-realistic-demo-2026-05-20',
    'seedSource', 'qb14_demo_seed',
    'liveImport', false,
    'provenance', 'deterministic_demo_seed',
    'externalDependency', null,
    'seedOrdinal', i,
    'companyOrdinal', company_ord
  ) as metadata
from shaped;

insert into public.qrm_contacts (
  id, workspace_id, first_name, last_name, email, phone, title,
  primary_company_id, metadata
)
select
  id, workspace_id, first_name, last_name, email, phone, title,
  primary_company_id, metadata
from qb14_contact_seed
on conflict (id) do update set
  workspace_id = excluded.workspace_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  phone = excluded.phone,
  title = excluded.title,
  primary_company_id = excluded.primary_company_id,
  metadata = excluded.metadata,
  updated_at = now(),
  deleted_at = null
where public.qrm_contacts.metadata->>'seedBatchId' = 'qb14-realistic-demo-2026-05-20';

insert into public.qrm_contact_companies (
  id, workspace_id, contact_id, company_id, is_primary
)
select
  ('b014cc00-0000-4000-8000-' || lpad(row_number() over (order by id)::text, 12, '0'))::uuid as id,
  workspace_id,
  id as contact_id,
  primary_company_id as company_id,
  true as is_primary
from qb14_contact_seed
on conflict (workspace_id, contact_id, company_id) do update set
  is_primary = true;

-- ── Equipment fleet assets ──────────────────────────────────────────────────
create temporary table qb14_model_seed on commit drop as
select *
from (values
  (1, 'Bandit', '12XP', 'other'::public.crm_equipment_category, 57500::numeric),
  (2, 'Bandit', '19XP', 'other'::public.crm_equipment_category, 89500::numeric),
  (3, 'Bandit', '2460XP', 'other'::public.crm_equipment_category, 225000::numeric),
  (4, 'Bandit', '2900T', 'other'::public.crm_equipment_category, 295000::numeric),
  (5, 'Develon', 'DX63-5', 'excavator'::public.crm_equipment_category, 74950::numeric),
  (6, 'Develon', 'DX225LC-7', 'excavator'::public.crm_equipment_category, 258000::numeric),
  (7, 'Develon', 'DL280-7', 'loader'::public.crm_equipment_category, 295000::numeric),
  (8, 'Yanmar', 'ViO35-6A', 'excavator'::public.crm_equipment_category, 62500::numeric),
  (9, 'Yanmar', 'ViO55-6A', 'excavator'::public.crm_equipment_category, 89500::numeric),
  (10, 'Yanmar', 'SV100-7', 'excavator'::public.crm_equipment_category, 132500::numeric),
  (11, 'Yanmar', 'T80', 'skid_steer'::public.crm_equipment_category, 78500::numeric),
  (12, 'ASV', 'RT-65', 'skid_steer'::public.crm_equipment_category, 73200::numeric),
  (13, 'ASV', 'RT-85', 'skid_steer'::public.crm_equipment_category, 88950::numeric),
  (14, 'ASV', 'RT-135', 'skid_steer'::public.crm_equipment_category, 104495::numeric),
  (15, 'Barko', '295B', 'loader'::public.crm_equipment_category, 225000::numeric),
  (16, 'Barko', '495ML', 'other'::public.crm_equipment_category, 467500::numeric),
  (17, 'Barko', '775B', 'loader'::public.crm_equipment_category, 589000::numeric),
  (18, 'Prinoth', 'Panther T14R', 'other'::public.crm_equipment_category, 397500::numeric),
  (19, 'Bobcat', 'T76', 'skid_steer'::public.crm_equipment_category, 76500::numeric),
  (20, 'Caterpillar', '308CR', 'excavator'::public.crm_equipment_category, 145000::numeric)
) as m(model_ord, make, model, category, base_value);

create temporary table qb14_equipment_seed on commit drop as
with ord as (
  select generate_series(1, 100) as i
), shaped as (
  select
    o.i,
    (((o.i - 1) % 60) + 1) as company_ord,
    (((o.i - 1) % 200) + 1) as contact_ord,
    m.*
  from ord o
  join qb14_model_seed m on m.model_ord = (((o.i - 1) % 20) + 1)
)
select
  ('b014e000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
  'default'::text as workspace_id,
  ('b014c000-0000-4000-8000-' || lpad(company_ord::text, 12, '0'))::uuid as company_id,
  ('b014c001-0000-4000-8000-' || lpad(contact_ord::text, 12, '0'))::uuid as primary_contact_id,
  format('%s %s demo fleet unit %s', make, model, lpad(i::text, 3, '0')) as name,
  format('QB14-EQ-%s', lpad(i::text, 4, '0')) as asset_tag,
  format('QB14SN%s', lpad(i::text, 8, '0')) as serial_number,
  format('QB14PIN%s', lpad(i::text, 8, '0')) as vin_pin,
  make,
  model,
  2019 + ((i - 1) % 7) as year,
  category,
  (array['excellent','good','fair'])[((i - 1) % 3) + 1]::public.crm_equipment_condition as condition,
  (array['available','in_service','reserved'])[((i - 1) % 3) + 1]::public.crm_equipment_availability as availability,
  'customer_owned'::public.crm_equipment_ownership as ownership,
  (450 + (i * 73 % 6200))::numeric(12,1) as engine_hours,
  round((base_value * (0.72 + (((i - 1) % 5) * 0.04)))::numeric, 2) as purchase_price,
  round((base_value * (0.56 + (((i - 1) % 6) * 0.035)))::numeric, 2) as current_market_value,
  round((base_value * 1.12)::numeric, 2) as replacement_cost,
  'QEP demo territory fleet asset'::text as notes,
  '[]'::jsonb as photo_urls,
  (i % 4 <> 0) as purchased_from_qep,
  (current_date - ((180 + i * 9)::text || ' days')::interval)::date as purchase_date,
  jsonb_build_object(
    'seedBatchId', 'qb14-realistic-demo-2026-05-20',
    'seedSource', 'qb14_demo_seed',
    'liveImport', false,
    'provenance', 'deterministic_demo_seed',
    'externalDependency', null,
    'seedOrdinal', i,
    'fleetRole', case when i % 5 = 0 then 'replacement_target' else 'customer_owned_reference' end
  ) as metadata
from shaped;

insert into public.qrm_equipment (
  id, workspace_id, company_id, primary_contact_id, name, asset_tag,
  serial_number, vin_pin, make, model, year, category, condition,
  availability, ownership, engine_hours, purchase_price,
  current_market_value, replacement_cost, notes, photo_urls,
  purchased_from_qep, purchase_date, metadata
)
select
  id, workspace_id, company_id, primary_contact_id, name, asset_tag,
  serial_number, vin_pin, make, model, year, category, condition,
  availability, ownership, engine_hours, purchase_price,
  current_market_value, replacement_cost, notes, photo_urls,
  purchased_from_qep, purchase_date, metadata
from qb14_equipment_seed
on conflict (id) do update set
  workspace_id = excluded.workspace_id,
  company_id = excluded.company_id,
  primary_contact_id = excluded.primary_contact_id,
  name = excluded.name,
  asset_tag = excluded.asset_tag,
  serial_number = excluded.serial_number,
  vin_pin = excluded.vin_pin,
  make = excluded.make,
  model = excluded.model,
  year = excluded.year,
  category = excluded.category,
  condition = excluded.condition,
  availability = excluded.availability,
  ownership = excluded.ownership,
  engine_hours = excluded.engine_hours,
  purchase_price = excluded.purchase_price,
  current_market_value = excluded.current_market_value,
  replacement_cost = excluded.replacement_cost,
  notes = excluded.notes,
  photo_urls = excluded.photo_urls,
  purchased_from_qep = excluded.purchased_from_qep,
  purchase_date = excluded.purchase_date,
  metadata = excluded.metadata,
  updated_at = now(),
  deleted_at = null
where public.qrm_equipment.metadata->>'seedBatchId' = 'qb14-realistic-demo-2026-05-20';

-- ── Deal stages and active deals ────────────────────────────────────────────
create temporary table qb14_stage_seed on commit drop as
select *
from (values
  ('b0145700-0000-4000-8000-000000000001'::uuid, 'Discovery', 10, 15::numeric, false, false),
  ('b0145700-0000-4000-8000-000000000002'::uuid, 'Demo Scheduled', 20, 35::numeric, false, false),
  ('b0145700-0000-4000-8000-000000000003'::uuid, 'Quote Working', 30, 60::numeric, false, false),
  ('b0145700-0000-4000-8000-000000000004'::uuid, 'Negotiation', 40, 80::numeric, false, false),
  ('b0145700-0000-4000-8000-000000000005'::uuid, 'Awaiting Decision', 45, 90::numeric, false, false)
) as s(id, name, sort_order, probability, is_closed_won, is_closed_lost);

insert into public.qrm_deal_stages (
  id, workspace_id, name, sort_order, probability, is_closed_won, is_closed_lost
)
select id, 'default', name, sort_order, probability, is_closed_won, is_closed_lost
from qb14_stage_seed
on conflict (workspace_id, name) do nothing;

create temporary table qb14_deal_seed on commit drop as
with ord as (
  select generate_series(1, 20) as i
), shaped as (
  select
    i,
    case
      when i <= 4 then 'Discovery'
      when i <= 8 then 'Demo Scheduled'
      when i <= 13 then 'Quote Working'
      when i <= 18 then 'Negotiation'
      else 'Awaiting Decision'
    end as stage_name,
    (array[
      'Bandit chipper replacement package',
      'Develon excavator fleet add',
      'Yanmar mini-ex rental refresh',
      'ASV storm response CTL package',
      'Barko loader trade cycle',
      'Right-of-way mulcher package',
      'Forestry grinder capacity expansion',
      'Municipal drainage excavator buy',
      'Rental fleet compact track loader refresh',
      'Land clearing startup package'
    ])[((i - 1) % 10) + 1] as base_name
  from ord
)
select
  ('b014d000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
  'default'::text as workspace_id,
  format('%s %s', base_name, lpad(i::text, 2, '0')) as name,
  st.id as stage_id,
  ('b014c001-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as primary_contact_id,
  ('b014c000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as company_id,
  (45000 + (i * 29750))::numeric(14,2) as amount,
  (current_date + ((14 + i * 4)::text || ' days')::interval)::date as expected_close_on,
  (now() + ((1 + (i % 9))::text || ' days')::interval) as next_follow_up_at,
  (now() - ((i % 7)::text || ' days')::interval) as last_activity_at,
  round(((45000 + (i * 29750)) * (0.145 + ((i % 5) * 0.012)))::numeric, 2) as margin_amount,
  round((14.5 + ((i % 5) * 1.2))::numeric, 3) as margin_pct,
  i * 10 as sort_position,
  jsonb_build_object(
    'seedBatchId', 'qb14-realistic-demo-2026-05-20',
    'seedSource', 'qb14_demo_seed',
    'liveImport', false,
    'provenance', 'deterministic_demo_seed',
    'externalDependency', null,
    'seedOrdinal', i,
    'dealScenario', stage_name
  ) as metadata
from shaped s
join public.qrm_deal_stages st
  on st.workspace_id = 'default' and st.name = s.stage_name;

insert into public.qrm_deals (
  id, workspace_id, name, stage_id, primary_contact_id, company_id, amount,
  expected_close_on, next_follow_up_at, last_activity_at, margin_amount,
  margin_pct, sort_position, closed_at, deleted_at, metadata
)
select
  id, workspace_id, name, stage_id, primary_contact_id, company_id, amount,
  expected_close_on, next_follow_up_at, last_activity_at, margin_amount,
  margin_pct, sort_position, null::timestamptz, null::timestamptz, metadata
from qb14_deal_seed
on conflict (id) do update set
  workspace_id = excluded.workspace_id,
  name = excluded.name,
  stage_id = excluded.stage_id,
  primary_contact_id = excluded.primary_contact_id,
  company_id = excluded.company_id,
  amount = excluded.amount,
  expected_close_on = excluded.expected_close_on,
  next_follow_up_at = excluded.next_follow_up_at,
  last_activity_at = excluded.last_activity_at,
  margin_amount = excluded.margin_amount,
  margin_pct = excluded.margin_pct,
  sort_position = excluded.sort_position,
  closed_at = null,
  deleted_at = null,
  metadata = excluded.metadata,
  updated_at = now()
where public.qrm_deals.metadata->>'seedBatchId' = 'qb14-realistic-demo-2026-05-20';

-- ── Activities ───────────────────────────────────────────────────────────────
create temporary table qb14_activity_seed on commit drop as
with ord as (
  select generate_series(1, 80) as i
)
select
  ('b014a000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
  'default'::text as workspace_id,
  (array['call','meeting','note','email','task','sms'])[((i - 1) % 6) + 1]::public.crm_activity_type as activity_type,
  case
    when i <= 20 then format('QB-14 deal touchpoint %s: next-step alignment and quote readiness captured.', i)
    else format('QB-14 company warmth signal %s: field conversation recorded for customer search demos.', i - 20)
  end as body,
  now() - ((i % 18)::text || ' days')::interval as occurred_at,
  case when i <= 20 then ('b014d000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid else null::uuid end as deal_id,
  case when i > 20 then ('b014c000-0000-4000-8000-' || lpad((i - 20)::text, 12, '0'))::uuid else null::uuid end as company_id,
  jsonb_build_object(
    'seedBatchId', 'qb14-realistic-demo-2026-05-20',
    'seedSource', 'qb14_demo_seed',
    'liveImport', false,
    'provenance', 'deterministic_demo_seed',
    'externalDependency', null,
    'seedOrdinal', i,
    'activitySurface', case when i <= 20 then 'deal_signal' else 'company_warmth' end
  ) as metadata
from ord;

insert into public.qrm_activities (
  id, workspace_id, activity_type, body, occurred_at, deal_id, company_id,
  metadata
)
select
  id, workspace_id, activity_type, body, occurred_at, deal_id, company_id,
  metadata
from qb14_activity_seed
on conflict (id) do update set
  workspace_id = excluded.workspace_id,
  activity_type = excluded.activity_type,
  body = excluded.body,
  occurred_at = excluded.occurred_at,
  deal_id = excluded.deal_id,
  company_id = excluded.company_id,
  contact_id = null,
  metadata = excluded.metadata,
  updated_at = now(),
  deleted_at = null
where public.qrm_activities.metadata->>'seedBatchId' = 'qb14-realistic-demo-2026-05-20';
