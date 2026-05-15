# Track B — Migrations 560–564 sequencing + verification

**GitHub:** [lewis4x4/qep#40](https://github.com/lewis4x4/qep/issues/40)  
**Related epics:** [track-a-eight-epics.md](./track-a-eight-epics.md) (row 2).

This slice is the **schema + contract** foundation for cost visibility, PDI history, freight split, rebate stack tagging, and `part` line kinds. Downstream migrations (565+, 569, 574) extend behavior; this doc focuses on **560–564** and how to prove they are applied and wired.

---

## 1. Canonical migration order (repo)

| # | File | What it does |
|---|------|----------------|
| 560 | `560_quote_line_cost_visibility.sql` | `quote_package_line_items.cost_visibility` (`internal` \| `customer`) + backfill + index |
| 561 | `561_pdi_history_rolling_average.sql` | `pdi_actuals` table, `pdi_average_by_model` view, RLS |
| 562 | `562_freight_inbound_outbound_split.sql` | `inbound_freight_amount`, `outbound_delivery_amount` on line items + freight backfill |
| 563 | `563_rebate_stack_kind_tag.sql` | `qb_programs.stack_kind` (`cash_alt` \| `finance_addon` \| `always_on`) |
| 564 | `564_quote_part_line_kind.sql` | Adds enum value `part` to `quote_line_kind` when that type exists |

**Do not reorder** these files; `bun run migrations:check` enforces a contiguous sequence with no duplicate numbers.

**Later companions (not Track B core but required for full prod behavior):**

- **569** — `quote_package_line_items_line_type_check` includes `'part'` for persisted rows (wizard Step 3 parts).
- **574** — `pdi_average_by_model` set to `security_invoker = true` so caller RLS applies through the view.

---

## 2. Apply / rollout

1. Link CLI to the target project (`supabase link`) if needed.
2. `supabase db push` (or your governed pipeline) so **560 → 577** (or current head) applies in order on staging, then production.
3. **PDI history (561):** optional backfill from IntelliDealer staging tables:
   - `bun run intellidealer:pdi:actuals` (dry run / preview)
   - `bun run intellidealer:pdi:actuals -- --commit` when ready (requires service role; see `scripts/intellidealer-pdi-actuals.mjs`).
4. **Regenerate TS types** after the remote schema matches migrations:
   - `bun run supabase:types:remote`  
   - Confirms `Database["public"]["Tables"]["quote_package_line_items"]["Row"]` includes `cost_visibility`, `inbound_freight_amount`, `outbound_delivery_amount`, etc.

---

## 3. Automated verification (local)

```bash
bun run verify:track-b-560-564
```

This runs, in order:

1. `migrations:check` — filename sequence and no gaps through max migration number.
2. `audit:rls-initplan` — post-baseline migrations avoid known `initplan` RLS performance footguns (Track B DoD alignment).
3. `quote-api` unit tests — freight direction → `cost_visibility` + inbound/outbound amount columns on save payload.
4. `quote-incentive-resolver` Deno tests — `stack_kind` grouping (`cash_alt` vs `finance_addon`).

For a broader gate after touching migrations or edges, use `bun run segment:gates --segment "<id>"` per `AGENTS.md`.

---

## 4. Manual / staging checks

| Area | Check |
|------|--------|
| **560** | Open a package in DB: PDI and good-faith lines `cost_visibility = internal`; customer freight `customer`. |
| **561** | `select * from pdi_average_by_model limit 5` as a workspace user — rows only for `get_my_workspace()`. |
| **562** | Create inbound + outbound freight lines in wizard; confirm both amount columns populated and PDF/proposal filters respect visibility (see Epic #41). |
| **563** | Programs with `stack_kind` set; resolver + `IncentiveStack.tsx` labels. |
| **564 + 569** | Add a part line on Step 3; save succeeds without check constraint violation. |

---

## 5. Definition of done (Track B)

- [ ] Migrations **560–564** applied on target DBs in order; no initplan/RLS regressions from `bun run audit:rls-initplan`.
- [ ] `bun run verify:track-b-560-564` green.
- [ ] `apps/web/src/lib/database.types.ts` regenerated from the same schema revision (`supabase:types:remote` or `--local`).
- [ ] #40 updated with environment + date when staging/prod push completed.
