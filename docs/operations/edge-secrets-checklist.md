# Edge function secrets (operator checklist)

Source of truth for names and purpose: `supabase/functions/secrets.example.env`.

Before promoting a build or debugging integration failures:

1. Compare each key in `secrets.example.env` against the Supabase project **Edge Functions → Secrets** dashboard.
2. Confirm demo/admin and cron paths use the same names as in `secrets.example.env` (`DEMO_ADMIN_SECRET`, `CRON_SECRET`, etc.) so local and deployed behavior match.
3. After rotating a secret, redeploy affected functions and run `bun run smoke:edge` (or your smoke suite) against the target project.

No secrets belong in frontend code or committed `.env` files.
