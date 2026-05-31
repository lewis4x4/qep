-- ============================================================================
-- Migration 630: Add service department roles to user_role
--
-- Keep enum additions isolated: PostgreSQL forbids using newly added enum
-- values in the same transaction that adds them, and Supabase wraps each
-- migration file in a transaction.
-- ============================================================================

alter type public.user_role add value if not exists 'service_writer';
alter type public.user_role add value if not exists 'technician';
alter type public.user_role add value if not exists 'parts_counter';
alter type public.user_role add value if not exists 'dispatch';
alter type public.user_role add value if not exists 'finance_admin';
