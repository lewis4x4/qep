-- Fix cross-tenant test fixture — v2
-- Root causes identified:
-- 1. instance_id must match the Supabase instance (not all-zeros)
-- 2. identity schema must exactly match what GoTrue expects
-- Strategy: Delete and recreate using values derived from an existing user.

do $$
declare
  v_user_id uuid := 'a0000000-0000-0000-0000-000000000002';
  v_email text := 'qa-tenant-b@test.qep.local';
  v_instance_id uuid;
  v_existing_identity record;
begin
  -- Get the real instance_id from an existing user
  select instance_id into v_instance_id
  from auth.users
  where instance_id != '00000000-0000-0000-0000-000000000000'::uuid
  limit 1;

  -- Fallback: if all users have zero instance_id, use zero
  if v_instance_id is null then
    select instance_id into v_instance_id from auth.users limit 1;
  end if;

  if v_instance_id is null then
    v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  -- Delete existing fixture data (cascade from auth.users removes identities)
  delete from public.profiles where id = v_user_id;
  delete from auth.identities where user_id = v_user_id;
  delete from auth.users where id = v_user_id;

  -- Recreate user with correct instance_id
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new,
    email_change_token_current, phone_change,
    phone_change_token, reauthentication_token,
    is_sso_user
  ) values (
    v_user_id, v_instance_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt('QepTestTenantB!2026', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', 'QA Tenant B', 'email', v_email, 'email_verified', true),
    now(), now(),
    '', '',  -- confirmation_token, recovery_token
    '', '',  -- email_change, email_change_token_new
    '', '',  -- email_change_token_current, phone_change
    '', '',  -- phone_change_token, reauthentication_token
    false    -- is_sso_user
  );

  -- Create identity matching GoTrue expectations
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id,  -- use same UUID as user id
    v_user_id,
    v_email,    -- provider_id = email for email provider
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  );

  -- Create profile
  insert into public.profiles (id, full_name, email, role)
  values (v_user_id, 'QA Tenant B', v_email, 'rep')
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role;
end;
$$;
