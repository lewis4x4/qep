<!--
PR template for QEP OS.

The line `Roadmap: <task_id>` is REQUIRED on any PR that lands work tracked in
qep_roadmap_tasks. Multiple task IDs may be comma-separated. The roadmap →
Linear sync uses this line to post a "PR landed" comment on the matching
Linear issue.

Examples:
  Roadmap: A1.1
  Roadmap: A5.6, B2.2
-->

## Summary

<!-- One paragraph: what this PR does and why. -->

## Roadmap

Roadmap: <!-- e.g. A1.1 -->

## Type

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Docs / cleanup
- [ ] Compliance / safety-critical

## Test plan

<!-- How you verified this works. CI must be green. -->

## Risk / rollback

<!-- Migration, RLS, env vars, secrets, data backfill? How would you revert? -->

## Reviewer notes

<!-- Anything specific to call out for review. -->

---

**Note on status changes:** Merging this PR will post a comment on the linked
Linear issue but will NOT change its ship_state. Flip ship_state in the QEP
roadmap UI (or via `npm run task A1.1 -- --ship`). Supabase is source of truth.
