-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 207 — Deal Signal Bridge (Phase 0 P0.2)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Creates a unified `deal_signals` view that exposes per-deal signals from
-- four source tables under a single (deal_id, signal_type, ...) projection.
-- Replaces the five parallel PostgREST queries the Slice 1 qrm-command-center
-- edge function does today with a single read against this view.
--
-- ── Source coverage ─────────────────────────────────────────────────────────
--
-- This view unifies FOUR signal sources (not five — see DEFERRED note below):
--
--   1. anomaly_alerts          — polymorphic via (entity_type='deal', entity_id)
--   2. voice_captures          — direct FK on linked_deal_id (migration 056)
--   3. deposits                — direct FK on deal_id (migration 070)
--   4. competitive_mentions    — two-hop FK via voice_captures.linked_deal_id
--                                (uuid → uuid bridge, no text matching)
--
-- ── DEFERRED: deal_timing_alerts ────────────────────────────────────────────
--
-- Phase 0 Day 2 verification confirmed that `deal_timing_alerts` (migration 146)
-- has NO direct FK to crm_deals. Its `customer_profile_id` references
-- `customer_profiles_extended`, which itself has no `crm_company_id`,
-- `crm_contact_id`, or `crm_deal_id` column. The only join surfaces from
-- customer_profiles_extended are `hubspot_contact_id` (text), `customer_name`
-- (text), and `intellidealer_customer_id` (text). The honest path to a
-- crm_deals row is therefore a THREE-HOP TEXT MATCH:
--
--   deal_timing_alerts.customer_profile_id
--     → customer_profiles_extended.hubspot_contact_id
--     → crm_contacts.hubspot_contact_id (TEXT MATCH)
--     → crm_deals.primary_contact_id
--
-- This bridge is fragile (NULL for any deal not synced from HubSpot, requires
-- both sides to carry HubSpot identity, breaks on stale data) and not
-- representative of v1 priorities. Slice 1's edge function does not query
-- deal_timing_alerts at all today, so deferring it from this view does NOT
-- regress any existing functionality.
--
-- TODO(phase-2-or-later): bring deal_timing_alerts into the bridge once one
-- of the following lands:
--   (a) deal_timing_alerts gains a direct deal_id column
--   (b) customer_profiles_extended gains a uuid FK to crm_companies / crm_deals
--   (c) a separate `customer_profile_to_deal` mapping table is introduced
--
-- ── View shape ──────────────────────────────────────────────────────────────
--
-- Each row of `deal_signals` projects to:
--
--   deal_id            uuid    — the crm_deals.id this signal attaches to
--   signal_source      text    — 'anomaly' | 'voice' | 'deposit' | 'competitor'
--   signal_subtype     text    — source-specific subtype:
--                                  anomaly:    alert_type ('stalling_deal', etc.)
--                                  voice:      sentiment ('positive'|'neutral'|'negative')
--                                  deposit:    status ('pending'|'requested'|'received')
--                                  competitor: competitor_name
--   severity           text    — 'low' | 'medium' | 'high' | 'critical' | NULL
--   payload            jsonb   — source-specific structured payload (full row data
--                                relevant to the ranker, projected per source)
--   observed_at        timestamptz — when the signal was generated/captured
--   source_record_id   uuid    — the underlying row id (for trace + dedupe)
--
-- The Slice 1 ranker reads:
--   anomaly:    alert_type, severity        → bundle.anomalyTypes, anomalySeverity
--   voice:      sentiment, competitor_mentions → bundle.recentVoiceSentiment,
--                                                bundle.competitorMentioned
--   deposit:    status='pending'|'requested'|'received' → bundle.hasPendingDeposit
--   competitor: presence                    → bundle.competitorMentioned (alt path)
--
-- All of these are recoverable from the (signal_source, signal_subtype, payload)
-- triple via the TS adapter at supabase/functions/_shared/qrm-command-center/
-- signal-bridge.ts.
--
-- ── RLS strategy ────────────────────────────────────────────────────────────
--
-- The view is created with `security_invoker = true` so it inherits the RLS
-- policies of each source table. No new policies are added by this migration.
-- A caller using the view sees exactly the same rows they would see if they
-- queried each source table directly. The four source tables already enforce
-- workspace + role boundaries:
--
--   - anomaly_alerts:     migration 057 (4 policies)
--   - voice_captures:     migration 003 + 056 (4 policies)
--   - deposits:           migration 070 (5 policies)
--   - competitive_mentions: migration 056 (2 policies)
--
-- ── Indexes ─────────────────────────────────────────────────────────────────
--
-- Views cannot have indexes. The view's performance depends on indexes on the
-- underlying source tables, which already exist:
--   anomaly_alerts:       idx_anomaly_alerts_entity (entity_type, entity_id)
--   voice_captures:       idx_voice_captures_linked_deal (linked_deal_id)
--   deposits:             idx_deposits_deal (deal_id)
--   competitive_mentions: idx_competitive_mentions_capture (voice_capture_id)
--
-- A future materialized view at the same shape is the obvious next step if
-- view performance becomes a problem at scale. For Phase 0, a plain view is
-- sufficient.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.deal_signals
  with (security_invoker = true)
as
  -- ── Source 1: anomaly_alerts (polymorphic deal entity) ─────────────────
  select
    aa.entity_id::uuid                  as deal_id,
    'anomaly'::text                     as signal_source,
    aa.alert_type::text                 as signal_subtype,
    aa.severity::text                   as severity,
    jsonb_build_object(
      'alert_type', aa.alert_type,
      'severity', aa.severity,
      'title', aa.title,
      'description', aa.description,
      'acknowledged', aa.acknowledged
    )                                   as payload,
    aa.created_at                       as observed_at,
    aa.id                               as source_record_id
  from public.anomaly_alerts aa
  where aa.entity_type = 'deal'
    and aa.entity_id is not null
    and aa.acknowledged = false

  union all

  -- ── Source 2: voice_captures (direct FK on linked_deal_id) ─────────────
  select
    vc.linked_deal_id                   as deal_id,
    'voice'::text                       as signal_source,
    vc.sentiment::text                  as signal_subtype,
    null::text                          as severity,
    jsonb_build_object(
      'sentiment', vc.sentiment,
      'manager_attention', vc.manager_attention,
      'competitor_mentions', vc.competitor_mentions,
      'transcript_excerpt', left(coalesce(vc.transcript, ''), 200)
    )                                   as payload,
    vc.created_at                       as observed_at,
    vc.id                               as source_record_id
  from public.voice_captures vc
  where vc.linked_deal_id is not null

  union all

  -- ── Source 3: deposits (direct FK on deal_id) ──────────────────────────
  -- Slice 1 only consumes deposits in pending/requested/received status as
  -- a "blocked-by-deposit" signal. We carry every status here so future
  -- surfaces (e.g. Approval Center, Revenue Reality Board) can read more
  -- granular states without a schema change.
  select
    dp.deal_id                          as deal_id,
    'deposit'::text                     as signal_source,
    dp.status::text                     as signal_subtype,
    case
      when dp.status in ('pending', 'requested') then 'high'
      when dp.status = 'received' then 'medium'
      else 'low'
    end::text                           as severity,
    jsonb_build_object(
      'status', dp.status,
      'deposit_tier', dp.deposit_tier,
      'required_amount', dp.required_amount,
      'equipment_value', dp.equipment_value,
      'received_at', dp.received_at,
      'verified_at', dp.verified_at
    )                                   as payload,
    coalesce(dp.received_at, dp.created_at) as observed_at,
    dp.id                               as source_record_id
  from public.deposits dp
  where dp.deal_id is not null

  union all

  -- ── Source 4: competitive_mentions (two-hop via voice_captures) ────────
  select
    vc.linked_deal_id                   as deal_id,
    'competitor'::text                  as signal_source,
    cm.competitor_name::text            as signal_subtype,
    case
      when cm.sentiment = 'negative' then 'high'
      when cm.sentiment = 'neutral' then 'medium'
      else 'low'
    end::text                           as severity,
    jsonb_build_object(
      'competitor_name', cm.competitor_name,
      'context', cm.context,
      'sentiment', cm.sentiment,
      'voice_capture_id', cm.voice_capture_id
    )                                   as payload,
    cm.created_at                       as observed_at,
    cm.id                               as source_record_id
  from public.competitive_mentions cm
  inner join public.voice_captures vc
    on vc.id = cm.voice_capture_id
  where vc.linked_deal_id is not null;

comment on view public.deal_signals is
  'Phase 0 P0.2 — Unified deal-signal bridge. Projects four signal sources '
  '(anomaly_alerts, voice_captures, deposits, competitive_mentions) into a '
  'single (deal_id, signal_source, signal_subtype, severity, payload, observed_at, '
  'source_record_id) shape. RLS via security_invoker — inherits source policies. '
  'deal_timing_alerts deferred (no direct FK; only fragile three-hop text-match '
  'available). See migration 207 header for full deferral rationale.';
