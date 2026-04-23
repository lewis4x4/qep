# The Floor Rollout Runbook

Purpose: move QEP operators from the dense admin dashboard to `/floor` without losing admin escape hatches or auditability.

## Preconditions

- Ryan QA-R1 visual sign-off recorded.
- `bun run floor:validate-layouts` passes.
- `bun run floor:verify-production` passes after deploy.
- `floor-narrative` is deployed and listed in Supabase functions.
- `docs/floor/signoffs/QA-R2-commission-rules.md` is signed before commission math is treated as final.
- `docs/floor/signoffs/QA-N1-parts-workshop.md` is signed before lost-sales reason-code and supplier-health depth are treated as final.

## Rollout Steps

1. Confirm production deploy:
   ```bash
   bun run floor:verify-production
   ```
2. Confirm no active Sentry errors for `/floor`, `/floor/compose`, or `/quote-v2`.
3. Flip one pilot profile:
   ```sql
   update public.profiles
   set floor_mode = true
   where email = '<pilot email>';
   ```
4. Ask the pilot to log in and confirm they land on `/floor`.
5. Confirm Back-to-Floor chip appears after clicking into an admin route.
6. Roll out by role:
   ```sql
   update public.profiles
   set floor_mode = true
   where iron_role = '<iron_role>'
     and is_active is distinct from false;
   ```
7. Monitor Sentry and usage for 24 hours before the next role.

## Rollback

Disable Floor mode without changing layouts:

```sql
update public.profiles
set floor_mode = false
where email = '<user email>';
```

Role-wide rollback:

```sql
update public.profiles
set floor_mode = false
where iron_role = '<iron_role>';
```

## Multi-Branch Workspace Seeds

Current policy: Lake City and Ocala remain in the same `default` workspace until Brian explicitly chooses branch-specific workspaces.

If a branch workspace is introduced, copy the role defaults without changing schema:

```bash
bun run floor:seed-layouts -- --workspace lake-city --source default
bun run floor:seed-layouts -- --workspace ocala --source default
```

Then run:

```bash
bun run floor:validate-layouts
```

## Monitoring

- Sentry transactions:
  - `/floor`
  - `/floor/compose`
  - `/quote-v2`
- Supabase tables:
  - `floor_layouts`
  - `floor_layout_audit`
  - `floor_narratives`
- Adoption target:
  - `/floor` daily active users exceed `/dashboard` daily active users for users with `floor_mode=true`.

## Riley/Rylee Cleanup

Before team-wide rollout, resolve `riley@qepusa.com` so the misspelled duplicate cannot receive Floor mode by accident.

Recommended default:

```sql
update public.profiles
set is_active = false
where email = 'riley@qepusa.com';
```

Hard-delete only after Brian confirms there is no auth, audit, or historical dependency on that profile.
