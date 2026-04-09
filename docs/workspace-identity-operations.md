# Workspace Identity Operations

This runbook covers the multi-workspace identity chain introduced by `profiles.active_workspace_id` and hardened by migration `204_workspace_identity_hardening.sql`.

## Source of truth

- `public.profiles.active_workspace_id` is the authoritative workspace for authenticated users.
- `auth.users.raw_app_meta_data.workspace_id` is a propagated copy used for refreshed JWT claims.
- `public.get_my_workspace()` must resolve to the profile row for authenticated callers, even when JWT claims are stale.

## Expected propagation behavior

1. The user switches workspaces through `set_active_workspace(target)`.
2. The profile row updates `active_workspace_id`.
3. The profile trigger updates `auth.users.raw_app_meta_data`.
4. The client refreshes its session and reloads.
5. Subsequent RLS-scoped reads use the new workspace.

## Normal operator experience

- Workspace switches should reload the app once after a successful update.
- If session refresh is slow, the app should still reload and complete the switch.
- The switcher should show a destructive toast when the RPC fails and should not silently stay on the old workspace.

## Monitoring signals

Watch logs for:

- `[workspace] resolver disagreement; using profile.active_workspace_id`
- `[workspace] rpc get_my_workspace failed; using profile.active_workspace_id`
- `[workspace-switcher] switch failed:`

These signals indicate either stale client claims, profile/JWT drift, or transient auth failures.

## Incident triage

If a user reports cross-workspace data leakage or wrong-tenant context:

1. Inspect `profiles.active_workspace_id` for the affected user.
2. Inspect `profile_workspaces` to confirm the user still belongs to that workspace.
3. Inspect `auth.users.raw_app_meta_data.workspace_id` for the same user.
4. Ask the user to refresh or sign out/in once if the profile row is correct but their client still shows stale state.
5. Review edge logs for resolver disagreement warnings.

## Safe remediation

- If `active_workspace_id` is invalid for the current memberships, fix the membership set first, then update the profile row.
- Do not manually trust or patch client-supplied `workspace_id` values in request bodies.
- Prefer `profiles.active_workspace_id` or `get_my_workspace()` over ad hoc workspace derivation.

## Rollout checklist

- `bun run migrations:check`
- `bun run edge:deno-check`
- `bun run test:workspace-web`
- `bun run test:workspace-edge`
- `bun run verify:workspace-identity`
- `bun run build`

## Rollback posture

This feature should be treated as forward-only. If an incident occurs:

- stop rollout of new callers first,
- preserve the profile row and membership data,
- revert edge/frontend consumers only if needed,
- avoid reverting the migration chain unless there is a coordinated database rollback plan.
