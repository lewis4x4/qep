# Knowledge Base Operations

This runbook keeps the QEP knowledge base disciplined as the corpus, roles, and workspaces expand.

## Daily / Weekly Cadence

### Daily

1. Review `Administration -> KB Health`.
2. Confirm the latest `embed-crm` run succeeded.
3. Check unresolved knowledge gaps and decide whether each gap should be solved by:
   - a new published document
   - CRM data hygiene
   - a service knowledge note
   - a verified service knowledge base entry

### Weekly

1. Run `bun run kb:eval`.
2. Review `test-results/kb-eval/latest.json` and compare with `bun run kb:eval:report`.
3. Run `bun run kb:workspace-isolation` if you changed auth, RLS, workspace scoping, or retrieval SQL.
4. Triage anomaly alerts for:
   - `embedding_stale`
   - `orphan_chunks`
5. Review overdue document refresh items and republish or archive as needed.

## Adding A New Knowledge Source

### Documents

1. Upload through `Administration -> Knowledge Base`.
2. Set the correct audience and publish status.
3. Assign a review owner when the document requires a domain steward.
4. Re-run `bun run kb:eval` if the new source is intended to answer an existing gap.

### Service Notes

1. Capture service learnings through `service-knowledge-capture`.
2. Prefer machine-specific or fault-specific notes over vague free text.
3. If the note is a repeatable fix, promote it into `service_knowledge_base` after verification.

### CRM Data

1. Ensure the source records are workspace-scoped and updated cleanly.
2. Trigger `embed-crm` or `kb-maintenance` re-embedding if the source changed materially.

## Re-Embedding / Backfill

### Re-embed documents and service notes

```bash
curl -X POST "$SUPABASE_URL/functions/v1/kb-maintenance" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"re-embed-documents"}'
```

### Force full CRM re-embed

```bash
curl -X POST "$SUPABASE_URL/functions/v1/kb-maintenance" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"re-embed-crm"}'
```

### Validate vector dimensions

```bash
curl -X POST "$SUPABASE_URL/functions/v1/kb-maintenance" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"validate-dimensions"}'
```

## Incident Playbook

### Symptom: chat answers feel stale

1. Open `KB Health` and inspect the latest embed run.
2. Check anomaly alerts for `embedding_stale`.
3. Run `validate-dimensions`.
4. Force `re-embed-crm` if CRM content changed.
5. Force `re-embed-documents` if documents or service notes changed.

### Symptom: reps can see restricted content

1. Run the live Deno integration tests with rep and admin tokens.
2. Run `bun run kb:workspace-isolation`.
3. Inspect the latest retrieval event and source list for the trace.
4. Review `retrieve_document_evidence` changes before redeploying.

### Symptom: documents are not appearing in answers

1. Confirm the document is `published`.
2. Check for `ingest_failed` status.
3. Re-index the document from Admin or via `kb-maintenance`.
4. Re-run `bun run kb:eval`.

## Expansion Checklist

When onboarding a new workspace or major domain:

1. Confirm JWTs include `workspace_id`.
2. Seed at least one published document for the new workspace.
3. Run workspace-isolation checks against both the old and new workspace.
4. Verify `embed-crm` produces embeddings for the new workspace's CRM rows.
5. Establish a review owner for each document domain.
6. Add at least one golden query covering the new domain.
