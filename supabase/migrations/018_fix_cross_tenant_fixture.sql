-- Fix cross-tenant test fixture from migration 017.
-- Root cause: auth.identities.provider_id must be the user's email (not UUID)
-- for the email provider, and auth.users may need additional columns for
-- GoTrue v2 compatibility.
--
-- This migration fixes the existing record rather than recreating it.

do $$
declare
  v_user_id uuid := 'a0000000-0000-0000-0000-000000000002';
  v_email text := 'qa-tenant-b@test.qep.local';
begin
  -- Fix identities: provider_id must be the email for email provider
  update auth.identities
  set provider_id = v_email,
      identity_data = jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      updated_at = now()
  where user_id = v_user_id
    and provider = 'email';

  -- Ensure auth.users has all fields GoTrue expects
  update auth.users
  set
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb,
    raw_user_meta_data = jsonb_build_object('full_name', 'QA Tenant B', 'email', v_email, 'email_verified', true),
    is_sso_user = false,
    updated_at = now()
  where id = v_user_id;

  -- Ensure profile exists and is active
  update public.profiles
  set role = 'rep',
      full_name = 'QA Tenant B',
      email = v_email,
      updated_at = now()
  where id = v_user_id;
end;
$$;
