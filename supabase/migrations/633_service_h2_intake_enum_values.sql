-- ============================================================================
-- Migration 633: H2 service intake enum values
--
-- Keep enum additions isolated: PostgreSQL forbids using newly added enum
-- values in the same transaction that adds them, and Supabase wraps each
-- migration file in a transaction.
-- ============================================================================

-- H2 seven work-order type coverage: repair, PM, warranty, field service,
-- internal, comeback/rework, and hauling/transport. Existing values remain for
-- backward compatibility.
alter type public.service_request_type add value if not exists 'field_service';
alter type public.service_request_type add value if not exists 'internal';
alter type public.service_request_type add value if not exists 'comeback_rework';
alter type public.service_request_type add value if not exists 'hauling_transport';

-- H2 intake channels: phone/call, walk-in/drop-off, field request, and internal
-- request. Existing call/walk_in/field_tech values remain valid aliases.
alter type public.service_source_type add value if not exists 'drop_off';
alter type public.service_source_type add value if not exists 'field_request';
alter type public.service_source_type add value if not exists 'internal_request';

-- H2 priority vocabulary: emergency/down, high, normal. Existing urgent/critical
-- values remain for compatibility with older jobs and UI surfaces.
alter type public.service_priority add value if not exists 'high';
alter type public.service_priority add value if not exists 'emergency';
