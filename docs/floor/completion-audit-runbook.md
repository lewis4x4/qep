# The Floor Completion Audit Runbook

Purpose: rerun the strict completion audit with repeatable evidence after each Floor completion slice.

## Required Local Commands

Run from `/Users/brianlewis/Projects/qep-knowledge-assistant`.

```bash
bun run --filter @qep/web typecheck
bun run build
bun run migrations:check
bun run floor:validate-layouts
bun run segment:gates --segment floor-completion --ui
```

Expected PASS evidence:
- `@qep/web typecheck: Exited with code 0`
- root `bun run build` exits 0 after migration order, Floor layout validation, RLS initplan audit, edge auth audit, and web production build
- `bun run floor:validate-layouts` prints JSON with `"verdict": "PASS"`
- `segment:gates` writes a JSON report under `test-results/agent-gates/` with `"verdict": "PASS"`
- CDO artifacts exist:
  - `test-results/design-review/floor-desktop.png`
  - `test-results/design-review/floor-mobile.png`

## Required Production Commands

Production verification needs:
- `NETLIFY_AUTH_TOKEN`
- `SUPABASE_ACCESS_TOKEN` or an authenticated Supabase CLI session
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `FLOOR_AUDIT_EMAIL`
- `FLOOR_AUDIT_PASSWORD`

```bash
bun run floor:verify-production
```

Expected PASS evidence:
- latest Netlify deploy state is `ready`
- latest Netlify `commit_ref` equals local `git rev-parse HEAD`
- Supabase migration list includes the latest local migration version
- Supabase functions list includes `floor-narrative`
- production `/floor` desktop and mobile screenshots are written under `test-results/floor-production-audit/`

## Audit Guardrails

- Do not claim final commission logic complete until `docs/floor/signoffs/QA-R2-commission-rules.md` has a signed decision record.
- Do not claim final lost-sales/supplier-health logic complete until `docs/floor/signoffs/QA-N1-parts-workshop.md` has a signed decision record.
- If either sign-off is unsigned, Phase 3 must be reported as blocked or incomplete, not passed.
- Stubs, "Preview" chips, or fallback-only cards are failures for production role layouts unless the widget explicitly labels itself as proxy/source data.
