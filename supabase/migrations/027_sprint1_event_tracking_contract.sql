-- Sprint 1 event tracking contract alignment (QUA-238)
-- Add required web event names for activity_log instrumentation.

alter type public.activity_type add value if not exists 'admin_integrations_viewed';
alter type public.activity_type add value if not exists 'integration_card_opened';
alter type public.activity_type add value if not exists 'integration_credentials_saved';
alter type public.activity_type add value if not exists 'integration_credentials_save_failed';
alter type public.activity_type add value if not exists 'integration_test_connection_clicked';
alter type public.activity_type add value if not exists 'integration_badge_rendered';

-- Rollback note:
-- PostgreSQL enums do not support dropping values in-place. To rollback, create
-- a replacement enum without these values and cast dependent columns manually.
