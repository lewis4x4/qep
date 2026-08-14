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

Deno.test("OEM reprice approvals never advance or auto-send the customer quote", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const policyGuard = source.indexOf(
    'casePolicySnapshot.approval_kind === "oem_reprice"',
  );
  const noSendBranch = source.indexOf(
    'reason: "oem_reprice_never_auto_send"',
    policyGuard,
  );
  const generalAutoSend = source.indexOf(
    "await tryAutoSendApprovedQuote({",
    noSendBranch,
  );
  assert(policyGuard > -1, "OEM approval cases must be identified explicitly");
  assert(noSendBranch > policyGuard, "OEM approval cases need an explicit no-send result");
  assert(
    generalAutoSend > noSendBranch,
    "the general auto-send call must remain inside the non-OEM branch",
  );
  assert(source.includes("It must not advance the customer quote state"));
});

Deno.test("OEM withdrawal stays tenant-bound, no-status, and retry-aware", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const withdrawStart = source.indexOf('action === "withdraw-approval-case"');
  const withdrawEnd = source.indexOf('action === "approval-policy"', withdrawStart);
  const withdraw = source.slice(withdrawStart, withdrawEnd);
  assert(withdraw.includes("caseWorkspaceId !== userWorkspaceId"));
  assert(withdraw.includes('withdrawPolicy.approval_kind === "oem_reprice"'));
  assert(withdraw.includes("!isOemRepriceWithdrawal"));
  assert(withdraw.includes('.eq("workspace_id", caseWorkspaceId)'));
  assert(withdraw.includes('caseUpdateErr.code === "42501"'));
  assert(withdraw.includes('caseUpdateErr.code === "40001"'));
  assert(withdraw.includes('caseUpdateErr.code === "55000"'));
  assert(
    withdraw.indexOf("!isOemRepriceWithdrawal") <
      withdraw.indexOf('.update({ status: "draft" })'),
    "generic quote status reset must be guarded for OEM withdrawal",
  );
  const decideStart = source.indexOf('action === "decide-approval-case"');
  const decide = source.slice(decideStart);
  assert(decide.includes('caseUpdateErr.code === "42501"'));
  assert(decide.includes('caseUpdateErr.code === "40001"'));
  assert(decide.includes('caseUpdateErr.code === "55000"'));
  assert(decide.includes('typeof caseRow.flow_approval_id === "string"'));
  assert(decide.includes("caseRow.flow_approval_id.length > 0"));
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

Deno.test("approval bypass resolver loads inventory signals from server tables, not line metadata", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    source.includes("async function loadApprovalBypassInventorySignals("),
    "bypass must resolve inventory signals from a dedicated server loader",
  );
  assert(
    source.includes("await loadApprovalBypassInventorySignals({"),
    "resolveApprovalBypassRule must call the server inventory loader",
  );
  assert(
    source.includes('.from("qrm_equipment")'),
    "bypass loader must read qrm_equipment as inventory source of truth",
  );
  assert(
    source.includes('.from("catalog_entries")'),
    "bypass loader must read catalog_entries as inventory source of truth",
  );
  assertEquals(
    source.includes("boolMetadata((metadata as Record<string, unknown>).hot_list)"),
    false,
    "bypass must not trust client line metadata hot_list",
  );
  assertEquals(
    source.includes("(metadata as Record<string, unknown>).availability_status"),
    false,
    "bypass must not trust client line metadata availability_status",
  );
  assertEquals(
    source.includes("ageDaysFromIso((metadata as Record<string, unknown>).received_at)"),
    false,
    "bypass must not trust client line metadata received_at",
  );
});

Deno.test("approval bypass inventory loader derives hot list and stock age from qrm_equipment metadata", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function bypassSignalsFromQrmEquipmentRow("));
  assert(
    source.includes("metadata.received_at"),
    "qrm bypass signals must read received_at from equipment row metadata",
  );
  assert(
    source.includes("boolMetadata(metadata.hot_list)"),
    "qrm bypass signals must read hot_list from equipment row metadata",
  );
  assert(
    source.includes("boolMetadata(metadata.on_hot_list)"),
    "qrm bypass signals must read on_hot_list from equipment row metadata",
  );
});

Deno.test("approval bypass inventory loader derives yard stock age from catalog_entries.acquired_at", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function bypassSignalsFromCatalogEntryRow("));
  assert(
    source.includes("ageDaysFromIso(row.acquired_at)"),
    "catalog bypass signals must derive stock age from acquired_at",
  );
  assert(
    source.includes("row.is_yard_stock === true"),
    "catalog bypass signals must treat yard stock as on-hand",
  );
});

Deno.test("approval bypass resolver gates stock age and in-stock requirements", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function ageDaysFromIso("), "stock age helper must exist");
  assert(
    source.includes("min_stock_age_days"),
    "bypass rules must include min_stock_age_days",
  );
  assert(
    source.includes("if (minAge > 0 && (stockAgeDays == null || stockAgeDays < minAge)) continue"),
    "bypass must skip when min stock age is not satisfied",
  );
  assert(
    source.includes("requires_in_stock"),
    "bypass rules must include requires_in_stock",
  );
  assert(
    source.includes("if (requiresInStock && !inStock) continue"),
    "bypass must skip rules when in-stock is required but not indicated",
  );
  assert(
    source.includes("if (requiresHotList && !hotList) continue"),
    "bypass must skip rules when hot list is required but not flagged",
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

Deno.test("customer share gate uses configured/default margin floor instead of a hardcoded 10", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("async function loadConfiguredMarginFloorPct("));
  assert(source.includes('.from("qb_margin_thresholds")'));
  assert(source.includes("policy.standardMarginFloorPct"));
  assert(source.includes("DEFAULT_QUOTE_MARGIN_FLOOR_PCT"));
  assert(source.includes("input.marginPct < marginFloorPct"));
  assert(source.includes("pkg.margin_pct < sendMarginFloorPct"));
  assertEquals(source.includes("input.marginPct < 10"), false);
  assertEquals(source.includes("pkg.margin_pct < 10"), false);
});

Deno.test("customer share gate aligns conditionally approved quotes with send-package", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("async function assertApprovedWithConditionsSendReady("));

  const shareGateIndex = source.indexOf("async function assertQuoteCustomerShareable(");
  const shareConditionalIndex = source.indexOf('input.status === "approved_with_conditions"', shareGateIndex);
  const shareHelperIndex = source.indexOf("assertApprovedWithConditionsSendReady({", shareConditionalIndex);
  const shareApprovedIndex = source.indexOf(
    'input.status === "approved" || input.status === "approved_with_conditions"',
    shareHelperIndex,
  );
  assert(shareGateIndex > -1, "share gate function must exist");
  assert(shareConditionalIndex > shareGateIndex, "share gate must branch on conditionally approved quotes");
  assert(shareHelperIndex > shareConditionalIndex, "share gate must evaluate conditional approval readiness");
  assert(shareApprovedIndex > shareHelperIndex, "share margin gate must allow conditionally approved quotes only after readiness passes");

  const sendPackageIndex = source.indexOf('if (action === "send-package")');
  const sendConditionalIndex = source.indexOf('quoteStatus === "approved_with_conditions"', sendPackageIndex);
  const sendHelperIndex = source.indexOf("assertApprovedWithConditionsSendReady({", sendConditionalIndex);
  assert(sendPackageIndex > -1, "send-package branch must exist");
  assert(sendHelperIndex > sendConditionalIndex, "send-package must use the same conditional approval readiness helper");
});

Deno.test("send-package quote select includes existing delivery fields only", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("delivery_eta"));
  assert(source.includes("delivery_state"));
  assert(source.includes("delivery_county"));
  assertEquals(source.includes("shipping_address"), false);
  assertEquals(source.includes("delivery_window"), false);
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

Deno.test("quote save rejects cross-workspace deal_id and unprivileged tax overrides", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const saveStart = source.indexOf('if (action === "save")');
  const saveEnd = source.indexOf('if (action === "submit-approval")', saveStart);
  const save = source.slice(saveStart, saveEnd);
  assert(
    save.includes('.from("qrm_deals")'),
    "save must validate deal_id against qrm_deals",
  );
  assert(
    save.includes('.eq("workspace_id", userWorkspaceId)'),
    "save must scope deal lookup to the caller workspace",
  );
  assert(
    save.includes('"Deal not found in workspace"'),
    "save must reject deal_id outside the caller workspace",
  );
  assert(
    save.includes("taxOverrideAmount != null && !canPublish"),
    "save must gate tax_override_amount behind manager/admin/owner",
  );
  assert(
    save.includes('"Tax override requires manager, admin, or owner role"'),
    "save must return a clear tax override authorization error",
  );
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
