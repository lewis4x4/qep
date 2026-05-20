import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("quote save persists server-computed financial metrics, not request totals", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function computeQuoteFinancials("));
  assert(source.includes("const financials = provisionalArtifacts.computedMetrics"));
  for (const forbidden of [
    "equipment_total: body.equipment_total || 0",
    "attachment_total: body.attachment_total || 0",
    "subtotal: body.subtotal || 0",
    "discount_total: body.discount_total || 0",
    "net_total: body.net_total || 0",
    "amount_financed: body.amount_financed || 0",
    "margin_amount: body.margin_amount",
    "margin_pct: body.margin_pct",
  ]) {
    assertEquals(source.includes(forbidden), false, forbidden);
  }
});

Deno.test("quote version snapshots use computed financial metrics for approval routing", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const artifactsIndex = source.indexOf("function buildQuoteVersionArtifacts(");
  const financialsIndex = source.indexOf("const financials = computeQuoteFinancials(input.body)", artifactsIndex);
  const marginIndex = source.indexOf("marginPct: financials.margin_pct", financialsIndex);
  const amountIndex = source.indexOf("amount: financials.net_total", financialsIndex);
  assert(artifactsIndex > -1);
  assert(financialsIndex > artifactsIndex);
  assert(marginIndex > financialsIndex);
  assert(amountIndex > financialsIndex);
});

Deno.test("equipment override persists as equipment_override_price_cents column", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function resolveEquipmentOverridePriceCents("));
  assert(source.includes("equipment_override_price_cents: equipmentOverridePriceCents"));
  assert(source.includes("delete persistedMetadata.equipment_override_price"));
});

Deno.test("legacy misc credit rows are normalized before server financial totals", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function isMiscCreditLine("));
  assert(source.includes('lineString(metadata.misc_line_kind, 40) === "credit"'));
  assert(source.includes('|| isMiscCreditLine(line)'));
});

Deno.test("submit-approval loads subtotal and discount_total for bypass max_discount_pct gate", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    source.includes(
      "net_total, margin_pct, subtotal, discount_total, status",
    ),
    "submit-approval quote_packages select must include subtotal and discount_total",
  );
  assert(
    source.includes(
      'select("id, rule_name, min_stock_age_days, requires_in_stock, requires_hot_list, min_margin_pct, max_discount_pct, bypass_to_status, active")',
    ),
    "bypass rules select must include max_discount_pct and bypass_to_status",
  );
  assert(
    source.includes("discountTotal: pkgRow.discount_total"),
    "resolveApprovalBypassRule must receive discount_total from package row",
  );
  assert(
    source.includes("const discountPct = (disc / sub) * 100"),
    "bypass must compare discount dollars to subtotal as a percentage",
  );
});

Deno.test("approval bypass resolver ORs hot list metadata aliases on primary equipment", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    source.includes("boolMetadata((metadata as Record<string, unknown>).hot_list)"),
    "bypass must read metadata.hot_list",
  );
  assert(
    source.includes("boolMetadata((metadata as Record<string, unknown>).on_hot_list)"),
    "bypass must read metadata.on_hot_list",
  );
  assert(
    source.includes("boolMetadata((metadata as Record<string, unknown>).hotList)"),
    "bypass must read metadata.hotList",
  );
  assert(
    source.includes("if (requiresHotList && !hotList) continue"),
    "bypass must skip rules when hot list is required but not flagged",
  );
});

Deno.test("approval bypass resolver gates stock age from equipment metadata received_at", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function ageDaysFromIso("), "stock age helper must exist");
  assert(
    source.includes("const stockAgeDays = ageDaysFromIso((metadata as Record<string, unknown>).received_at)"),
    "bypass must derive stock age from primary equipment metadata.received_at",
  );
  assert(
    source.includes("min_stock_age_days"),
    "bypass rules must include min_stock_age_days",
  );
  assert(
    source.includes("if (minAge > 0 && (stockAgeDays == null || stockAgeDays < minAge)) continue"),
    "bypass must skip when min stock age is not satisfied",
  );
});

Deno.test("approval bypass resolver treats in_stock flag and availability_status as on-hand", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    source.includes("boolMetadata((metadata as Record<string, unknown>).in_stock)"),
    "bypass must read metadata.in_stock",
  );
  assert(
    source.includes("availability_status") && source.includes('=== "in_stock"'),
    "bypass must treat availability_status in_stock as on-hand",
  );
  assert(
    source.includes("requires_in_stock"),
    "bypass rules must include requires_in_stock",
  );
  assert(
    source.includes("if (requiresInStock && !inStock) continue"),
    "bypass must skip rules when in-stock is required but not indicated",
  );
});

Deno.test("approval bypass resolver enforces min_margin_pct against package margin_pct", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    source.includes("min_margin_pct"),
    "bypass rules must surface min_margin_pct",
  );
  assert(
    source.includes("const marginFloor = Number(rule.min_margin_pct ?? 0)"),
    "bypass must read min_margin_pct into marginFloor",
  );
  assert(
    source.includes("if (marginFloor > 0 && (input.marginPct == null || input.marginPct < marginFloor)) continue"),
    "bypass must skip when margin is below the rule floor",
  );
  assert(
    source.includes("marginPct: pkgRow.margin_pct"),
    "submit-approval must pass persisted margin_pct into bypass resolver",
  );
});

Deno.test("approval bypass stamps quote status from sanitized bypass_to_status", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    source.includes("function sanitizeBypassTargetQuoteStatus("),
    "bypass must sanitize rule bypass_to_status before DB write",
  );
  assert(
    source.includes("targetQuoteStatus: sanitizeBypassTargetQuoteStatus(rule.bypass_to_status)"),
    "matched bypass rule must carry targetQuoteStatus from rule row",
  );
  assert(
    source.includes(".update({ status: bypassRule.targetQuoteStatus })"),
    "submit-approval bypass path must write sanitized status to quote_packages",
  );
});

Deno.test("send-package requires a fresh generated R2 customer PDF artifact", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes('return safeJsonError("Generate a versioned PDF before sending.", 409, origin);'));
  assert(source.includes('artifactRow.storage_provider !== "r2"'));
  assert(source.includes('artifactRow.status !== "generated"'));
  assert(source.includes("artifactRow.customer_visible_at != null"));
  assert(source.includes("artifactRow.quote_package_version_id !== activeQuoteVersion.id"));
  assert(source.includes("Quote changed after PDF generation. Regenerate the send PDF and try again."));
});

Deno.test("PDF artifact upload and version endpoints are R2-backed and diff snapshots server-side", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes('action === "begin-upload" && url.pathname.includes("/document-artifacts/")'));
  assert(source.includes('action === "complete-upload" && url.pathname.includes("/document-artifacts/")'));
  assert(source.includes('action === "document-versions"'));
  assert(source.includes('action === "diff" && url.pathname.includes("/document-versions/")'));
  assert(source.includes("quote_begin_customer_pdf_version"));
  assert(source.includes("createR2PutUrl"));
  assert(source.includes("headR2Object"));
  assert(source.includes("diffQuotePdfVersionSnapshots"));
});

Deno.test("public latest PDF resolver redirects to latest sent immutable R2 version", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes('publicAction === "latest-quote-pdf"'));
  assert(source.includes("handlePublicLatestQuotePdfRead"));
  assert(source.includes('return safeJsonError("No sent PDF version is available yet.", 404, origin);'));
  assert(source.includes('.order("version_number", { ascending: false })'));
  assert(source.includes("createR2GetUrl"));
  assert(source.includes("status: 302"));
});

Deno.test("migration exposes immutable PDF version metadata and commit visibility update", async () => {
  const migration = await Deno.readTextFile(new URL("../../migrations/599_quote_pdf_r2_versions.sql", import.meta.url));
  assert(migration.includes("add column if not exists storage_provider text not null default 'supabase'"));
  assert(migration.includes("add column if not exists version_number integer"));
  assert(migration.includes("add column if not exists proposal_snapshot_json jsonb"));
  assert(migration.includes("create or replace function public.quote_begin_customer_pdf_version"));
  assert(migration.includes("customer_visible_at = p_sent_at"));
  assert(migration.includes("sent_delivery_event_id = v_id"));
  assert(migration.includes("p_document_artifact_id is null"));
});
