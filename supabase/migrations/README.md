# Migration Ordering Contract

This directory uses a canonical, contiguous migration sequence.

## Filename rules

- Pattern: `NNN_snake_case_name.sql`
- `NNN` is a 3-digit number.
- Sequence is contiguous from `001` with no gaps and no duplicates.
- Existing migration numbers are immutable once merged.

## Operational rules

- Never renumber existing migrations after they are shared.
- Additive migrations only for corrective changes.
- If a migration has to be replaced before merge, keep exactly one file per number.
- Run `bun run migrations:check` before opening a PR.

## Current canonical head

- As of this baseline, canonical sequence is `001..031`.
