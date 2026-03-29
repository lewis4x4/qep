-- BLOCKER-QA140-06: Cross-tenant RLS test fixture
-- Creates a second test user so QA can verify RLS policies block cross-tenant queries.
--
-- Test user:
--   email: qa-tenant-b@test.qep.local
--   password: QepTestTenantB!2026
--   role: rep
--
-- This user should NOT see data owned by the primary test user.
-- QA can obtain a JWT by calling supabase.auth.signInWithPassword().

-- Use a deterministic UUID so re-running this migration is idempotent.
do $$
declare
  v_user_id uuid := 'a0000000-0000-0000-0000-000000000002';
begin
  -- Only insert if the test user doesn't already exist
  if not exists (select 1 from auth.users where id = v_user_id) then
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'qa-tenant-b@test.qep.local',
      extensions.crypt('QepTestTenantB!2026', extensions.gen_salt('bf')),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"full_name": "QA Tenant B"}'::jsonb,
      now(),
      now(),
      '',
      ''
    );

    -- Also add to auth.identities (required by Supabase GoTrue v2)
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', 'qa-tenant-b@test.qep.local'),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  -- Ensure profile exists (handle_new_user trigger may have created it,
  -- but insert idempotently just in case)
  insert into public.profiles (id, full_name, email, role)
  values (v_user_id, 'QA Tenant B', 'qa-tenant-b@test.qep.local', 'rep')
  on conflict (id) do nothing;
end;
$$;
