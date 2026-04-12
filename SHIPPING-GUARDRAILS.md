# QEP Shipping Guardrails

Use this before any future commit/push/deploy lane.

## 1. Start clean
```bash
git fetch origin
git checkout main
git pull --rebase origin main
```

If there is active work, do **not** commit directly from a stale branch.

## 2. Create a ship branch first
```bash
git checkout -b ship/<short-scope>-$(date +%Y%m%d-%H%M)
```

Examples:
- `ship/qrm-quote-compression-20260412-1745`
- `ship/supabase-comm-hub-20260412-1810`

## 3. Before first commit, verify divergence
```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

If they differ, rebase or restart from `origin/main` before continuing.

## 4. Split ship lanes when needed
If web and Supabase/backend both changed, prefer:
- commit/push backend lane first
- deploy backend
- then merge web lane

Do not force one giant commit when upstream moved.

## 5. Before push
```bash
git fetch origin
git rebase origin/main
```

Then run validation for the lane.

## 6. Push safely
```bash
git push origin HEAD:main
```

Only push after:
- remote is current
- tests/builds are green
- migration numbering is sane
- Supabase project link is correct

## 7. Supabase deploy checks
Always confirm:
- `supabase/.temp/project-ref` matches live project
- `supabase/config.toml` local `project_id` is expected
- new migrations do not reuse already-taken numeric prefixes
- post-rename migrations target `qrm_*` base tables, not `crm_*` compat views, for `ALTER TABLE` and `CREATE POLICY`

## 8. If push is rejected
Do not keep committing blindly.

Instead:
1. preserve current commit on a backup branch
2. reset/restart from `origin/main`
3. reapply the lane in smaller slices
4. validate again

## 9. Treat tool-generated lockfile drift as suspicious
If only local tooling changed `deno.lock` or similar during deploy/test steps, inspect it before committing. Revert incidental drift unless it is part of the intended ship.
