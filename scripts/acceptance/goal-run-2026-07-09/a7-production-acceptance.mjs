#!/usr/bin/env bun
/**
 * A7 production acceptance: OEM price-sheet preview -> publish -> scan ->
 * rep visibility -> governed approval -> apply -> reversal.
 *
 * Safety contract:
 *   - Dry-run by default. Production writes require the explicit --execute flag.
 *   - Refuses every Supabase project except iciddijgonywtxoelous.
 *   - Loads local env files without printing credentials.
 *   - Uses a unique, isolated workspace and RFC-reserved .invalid users.
 *   - Restores assignment and quote dollars in finally.
 *   - Never disables or deletes the append-only OEM audit ledger. A successful
 *     run dismisses the restored impact, removes transient fixtures, disables
 *     retained audit actors, and reports the retained evidence chain.
 *
 * Usage:
 *   bun scripts/acceptance/goal-run-2026-07-09/a7-production-acceptance.mjs
 *   bun scripts/acceptance/goal-run-2026-07-09/a7-production-acceptance.mjs --execute
 *   bun scripts/acceptance/goal-run-2026-07-09/a7-production-acceptance.mjs --execute --output=/absolute/evidence.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../../_shared/local-env.mjs";

const EXPECTED_PROJECT_REF = "iciddijgonywtxoelous";
const repoRoot = resolve(import.meta.dir, "../../..");
loadLocalEnv(repoRoot);

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const outputArgument = process.argv.slice(2).find((arg) =>
  arg.startsWith("--output=")
);
const startedAt = new Date();
const timestamp = startedAt.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
const runTag = `A7ACCEPT-${timestamp}-${suffix}`;
const workspaceId = `a7-accept-${timestamp.toLowerCase()}-${suffix}`;
const outputPath = outputArgument
  ? resolve(outputArgument.slice("--output=".length))
  : resolve(
    repoRoot,
    "test-results",
    "agent-gates",
    `${timestamp}-a7-production-acceptance.json`,
  );

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

const ids = makeFixtureIds();
const runtime = {
  admin: null,
  users: {},
  createdUserIds: [],
  eventId: null,
  impactIds: {},
  draftId: null,
  approvalCaseId: null,
  applyAuditId: null,
  reverseAuditId: null,
  assignmentRestored: false,
  quoteRestored: false,
  primaryImpactDismissed: false,
  seeded: false,
};

const evidence = {
  schema_version: 1,
  acceptance: "A7 OEM price-change governed apply/reversal",
  run_tag: runTag,
  mode: execute ? "execute" : "dry_run",
  project_ref: null,
  workspace_id: workspaceId,
  started_at: startedAt.toISOString(),
  completed_at: null,
  verdict: "RUNNING",
  mission_alignment: {
    verdict: "PASS",
    evidence:
      "Pressure-tests an AI-assisted equipment pricing workflow while preserving customer trust, rep ownership, manager authority, dollar correctness, tenant isolation, and no-send controls.",
  },
  plan: [
    "verify immutable production project identity",
    "seed isolated users, assignments, OEM brands, catalog, sheets, and open quotes",
    "preview and publish an atomic brand-scoped sheet diff",
    "verify materiality, customer lock, yard-stock lock, brand isolation, and current assignment",
    "create and replay the governed manager-approval draft",
    "approve without advancing/sending the customer quote",
    "apply and replay exact line/totals mutation",
    "reverse and replay exact line/totals restoration",
    "verify append-only audits and no customer communication",
    "dismiss restored action and clean or retire fixtures in finally",
  ],
  fixtures: {
    users: {},
    brands: [ids.brandPrimary, ids.brandOther],
    price_sheets: [ids.sheetPrior, ids.sheetIncoming],
    quotes: [ids.quotePrimary, ids.quoteLocked, ids.quoteQuiet, ids.quoteOther],
  },
  checks: [],
  http: [],
  cleanup: {
    mode: null,
    actions: [],
    errors: [],
    retained_immutable_chain: null,
  },
  limitations: [
    "A successful apply/reverse produces append-only qb_quote_reprice_audits rows with RESTRICT foreign keys. The harness preserves that evidence chain by design and reports every retained identifier.",
    "Approval may attempt an internal staff notification to an RFC-reserved .invalid fixture address; customer communication is forbidden and asserted from the governed response and audit ledger.",
  ],
  error: null,
};

let fatalError = null;

try {
  const projectRef = verifyProjectIdentity();
  evidence.project_ref = projectRef;
  check("production project ref is exact", projectRef === EXPECTED_PROJECT_REF, {
    expected: EXPECTED_PROJECT_REF,
    actual: projectRef,
  });

  if (!execute) {
    evidence.verdict = "DRY_RUN";
  } else {
    if (!anonKey || !serviceRoleKey) {
      throw new Error(
        "--execute requires SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    runtime.admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await runAcceptance();
    evidence.verdict = "PASS";
  }
} catch (error) {
  fatalError = error;
  evidence.verdict = "FAIL";
  evidence.error = safeMessage(error);
} finally {
  if (execute && runtime.admin) {
    await cleanupFixtures();
  }
  evidence.completed_at = new Date().toISOString();
  if (evidence.cleanup.errors.some((entry) => entry.critical === true)) {
    evidence.verdict = "FAIL";
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify({ ...evidence, evidence_path: outputPath }, null, 2));
}

if (fatalError || evidence.verdict === "FAIL") process.exitCode = 1;

async function runAcceptance() {
  await preflightSchema();

  runtime.users.manager = await createFixtureUser("manager");
  runtime.users.rep = await createFixtureUser("rep");
  runtime.users.formerRep = await createFixtureUser("rep");
  evidence.fixtures.users = {
    manager_id: runtime.users.manager.id,
    rep_id: runtime.users.rep.id,
    reassignment_rep_id: runtime.users.formerRep.id,
  };
  check("isolated acceptance actors are scoped to the fixture workspace", true, {
    roles: ["manager", "rep", "rep"],
    workspace_id: workspaceId,
  });

  await seedDatabaseFixtures();
  runtime.seeded = true;

  const preview = await edgeJson("oem-price-feeds", "preview", {
    token: runtime.users.manager.token,
    body: { priceSheetId: ids.sheetIncoming },
  });
  assertPreview(preview.payload);

  const previewReplay = await edgeJson("oem-price-feeds", "preview", {
    token: runtime.users.manager.token,
    body: { priceSheetId: ids.sheetIncoming },
  });
  check(
    "preview replay is deterministic",
    previewReplay.payload?.diff?.changedItemCount ===
      preview.payload?.diff?.changedItemCount &&
      previewReplay.payload?.impactPreview?.materialQuotesAffected ===
        preview.payload?.impactPreview?.materialQuotesAffected &&
      previewReplay.payload?.impactPreview?.totalDeltaCents ===
        preview.payload?.impactPreview?.totalDeltaCents,
    {
      changed_item_count: previewReplay.payload?.diff?.changedItemCount,
      material_quote_count:
        previewReplay.payload?.impactPreview?.materialQuotesAffected,
      total_delta_cents: previewReplay.payload?.impactPreview?.totalDeltaCents,
    },
  );

  const publish = await edgeJson("oem-price-feeds", "publish", {
    token: runtime.users.manager.token,
    body: { priceSheetId: ids.sheetIncoming, autoApprovePending: true },
  });
  runtime.eventId = publish.payload?.eventId ?? null;
  check("publish created one active price-book event", Boolean(runtime.eventId), {
    event_id: runtime.eventId,
    publish_group_id: publish.payload?.publishGroupId ?? null,
    material_quotes_affected: publish.payload?.materialQuotesAffected,
  });

  const publishReplay = await edgeJson("oem-price-feeds", "publish", {
    token: runtime.users.manager.token,
    body: { priceSheetId: ids.sheetIncoming, autoApprovePending: true },
  });
  check(
    "publish replay is idempotent",
    publishReplay.payload?.idempotent === true &&
      publishReplay.payload?.eventId === runtime.eventId,
    {
      event_id: publishReplay.payload?.eventId ?? null,
      idempotent: publishReplay.payload?.idempotent === true,
    },
  );

  await assertPersistedScan();
  await assertRepVisibilityAndCurrentAssignment();

  const lockedDraft = await edgeJson(
    "oem-price-feeds",
    `impacts/${runtime.impactIds.locked}/draft`,
    {
      token: runtime.users.rep.token,
      body: { submissionNote: `${runTag} must remain locked` },
      expectedStatuses: [409],
    },
  );
  check("customer-locked impact cannot enter approval", lockedDraft.status === 409, {
    status: lockedDraft.status,
  });

  const draft = await edgeJson(
    "oem-price-feeds",
    `impacts/${runtime.impactIds.primary}/draft`,
    {
      token: runtime.users.rep.token,
      body: { submissionNote: `${runTag} governed OEM acceptance` },
      expectedStatuses: [200, 201],
    },
  );
  runtime.draftId = draft.payload?.draftId ?? null;
  runtime.approvalCaseId = draft.payload?.approvalCaseId ?? null;
  check(
    "rep created a no-send governed approval draft",
    Boolean(runtime.draftId) && Boolean(runtime.approvalCaseId) &&
      draft.payload?.approvalRequired === true &&
      draft.payload?.customerCommunication === "none" &&
      draft.payload?.emailDraftId === null,
    {
      draft_id: runtime.draftId,
      approval_case_id: runtime.approvalCaseId,
      customer_communication: draft.payload?.customerCommunication ?? null,
    },
  );
  await assertApprovalCaseEconomics();

  const draftReplay = await edgeJson(
    "oem-price-feeds",
    `impacts/${runtime.impactIds.primary}/draft`,
    {
      token: runtime.users.rep.token,
      body: { submissionNote: `${runTag} governed OEM acceptance` },
    },
  );
  check(
    "draft replay returns the same case without duplication",
    draftReplay.payload?.idempotent === true &&
      draftReplay.payload?.draftId === runtime.draftId &&
      draftReplay.payload?.approvalCaseId === runtime.approvalCaseId,
    {
      draft_id: draftReplay.payload?.draftId ?? null,
      approval_case_id: draftReplay.payload?.approvalCaseId ?? null,
      idempotent: draftReplay.payload?.idempotent === true,
    },
  );

  const approval = await edgeJson("quote-builder-v2", "decide-approval-case", {
    token: runtime.users.manager.token,
    body: {
      approval_case_id: runtime.approvalCaseId,
      decision: "approved",
      note: `${runTag} manager reviewed exact OEM economics; acceptance only`,
    },
  });
  check(
    "OEM approval never advances or auto-sends the customer quote",
    approval.payload?.auto_send?.attempted === false &&
      approval.payload?.auto_send?.sent === false &&
      approval.payload?.auto_send?.reason === "oem_reprice_never_auto_send" &&
      approval.payload?.approval_case?.status === "approved",
    {
      case_status: approval.payload?.approval_case?.status ?? null,
      auto_send_reason: approval.payload?.auto_send?.reason ?? null,
    },
  );

  const apply = await edgeJson(
    "oem-price-feeds",
    `drafts/${runtime.draftId}/apply`,
    { token: runtime.users.rep.token, body: {} },
  );
  runtime.applyAuditId = apply.payload?.audit_id ?? null;
  check(
    "approved draft applies through one append-only audit",
    Boolean(runtime.applyAuditId) && apply.payload?.idempotent === false &&
      apply.payload?.applied_line_count === 1 &&
      apply.payload?.customer_communication === "none",
    {
      audit_id: runtime.applyAuditId,
      applied_line_count: apply.payload?.applied_line_count,
      customer_communication: apply.payload?.customer_communication ?? null,
    },
  );

  const applyReplay = await edgeJson(
    "oem-price-feeds",
    `drafts/${runtime.draftId}/apply`,
    { token: runtime.users.rep.token, body: {} },
  );
  check(
    "apply replay is dollar-idempotent",
    applyReplay.payload?.idempotent === true &&
      applyReplay.payload?.audit_id === runtime.applyAuditId,
    {
      audit_id: applyReplay.payload?.audit_id ?? null,
      idempotent: applyReplay.payload?.idempotent === true,
    },
  );
  await assertAppliedState();

  const appliedRepView = await edgeJson("oem-price-feeds", "rep-impacts", {
    token: runtime.users.rep.token,
    method: "GET",
  });
  const appliedCard = findImpact(appliedRepView.payload, ids.quotePrimary);
  check(
    "applied card exposes reversible audit history while clearing the action chip",
    appliedCard?.state === "applied" &&
      appliedRepView.payload?.summary?.visibleImpactCount === 0 &&
      appliedRepView.payload?.summary?.affectedQuoteCount === 0 &&
      Array.isArray(appliedCard?.reprice_history) &&
      appliedCard.reprice_history.some((row) =>
        row.action === "apply" && row.can_reverse === true &&
        row.customer_communication === "none"
      ) &&
      !appliedRepView.payload.impacts.some((row) =>
        row.quote_package_id === ids.quotePrimary && row.state !== "applied"
      ),
    {
      state: appliedCard?.state ?? null,
      visible_impact_count: appliedRepView.payload?.summary?.visibleImpactCount,
      affected_quote_count: appliedRepView.payload?.summary?.affectedQuoteCount,
      reversible_history_count: Array.isArray(appliedCard?.reprice_history)
        ? appliedCard.reprice_history.filter((row) => row.can_reverse === true).length
        : 0,
      fixture_actionable_count: appliedRepView.payload.impacts.filter((row) =>
        row.quote_package_id === ids.quotePrimary && row.state !== "applied"
      ).length,
    },
  );

  const reverse = await edgeJson(
    "oem-price-feeds",
    `applies/${runtime.applyAuditId}/reverse`,
    { token: runtime.users.rep.token, body: {} },
  );
  runtime.reverseAuditId = reverse.payload?.audit_id ?? null;
  runtime.quoteRestored = true;
  check(
    "apply reverses dollar-for-dollar without customer communication",
    Boolean(runtime.reverseAuditId) &&
      reverse.payload?.apply_audit_id === runtime.applyAuditId &&
      reverse.payload?.idempotent === false &&
      reverse.payload?.reversed_line_count === 1 &&
      reverse.payload?.customer_communication === "none",
    {
      reverse_audit_id: runtime.reverseAuditId,
      apply_audit_id: reverse.payload?.apply_audit_id ?? null,
      reversed_line_count: reverse.payload?.reversed_line_count,
    },
  );

  const reverseReplay = await edgeJson(
    "oem-price-feeds",
    `applies/${runtime.applyAuditId}/reverse`,
    { token: runtime.users.rep.token, body: {} },
  );
  check(
    "reversal replay is dollar-idempotent",
    reverseReplay.payload?.idempotent === true &&
      reverseReplay.payload?.audit_id === runtime.reverseAuditId,
    {
      audit_id: reverseReplay.payload?.audit_id ?? null,
      idempotent: reverseReplay.payload?.idempotent === true,
    },
  );

  await assertReversedStateAndAudits();
}

async function preflightSchema() {
  for (const [table, columns] of [
    ["qb_price_sheet_lineage", "price_sheet_id,lane,predecessor_price_sheet_id"],
    ["qb_workspace_pricing_epochs", "workspace_id,epoch"],
    ["qb_quote_pricing_epochs", "workspace_id,quote_package_id,epoch"],
    ["qb_quote_reprice_audits", "id,action,customer_communication_sent"],
  ]) {
    const { error } = await runtime.admin.from(table).select(columns, {
      head: true,
      count: "exact",
    }).limit(1);
    if (error) throw new Error(`A7 schema preflight failed for ${table}: ${error.message}`);
  }
  check("production exposes migrations 812/813 A7 substrate", true, {
    tables: [
      "qb_price_sheet_lineage",
      "qb_workspace_pricing_epochs",
      "qb_quote_pricing_epochs",
      "qb_quote_reprice_audits",
    ],
  });
}

async function createFixtureUser(role) {
  const userSuffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `a7-${role}-${userSuffix}@example.invalid`;
  const password = `A7!${crypto.randomUUID()}z9`;
  const fullName = `${runTag} ${role}`;
  const { data, error } = await runtime.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, acceptance_run: runTag },
  });
  if (error || !data.user?.id) {
    throw new Error(`fixture ${role} auth user creation failed: ${error?.message ?? "missing id"}`);
  }
  const id = data.user.id;
  runtime.createdUserIds.push(id);
  await ensureFixtureProfile({ id, email, fullName, role });
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !sessionData.session?.access_token) {
    throw new Error(`fixture ${role} session creation failed: ${signInError?.message ?? "missing session"}`);
  }
  return { id, role, token: sessionData.session.access_token };
}

async function ensureFixtureProfile({ id, email, fullName, role }) {
  let profile = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await runtime.admin.from("profiles").select("id").eq("id", id)
      .maybeSingle();
    if (result.error) throw new Error(`fixture profile lookup failed: ${result.error.message}`);
    profile = result.data;
    if (profile) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50 * (attempt + 1)));
  }
  if (!profile) {
    const { error } = await runtime.admin.rpc("backfill_profile", {
      p_id: id,
      p_email: email,
      p_full_name: fullName,
      p_role: role,
      p_iron_role: role === "manager" ? "iron_manager" : "iron_advisor",
      p_workspace: workspaceId,
    });
    if (error) throw new Error(`fixture profile backfill failed: ${error.message}`);
  } else {
    await must(
      runtime.admin.from("profile_workspaces").upsert(
        { profile_id: id, workspace_id: workspaceId },
        { onConflict: "profile_id,workspace_id" },
      ),
      "fixture workspace membership",
    );
    await must(
      runtime.admin.from("profiles").update({
        full_name: fullName,
        role,
        active_workspace_id: workspaceId,
        is_active: true,
      }).eq("id", id),
      "fixture profile role/workspace",
    );
  }
  const { data: verified, error } = await runtime.admin.from("profiles")
    .select("id,role,active_workspace_id,is_active").eq("id", id).single();
  if (error || verified.role !== role || verified.active_workspace_id !== workspaceId) {
    throw new Error(`fixture ${role} profile did not acquire isolated workspace`);
  }
}

async function seedDatabaseFixtures() {
  const managerId = runtime.users.manager.id;
  const repId = runtime.users.rep.id;
  const brandCode = `A7${suffix.toUpperCase()}`;
  const otherBrandCode = `B7${suffix.toUpperCase()}`;
  const factoryModel = `F-${suffix.toUpperCase()}`;
  const yardModel = `Y-${suffix.toUpperCase()}`;
  const quietModel = `Q-${suffix.toUpperCase()}`;
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const tomorrowDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  Object.assign(runtime, { brandCode, otherBrandCode, factoryModel, yardModel, quietModel });

  await insertRows("qb_brands", [
    {
      id: ids.brandPrimary,
      workspace_id: workspaceId,
      code: brandCode,
      name: `${runTag} Primary OEM`,
      category: "construction",
      dealer_discount_pct: 0.2,
      default_markup_pct: 0.12,
      markup_floor_pct: 0.1,
      discount_configured: true,
      notes: `${runTag} retained only with immutable acceptance evidence`,
    },
    {
      id: ids.brandOther,
      workspace_id: workspaceId,
      code: otherBrandCode,
      name: `${runTag} Isolation OEM`,
      category: "other",
      dealer_discount_pct: 0.2,
      default_markup_pct: 0.12,
      markup_floor_pct: 0.1,
      discount_configured: true,
      notes: `${runTag} brand-isolation fixture`,
    },
  ]);

  await insertRows("qb_equipment_models", [
    modelRow(ids.modelFactory, ids.brandPrimary, factoryModel, 1_000_000),
    modelRow(ids.modelYard, ids.brandPrimary, yardModel, 2_000_000),
    modelRow(ids.modelQuiet, ids.brandPrimary, quietModel, 1_000_000),
    modelRow(ids.modelOther, ids.brandOther, factoryModel, 900_000),
  ]);

  await insertRows("catalog_entries", [
    catalogRow(ids.catalogFactory, brandCode, factoryModel, 10_000, 8_000, "factory_order"),
    catalogRow(ids.catalogYard, brandCode, yardModel, 20_000, 15_000, "yard_stock"),
    catalogRow(ids.catalogQuiet, brandCode, quietModel, 10_000, 8_000, "factory_order"),
    catalogRow(ids.catalogOther, otherBrandCode, factoryModel, 10_000, 7_000, "factory_order"),
  ]);

  await insertRows("qb_price_sheets", [
    {
      id: ids.sheetPrior,
      workspace_id: workspaceId,
      brand_id: ids.brandPrimary,
      filename: `${runTag}-prior.csv`,
      file_url: `acceptance://${runTag}/prior.csv`,
      file_type: "csv",
      uploaded_by: managerId,
      effective_from: yesterday.slice(0, 10),
      status: "published",
      sheet_type: "price_book",
      published_at: yesterday,
      reviewed_by: managerId,
      reviewed_at: yesterday,
      notes: `${runTag} immutable predecessor`,
    },
    {
      id: ids.sheetIncoming,
      workspace_id: workspaceId,
      brand_id: ids.brandPrimary,
      filename: `${runTag}-incoming.csv`,
      file_url: `acceptance://${runTag}/incoming.csv`,
      file_type: "csv",
      uploaded_by: managerId,
      effective_from: now.slice(0, 10),
      status: "extracted",
      sheet_type: "price_book",
      supersedes_price_sheet_id: ids.sheetPrior,
      notes: `${runTag} production acceptance candidate`,
    },
  ]);

  await insertRows("qb_price_sheet_items", [
    sheetItem(ids.priorFactoryItem, ids.sheetPrior, ids.modelFactory, factoryModel, 1_000_000, yesterday),
    sheetItem(ids.priorYardItem, ids.sheetPrior, ids.modelYard, yardModel, 2_000_000, yesterday),
    sheetItem(ids.priorQuietItem, ids.sheetPrior, ids.modelQuiet, quietModel, 1_000_000, yesterday),
    sheetItem(ids.incomingFactoryItem, ids.sheetIncoming, ids.modelFactory, factoryModel, 1_100_000, null),
    sheetItem(ids.incomingYardItem, ids.sheetIncoming, ids.modelYard, yardModel, 2_200_000, null),
    sheetItem(ids.incomingQuietItem, ids.sheetIncoming, ids.modelQuiet, quietModel, 1_010_000, null),
  ]);

  await insertRows("qb_margin_thresholds", [{
    id: ids.marginThreshold,
    workspace_id: workspaceId,
    brand_id: ids.brandPrimary,
    min_margin_pct: 10,
    notes: `${runTag} manager review floor`,
    updated_by: managerId,
  }]);

  await insertRows("qrm_deal_stages", [{
    id: ids.stage,
    workspace_id: workspaceId,
    name: `${runTag} Open Quote`,
    sort_order: 10,
    probability: 50,
  }]);

  await insertRows("qrm_companies", [
    {
      id: ids.companyPrimary,
      workspace_id: workspaceId,
      name: `${runTag} Unlocked Customer`,
      assigned_rep_id: repId,
      price_lock_active: false,
      metadata: { acceptance_run: runTag },
    },
    {
      id: ids.companyLocked,
      workspace_id: workspaceId,
      name: `${runTag} Contract-Locked Customer`,
      assigned_rep_id: repId,
      price_lock_active: true,
      price_lock_reason: `${runTag} annual agreement`,
      price_lock_expires_at: tomorrowDate,
      metadata: { acceptance_run: runTag },
    },
  ]);

  await insertRows("qrm_deals", [
    dealRow(ids.dealPrimary, ids.companyPrimary, `${runTag} Primary Deal`, repId),
    dealRow(ids.dealLocked, ids.companyLocked, `${runTag} Locked Deal`, repId),
    dealRow(ids.dealQuiet, ids.companyPrimary, `${runTag} Quiet Deal`, repId),
    dealRow(ids.dealOther, ids.companyPrimary, `${runTag} Other Brand Deal`, repId),
  ]);

  await insertRows("quote_packages", [
    quoteRow(ids.quotePrimary, ids.dealPrimary, repId, 40_000, 30_000, [
      { make: brandCode, model: factoryModel, price: 10_000, source_location: "factory_order" },
      { make: brandCode, model: yardModel, price: 20_000, source_location: "yard_stock" },
      { make: otherBrandCode, model: factoryModel, price: 10_000, source_location: "factory_order" },
    ]),
    quoteRow(ids.quoteLocked, ids.dealLocked, repId, 10_000, 8_000, [
      { make: brandCode, model: factoryModel, price: 10_000, source_location: "factory_order" },
    ]),
    quoteRow(ids.quoteQuiet, ids.dealQuiet, repId, 10_000, 8_000, [
      { make: brandCode, model: quietModel, price: 10_000, source_location: "factory_order" },
    ]),
    quoteRow(ids.quoteOther, ids.dealOther, repId, 10_000, 7_000, [
      { make: otherBrandCode, model: factoryModel, price: 10_000, source_location: "factory_order" },
    ]),
  ]);

  await insertRows("quote_package_line_items", [
    lineRow(ids.lineFactory, ids.quotePrimary, ids.catalogFactory, brandCode, factoryModel, 10_000, 8_000, "factory_order", 1),
    lineRow(ids.lineYard, ids.quotePrimary, ids.catalogYard, brandCode, yardModel, 20_000, 15_000, "yard_stock", 2),
    lineRow(ids.lineOther, ids.quotePrimary, ids.catalogOther, otherBrandCode, factoryModel, 10_000, 7_000, "factory_order", 3),
    lineRow(ids.lineLocked, ids.quoteLocked, ids.catalogFactory, brandCode, factoryModel, 10_000, 8_000, "factory_order", 1),
    lineRow(ids.lineQuiet, ids.quoteQuiet, ids.catalogQuiet, brandCode, quietModel, 10_000, 8_000, "factory_order", 1),
    lineRow(ids.lineOtherOnly, ids.quoteOther, ids.catalogOther, otherBrandCode, factoryModel, 10_000, 7_000, "factory_order", 1),
  ]);

  await insertRows("quote_package_versions", [{
    id: ids.initialVersion,
    workspace_id: workspaceId,
    quote_package_id: ids.quotePrimary,
    version_number: 1,
    snapshot_json: { acceptance_run: runTag, quote_id: ids.quotePrimary },
    computed_metrics_json: { net_total: 40_000, margin_pct: 25 },
    created_by: repId,
  }]);

  check("production-shaped A7 fixtures seeded in an isolated workspace", true, {
    workspace_id: workspaceId,
    brand_count: 2,
    sheet_count: 2,
    quote_count: 4,
    line_count: 6,
  });
}

function assertPreview(payload) {
  const top = payload?.impactPreview?.topQuotes ?? [];
  const primary = top.find((row) => row.quotePackageId === ids.quotePrimary);
  check(
    "preview scans every fixture quote and classifies exact materiality",
    payload?.ok === true &&
      payload?.diff?.changedItemCount === 3 &&
      payload?.diff?.materialityRule?.line_pct_gt === 2 &&
      payload?.diff?.materialityRule?.quote_delta_cents_gt === 100_000 &&
      payload?.impactPreview?.scanEvidence?.scanComplete === true &&
      payload?.impactPreview?.scanEvidence?.candidateQuoteCount === 4 &&
      payload?.impactPreview?.materialQuotesAffected === 1 &&
      payload?.impactPreview?.quietQuotesAffected === 2,
    {
      candidate_quote_count: payload?.impactPreview?.scanEvidence?.candidateQuoteCount,
      changed_item_count: payload?.diff?.changedItemCount,
      material_quote_count: payload?.impactPreview?.materialQuotesAffected,
      quiet_quote_count: payload?.impactPreview?.quietQuotesAffected,
    },
  );
  check(
    "strict threshold, yard lock, and brand isolation produce line_pct-only exposure",
    primary?.materialityTrigger === "line_pct" &&
      primary?.totalDeltaCents === 100_000 &&
      primary?.lines?.length === 2 &&
      primary.lines.some((line) =>
        line.quotePackageLineItemId === ids.lineYard &&
        line.suppressedByStockLock === true &&
        line.suppressionReason === "yard_stock_price_locked"
      ) &&
      !primary.lines.some((line) => line.quotePackageLineItemId === ids.lineOther) &&
      !top.some((row) => row.quotePackageId === ids.quoteOther),
    {
      materiality_trigger: primary?.materialityTrigger ?? null,
      total_delta_cents: primary?.totalDeltaCents ?? null,
      impact_line_count: primary?.lines?.length ?? 0,
      stock_locked_line_count: payload?.impactPreview?.stockLockedLineCount,
    },
  );
}

async function assertPersistedScan() {
  const { data: events } = await must(
    runtime.admin.from("qb_price_change_events")
      .select("id,status,stream_kind,publish_group_id,price_sheet_id")
      .eq("workspace_id", workspaceId)
      .eq("price_sheet_id", ids.sheetIncoming),
    "load persisted A7 event",
  );
  check("publish persisted exactly one active price-book stream", events.length === 1 && events[0].status === "active" && events[0].stream_kind === "price_book", {
    event_count: events.length,
    status: events[0]?.status ?? null,
    stream_kind: events[0]?.stream_kind ?? null,
  });
  runtime.eventId = events[0].id;

  const { data: impacts } = await must(
    runtime.admin.from("qb_quote_reprice_impacts")
      .select("id,quote_package_id,state,total_delta_cents,max_line_delta_pct,materiality_trigger,suppressed_by_customer_lock,approval_required_reasons,assigned_rep_id")
      .eq("event_id", runtime.eventId),
    "load persisted A7 impacts",
  );
  const primary = impacts.find((row) => row.quote_package_id === ids.quotePrimary);
  const locked = impacts.find((row) => row.quote_package_id === ids.quoteLocked);
  const quiet = impacts.find((row) => row.quote_package_id === ids.quoteQuiet);
  runtime.impactIds = {
    primary: primary?.id ?? null,
    locked: locked?.id ?? null,
    quiet: quiet?.id ?? null,
  };
  check(
    "persisted scan is brand-scoped and materiality-exact",
    impacts.length === 3 && primary?.state === "visible" &&
      Number(primary?.total_delta_cents) === 100_000 &&
      primary?.materiality_trigger === "line_pct" &&
      !impacts.some((row) => row.quote_package_id === ids.quoteOther),
    {
      impact_count: impacts.length,
      primary_state: primary?.state ?? null,
      primary_trigger: primary?.materiality_trigger ?? null,
      isolated_quote_present: impacts.some((row) => row.quote_package_id === ids.quoteOther),
    },
  );
  check(
    "customer lock and sub-threshold change stay quiet",
    locked?.state === "quiet" && Number(locked?.total_delta_cents) === 0 &&
      locked?.suppressed_by_customer_lock === true &&
      locked?.approval_required_reasons?.includes("customer_price_lock") &&
      quiet?.state === "quiet" && Number(quiet?.total_delta_cents) === 10_000 &&
      Number(quiet?.max_line_delta_pct) === 1,
    {
      locked_state: locked?.state ?? null,
      locked_delta_cents: Number(locked?.total_delta_cents ?? -1),
      quiet_state: quiet?.state ?? null,
      quiet_delta_cents: Number(quiet?.total_delta_cents ?? -1),
    },
  );

  const { data: lines } = await must(
    runtime.admin.from("qb_quote_reprice_impact_lines")
      .select("quote_package_line_item_id,delta_cents,is_yard_stock,suppressed_by_stock_lock,suppression_reason")
      .eq("impact_id", runtime.impactIds.primary),
    "load primary impact lines",
  );
  check(
    "yard stock is visible but excluded from automatic repricing",
    lines.length === 2 &&
      lines.some((row) =>
        row.quote_package_line_item_id === ids.lineFactory &&
        Number(row.delta_cents) === 100_000 && row.suppressed_by_stock_lock === false
      ) &&
      lines.some((row) =>
        row.quote_package_line_item_id === ids.lineYard &&
        Number(row.delta_cents) === 200_000 && row.is_yard_stock === true &&
        row.suppressed_by_stock_lock === true &&
        row.suppression_reason === "yard_stock_price_locked"
      ),
    { impact_line_count: lines.length },
  );

  const { data: otherModel } = await must(
    runtime.admin.from("qb_equipment_models").select("list_price_cents")
      .eq("id", ids.modelOther).single(),
    "load other-brand model",
  );
  check("catalog publish cannot mutate the same model code under another brand", Number(otherModel.list_price_cents) === 900_000, {
    other_brand_list_price_cents: Number(otherModel.list_price_cents),
  });
}

async function assertRepVisibilityAndCurrentAssignment() {
  const initial = await edgeJson("oem-price-feeds", "rep-impacts", {
    token: runtime.users.rep.token,
    method: "GET",
  });
  const card = findImpact(initial.payload, ids.quotePrimary);
  check(
    "assigned rep receives actionable chip and full card data",
    initial.payload?.summary?.visibleImpactCount === 1 &&
      initial.payload?.summary?.affectedQuoteCount === 1 &&
      card?.state === "visible" &&
      card?.requires_manager_review === true &&
      Array.isArray(card?.qb_quote_reprice_impact_lines) &&
      card.qb_quote_reprice_impact_lines.length === 2,
    {
      visible_impact_count: initial.payload?.summary?.visibleImpactCount,
      affected_quote_count: initial.payload?.summary?.affectedQuoteCount,
      card_state: card?.state ?? null,
      card_line_count: card?.qb_quote_reprice_impact_lines?.length ?? 0,
    },
  );

  await must(
    runtime.admin.from("qrm_deals").update({ assigned_rep_id: runtime.users.formerRep.id })
      .eq("id", ids.dealPrimary),
    "temporarily reassign primary deal",
  );
  runtime.assignmentRestored = false;
  const formerOwnerView = await edgeJson("oem-price-feeds", "rep-impacts", {
    token: runtime.users.rep.token,
    method: "GET",
  });
  const newOwnerView = await edgeJson("oem-price-feeds", "rep-impacts", {
    token: runtime.users.formerRep.token,
    method: "GET",
  });
  check(
    "current assignment overrides the historical impact snapshot",
    !findImpact(formerOwnerView.payload, ids.quotePrimary) &&
      Boolean(findImpact(newOwnerView.payload, ids.quotePrimary)),
    {
      former_owner_can_see: Boolean(findImpact(formerOwnerView.payload, ids.quotePrimary)),
      current_owner_can_see: Boolean(findImpact(newOwnerView.payload, ids.quotePrimary)),
    },
  );
  await restoreAssignment();
}

async function assertAppliedState() {
  const { data: quote } = await must(
    runtime.admin.from("quote_packages")
      .select("status,equipment_total,subtotal,net_total,margin_amount,requires_requote,sent_at")
      .eq("id", ids.quotePrimary).single(),
    "load applied quote",
  );
  const { data: lines } = await must(
    runtime.admin.from("quote_package_line_items")
      .select("id,quoted_list_price,unit_price,extended_price")
      .in("id", [ids.lineFactory, ids.lineYard, ids.lineOther]),
    "load applied quote lines",
  );
  const factory = lines.find((row) => row.id === ids.lineFactory);
  const yard = lines.find((row) => row.id === ids.lineYard);
  const other = lines.find((row) => row.id === ids.lineOther);
  check(
    "apply changes only the unlocked in-brand line and canonical totals",
    Number(factory?.quoted_list_price) === 11_000 &&
      Number(factory?.unit_price) === 11_000 &&
      Number(factory?.extended_price) === 11_000 &&
      Number(yard?.quoted_list_price) === 20_000 &&
      Number(other?.quoted_list_price) === 10_000 &&
      Number(quote.equipment_total) === 41_000 &&
      Number(quote.subtotal) === 41_000 &&
      Number(quote.net_total) === 41_000 &&
      Number(quote.margin_amount) === 11_000 &&
      quote.requires_requote === false,
    {
      factory_price: Number(factory?.quoted_list_price),
      yard_price: Number(yard?.quoted_list_price),
      other_brand_price: Number(other?.quoted_list_price),
      net_total: Number(quote.net_total),
    },
  );
  check("apply leaves customer quote state and send timestamp untouched", quote.status === "draft" && quote.sent_at === null, {
    quote_status: quote.status,
    sent_at: quote.sent_at,
  });
}

async function assertApprovalCaseEconomics() {
  const { data: approvalCase } = await must(
    runtime.admin.from("quote_approval_cases")
      .select("id,status,net_total,margin_pct,policy_snapshot_json,reason_summary_json,oem_reprice_draft_id,oem_reprice_draft_version,oem_reprice_draft_updated_at")
      .eq("id", runtime.approvalCaseId).single(),
    "load OEM approval economics",
  );
  const policy = approvalCase.policy_snapshot_json ?? {};
  const economics = policy.oem_reprice?.economics ?? {};
  const reasons = approvalCase.reason_summary_json ?? {};
  check(
    "manager case binds the exact draft, lines, economics, and no-send policy",
    approvalCase.status === "pending" &&
      approvalCase.oem_reprice_draft_id === runtime.draftId &&
      Number(approvalCase.oem_reprice_draft_version) === 1 &&
      Boolean(approvalCase.oem_reprice_draft_updated_at) &&
      policy.approval_kind === "oem_reprice" &&
      policy.oem_reprice?.auto_send_customer === false &&
      Number(economics.current_net_total_cents) === 4_000_000 &&
      Number(economics.projected_net_total_cents) === 4_100_000 &&
      Number(economics.total_delta_cents) === 100_000 &&
      Number(approvalCase.net_total) === 41_000 &&
      reasons.customer_communication === "none" &&
      Array.isArray(reasons.lines) && reasons.lines.length === 2,
    {
      case_status: approvalCase.status,
      draft_id: approvalCase.oem_reprice_draft_id,
      current_net_total_cents: Number(economics.current_net_total_cents),
      projected_net_total_cents: Number(economics.projected_net_total_cents),
      total_delta_cents: Number(economics.total_delta_cents),
      projected_margin_pct: Number(economics.projected_margin_pct),
      approval_line_count: Array.isArray(reasons.lines) ? reasons.lines.length : 0,
      customer_communication: reasons.customer_communication ?? null,
    },
  );
}

async function assertReversedStateAndAudits() {
  const { data: quote } = await must(
    runtime.admin.from("quote_packages")
      .select("status,equipment_total,subtotal,net_total,margin_amount,margin_pct,requires_requote,sent_at")
      .eq("id", ids.quotePrimary).single(),
    "load reversed quote",
  );
  const { data: lines } = await must(
    runtime.admin.from("quote_package_line_items")
      .select("id,quoted_list_price,unit_price,extended_price")
      .in("id", [ids.lineFactory, ids.lineYard, ids.lineOther]),
    "load reversed quote lines",
  );
  const factory = lines.find((row) => row.id === ids.lineFactory);
  const yard = lines.find((row) => row.id === ids.lineYard);
  const other = lines.find((row) => row.id === ids.lineOther);
  check(
    "reversal restores every original dollar and preserves locked/isolated lines",
    Number(factory?.quoted_list_price) === 10_000 &&
      Number(factory?.unit_price) === 10_000 &&
      Number(factory?.extended_price) === 10_000 &&
      Number(yard?.quoted_list_price) === 20_000 &&
      Number(other?.quoted_list_price) === 10_000 &&
      Number(quote.equipment_total) === 40_000 &&
      Number(quote.subtotal) === 40_000 &&
      Number(quote.net_total) === 40_000 &&
      Number(quote.margin_amount) === 10_000 &&
      Number(quote.margin_pct) === 25 &&
      quote.requires_requote === true &&
      quote.status === "draft" && quote.sent_at === null,
    {
      factory_price: Number(factory?.quoted_list_price),
      yard_price: Number(yard?.quoted_list_price),
      other_brand_price: Number(other?.quoted_list_price),
      net_total: Number(quote.net_total),
      quote_status: quote.status,
    },
  );

  const { data: audits } = await must(
    runtime.admin.from("qb_quote_reprice_audits")
      .select("id,action,apply_audit_id,draft_id,approval_case_id,before_version_number,after_version_number,customer_communication_sent,payload")
      .eq("workspace_id", workspaceId)
      .eq("quote_package_id", ids.quotePrimary)
      .order("created_at", { ascending: true }),
    "load append-only OEM audits",
  );
  const apply = audits.find((row) => row.action === "apply");
  const reverse = audits.find((row) => row.action === "reverse");
  check(
    "idempotent mutations produced exactly one linked apply and one reversal audit",
    audits.length === 2 && apply?.id === runtime.applyAuditId &&
      reverse?.id === runtime.reverseAuditId &&
      reverse?.apply_audit_id === runtime.applyAuditId &&
      Number(apply?.after_version_number) > Number(apply?.before_version_number) &&
      Number(reverse?.after_version_number) > Number(reverse?.before_version_number),
    {
      audit_count: audits.length,
      actions: audits.map((row) => row.action),
      apply_audit_id: apply?.id ?? null,
      reverse_audit_id: reverse?.id ?? null,
    },
  );
  check(
    "audit ledger proves no customer send on apply or reversal",
    audits.every((row) =>
      row.customer_communication_sent === false &&
      row.payload?.side_effects?.customer_communication === "none" &&
      row.payload?.side_effects?.email_draft_id === null
    ),
    {
      customer_communication_sent: audits.map((row) => row.customer_communication_sent),
      side_effects: audits.map((row) => row.payload?.side_effects?.customer_communication ?? null),
    },
  );

  const { data: draft } = await must(
    runtime.admin.from("qb_quote_reprice_drafts")
      .select("status,email_draft_id,reversed_at")
      .eq("id", runtime.draftId).single(),
    "load reversed draft",
  );
  const { count: versionCount, error: versionError } = await runtime.admin
    .from("quote_package_versions").select("id", { count: "exact", head: true })
    .eq("quote_package_id", ids.quotePrimary);
  if (versionError) throw new Error(`quote version count failed: ${versionError.message}`);
  check(
    "draft is reversed, has no email draft, and replays created no extra versions",
    draft.status === "reversed" && draft.email_draft_id === null &&
      Boolean(draft.reversed_at) && versionCount === 3,
    {
      draft_status: draft.status,
      email_draft_id: draft.email_draft_id,
      quote_version_count: versionCount,
    },
  );
}

async function cleanupFixtures() {
  await cleanupTry("restore current assignment", restoreAssignment, true);

  let audits = [];
  await cleanupTry("inspect immutable audit chain", async () => {
    const result = await runtime.admin.from("qb_quote_reprice_audits")
      .select("id,action,quote_package_id,draft_id,impact_id,approval_case_id,source_event_id,price_sheet_id,prior_price_sheet_id")
      .eq("workspace_id", workspaceId);
    if (result.error) throw result.error;
    audits = result.data ?? [];
    runtime.applyAuditId ??= audits.find((row) => row.action === "apply")?.id ?? null;
    runtime.reverseAuditId ??= audits.find((row) => row.action === "reverse")?.id ?? null;
    runtime.quoteRestored = runtime.quoteRestored || Boolean(runtime.reverseAuditId);
  }, true);

  if (runtime.applyAuditId && !runtime.reverseAuditId && runtime.users.rep?.token) {
    await cleanupTry("compensating reversal", async () => {
      const result = await edgeJson(
        "oem-price-feeds",
        `applies/${runtime.applyAuditId}/reverse`,
        { token: runtime.users.rep.token, body: {}, cleanup: true },
      );
      runtime.reverseAuditId = result.payload?.audit_id ?? null;
      runtime.quoteRestored = Boolean(runtime.reverseAuditId);
      if (!runtime.quoteRestored) throw new Error("compensating reversal returned no audit id");
      const refreshed = await runtime.admin.from("qb_quote_reprice_audits")
        .select("id,action,quote_package_id,draft_id,impact_id,approval_case_id,source_event_id,price_sheet_id,prior_price_sheet_id")
        .eq("workspace_id", workspaceId);
      if (refreshed.error) throw refreshed.error;
      audits = refreshed.data ?? audits;
    }, true);
  }

  if (audits.length > 0) {
    evidence.cleanup.mode = "retire_append_only_evidence";
    await cleanupTry("dismiss restored primary impact", async () => {
      if (!runtime.impactIds.primary || !runtime.users.manager?.token) return;
      const result = await edgeJson(
        "oem-price-feeds",
        `impacts/${runtime.impactIds.primary}/dismiss`,
        {
          token: runtime.users.manager.token,
          body: { reason: `${runTag} acceptance complete; quote restored and evidence retained` },
          expectedStatuses: [200],
          cleanup: true,
        },
      );
      runtime.primaryImpactDismissed = result.payload?.state === "dismissed";
      if (!runtime.primaryImpactDismissed) throw new Error("impact was not dismissed");
    }, true);

    await cleanupTry("remove internal fixture notifications", async () => {
      const query = runtime.admin.from("qb_notifications").delete()
        .eq("workspace_id", workspaceId);
      const { error } = await query;
      if (error) throw error;
    }, true);
    await cleanupTry("remove transient non-audited quotes", async () => {
      const quoteIds = [ids.quoteLocked, ids.quoteQuiet, ids.quoteOther];
      const { error } = await runtime.admin.from("quote_packages").delete().in("id", quoteIds);
      if (error) throw error;
      await runtime.admin.from("qb_quote_pricing_epochs").delete()
        .eq("workspace_id", workspaceId).in("quote_package_id", quoteIds);
    }, true);
    await cleanupTry("remove transient non-audited deals/customer", async () => {
      const { error: dealsError } = await runtime.admin.from("qrm_deals").delete()
        .in("id", [ids.dealLocked, ids.dealQuiet, ids.dealOther]);
      if (dealsError) throw dealsError;
      const { error: companyError } = await runtime.admin.from("qrm_companies").delete()
        .eq("id", ids.companyLocked);
      if (companyError) throw companyError;
    }, true);
    await cleanupTry("delete reassignment-only user", async () => {
      if (runtime.users.formerRep?.id) {
        const { error } = await runtime.admin.auth.admin.deleteUser(runtime.users.formerRep.id);
        if (error) throw error;
      }
    }, true);
    for (const actorName of ["rep", "manager"]) {
      await cleanupTry(`disable retained ${actorName} audit actor`, async () => {
        const actor = runtime.users[actorName];
        if (!actor?.id) return;
        const { error: profileError } = await runtime.admin.from("profiles")
          .update({ is_active: false }).eq("id", actor.id);
        if (profileError) throw profileError;
        const { error: signOutError } = await runtime.admin.auth.admin.signOut(
          actor.token,
          "global",
        );
        if (signOutError) throw signOutError;
        const { error: authError } = await runtime.admin.auth.admin.updateUserById(
          actor.id,
          { ban_duration: "87600h" },
        );
        if (authError) throw authError;
      }, true);
    }
    evidence.cleanup.retained_immutable_chain = {
      reason: "append-only audit ledger with RESTRICT provenance foreign keys",
      workspace_id: workspaceId,
      audit_ids: audits.map((row) => row.id),
      quote_package_id: ids.quotePrimary,
      draft_id: runtime.draftId ?? audits[0]?.draft_id ?? null,
      impact_id: runtime.impactIds.primary ?? audits[0]?.impact_id ?? null,
      approval_case_id: runtime.approvalCaseId ?? audits[0]?.approval_case_id ?? null,
      event_id: runtime.eventId ?? audits[0]?.source_event_id ?? null,
      price_sheet_ids: [ids.sheetPrior, ids.sheetIncoming],
      actor_ids: [runtime.users.rep?.id, runtime.users.manager?.id].filter(Boolean),
      restored: runtime.quoteRestored,
      dismissed: runtime.primaryImpactDismissed,
    };
  } else {
    evidence.cleanup.mode = "full_delete_before_audit";
    await cleanupTry("detach draft/approval cycle", detachDraftApprovalCycle, true);
    await cleanupTry("delete unaudited fixture graph", deleteUnauditedFixtureGraph, true);
    const createdUsers = [...new Set([
      ...runtime.createdUserIds,
      ...Object.values(runtime.users).map((actor) => actor?.id).filter(Boolean),
    ])];
    for (const userId of createdUsers) {
      await cleanupTry(`delete fixture user ${userId}`, async () => {
        const { error } = await runtime.admin.auth.admin.deleteUser(userId);
        if (error) throw error;
      }, true);
    }
  }
}

async function restoreAssignment() {
  if (!runtime.seeded) return;
  const repId = runtime.users.rep?.id;
  if (!repId) return;
  const { error } = await runtime.admin.from("qrm_deals")
    .update({ assigned_rep_id: repId }).eq("id", ids.dealPrimary);
  if (error && error.code !== "PGRST116") throw error;
  runtime.assignmentRestored = true;
}

async function detachDraftApprovalCycle() {
  if (runtime.approvalCaseId) {
    const { error } = await runtime.admin.from("quote_approval_cases").update({
      oem_reprice_draft_id: null,
      oem_reprice_draft_version: null,
      oem_reprice_draft_updated_at: null,
    }).eq("id", runtime.approvalCaseId);
    if (error) throw error;
  }
  if (runtime.draftId) {
    const { error } = await runtime.admin.from("qb_quote_reprice_drafts")
      .update({ approval_case_id: null }).eq("id", runtime.draftId);
    if (error) throw error;
  }
  if (runtime.approvalCaseId) {
    const { error } = await runtime.admin.from("quote_approval_cases").delete()
      .eq("id", runtime.approvalCaseId);
    if (error) throw error;
  }
  if (runtime.draftId) {
    const { error } = await runtime.admin.from("qb_quote_reprice_drafts").delete()
      .eq("id", runtime.draftId);
    if (error) throw error;
  }
}

async function deleteUnauditedFixtureGraph() {
  for (const table of [
    "qb_notifications",
    "quote_packages",
    "qrm_deals",
    "qrm_companies",
    "qb_price_sheets",
    "catalog_entries",
    "qb_equipment_models",
    "qb_brands",
    "qrm_deal_stages",
    // Quote/deal/company delete triggers can recreate epoch rows, so epochs
    // are intentionally last.
    "qb_quote_pricing_epochs",
    "qb_workspace_pricing_epochs",
  ]) {
    const { error } = await runtime.admin.from(table).delete()
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }
  for (const [table, recordIds] of [
    ["qb_brands_audit", [ids.brandPrimary, ids.brandOther]],
    ["qb_equipment_models_audit", [
      ids.modelFactory,
      ids.modelYard,
      ids.modelQuiet,
      ids.modelOther,
    ]],
    ["qb_price_sheets_audit", [ids.sheetPrior, ids.sheetIncoming]],
  ]) {
    const { error } = await runtime.admin.from(table).delete()
      .in("record_id", recordIds);
    if (error) throw new Error(`${table} fixture-audit cleanup failed: ${error.message}`);
  }
  for (const table of [
    "quote_packages",
    "qrm_deals",
    "qrm_companies",
    "qb_price_sheets",
    "catalog_entries",
    "qb_equipment_models",
    "qb_brands",
    "qrm_deal_stages",
  ]) {
    const { count, error } = await runtime.admin.from(table).select("id", {
      head: true,
      count: "exact",
    }).eq("workspace_id", workspaceId);
    if (error || count !== 0) {
      throw new Error(`full cleanup left ${count ?? "unknown"} rows in ${table}`);
    }
  }
  for (const [table, selectColumn] of [
    ["qb_quote_pricing_epochs", "quote_package_id"],
    ["qb_workspace_pricing_epochs", "workspace_id"],
  ]) {
    const { count, error } = await runtime.admin.from(table).select(selectColumn, {
      head: true,
      count: "exact",
    }).eq("workspace_id", workspaceId);
    if (error || count !== 0) {
      throw new Error(`full cleanup left ${count ?? "unknown"} rows in ${table}`);
    }
  }
}

async function cleanupTry(label, operation, critical = false) {
  try {
    await operation();
    evidence.cleanup.actions.push({ label, ok: true });
  } catch (error) {
    evidence.cleanup.actions.push({ label, ok: false });
    evidence.cleanup.errors.push({
      label,
      critical,
      error: safeMessage(error),
    });
  }
}

async function edgeJson(functionName, path, options) {
  const method = options.method ?? "POST";
  const expectedStatuses = options.expectedStatuses ?? [200];
  const started = performance.now();
  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
    },
  );
  const payload = await response.json().catch(() => ({}));
  evidence.http.push({
    function: functionName,
    path,
    method,
    status: response.status,
    duration_ms: Math.round(performance.now() - started),
    cleanup: options.cleanup === true,
  });
  if (!expectedStatuses.includes(response.status)) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : `unexpected HTTP ${response.status}`;
    throw new Error(`${functionName}/${path} failed (${response.status}): ${message}`);
  }
  return { status: response.status, payload };
}

async function insertRows(table, rows) {
  const { error } = await runtime.admin.from(table).insert(rows);
  if (error) throw new Error(`${table} fixture insert failed: ${error.message}`);
}

async function must(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  return result;
}

function check(name, ok, detail = {}) {
  evidence.checks.push({ name, ok: Boolean(ok), detail: sanitizeDetail(detail) });
  if (!ok) throw new Error(`acceptance check failed: ${name}`);
}

function findImpact(payload, quoteId) {
  return Array.isArray(payload?.impacts)
    ? payload.impacts.find((row) => row.quote_package_id === quoteId) ?? null
    : null;
}

function verifyProjectIdentity() {
  if (!supabaseUrl) throw new Error("SUPABASE_URL or VITE_SUPABASE_URL is required");
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }
  const ref = parsed.hostname.split(".")[0];
  if (ref !== EXPECTED_PROJECT_REF) {
    throw new Error(`refusing project ${ref || "unknown"}; expected ${EXPECTED_PROJECT_REF}`);
  }
  const explicitRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (explicitRef && explicitRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`SUPABASE_PROJECT_REF mismatch; expected ${EXPECTED_PROJECT_REF}`);
  }
  return ref;
}

function safeMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [serviceRoleKey, anonKey]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[REDACTED_JWT]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[REDACTED_TOKEN]")
    .slice(0, 1000);
}

function sanitizeDetail(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) => {
    if (/token|password|secret|key|email/i.test(key)) return undefined;
    if (typeof entry === "string") return safeMessage(entry);
    return entry;
  }));
}

function makeFixtureIds() {
  const names = [
    "brandPrimary", "brandOther",
    "modelFactory", "modelYard", "modelQuiet", "modelOther",
    "catalogFactory", "catalogYard", "catalogQuiet", "catalogOther",
    "sheetPrior", "sheetIncoming",
    "priorFactoryItem", "priorYardItem", "priorQuietItem",
    "incomingFactoryItem", "incomingYardItem", "incomingQuietItem",
    "marginThreshold", "stage", "companyPrimary", "companyLocked",
    "dealPrimary", "dealLocked", "dealQuiet", "dealOther",
    "quotePrimary", "quoteLocked", "quoteQuiet", "quoteOther",
    "lineFactory", "lineYard", "lineOther", "lineLocked", "lineQuiet",
    "lineOtherOnly", "initialVersion",
  ];
  return Object.fromEntries(names.map((name) => [name, crypto.randomUUID()]));
}

function modelRow(id, brandId, modelCode, listPriceCents) {
  return {
    id,
    workspace_id: workspaceId,
    brand_id: brandId,
    model_code: modelCode,
    family: "Acceptance",
    name_display: `${runTag} ${modelCode}`,
    list_price_cents: listPriceCents,
    active: true,
    specs: { acceptance_run: runTag },
  };
}

function catalogRow(id, make, model, listPrice, dealerCost, sourceLocation) {
  return {
    id,
    workspace_id: workspaceId,
    source: "manual",
    external_id: `${runTag}:${id}`,
    make,
    model,
    category: "construction",
    list_price: listPrice,
    dealer_cost: dealerCost,
    is_available: true,
    condition: "new",
    source_location: sourceLocation,
    cost_to_qep: dealerCost,
  };
}

function sheetItem(id, sheetId, modelId, modelCode, listPriceCents, appliedAt) {
  return {
    id,
    workspace_id: workspaceId,
    price_sheet_id: sheetId,
    item_type: "model",
    extracted: {
      model_code: modelCode,
      name_display: `${runTag} ${modelCode}`,
      family: "Acceptance",
      list_price_cents: listPriceCents,
      specs: { acceptance_run: runTag },
    },
    proposed_model_id: modelId,
    action: "update",
    confidence: 1,
    review_status: "approved",
    reviewer_notes: runTag,
    applied_at: appliedAt,
  };
}

function dealRow(id, companyId, name, repId) {
  return {
    id,
    workspace_id: workspaceId,
    name,
    stage_id: ids.stage,
    company_id: companyId,
    assigned_rep_id: repId,
    amount: 40_000,
    margin_amount: 10_000,
    margin_pct: 25,
    metadata: { acceptance_run: runTag },
  };
}

function quoteRow(id, dealId, repId, total, dealerCost, equipment) {
  const margin = total - dealerCost;
  return {
    id,
    quote_number: `${runTag}-${id.slice(0, 8)}`,
    workspace_id: workspaceId,
    deal_id: dealId,
    equipment,
    status: "draft",
    entry_mode: "manual",
    created_by: repId,
    equipment_total: total,
    attachment_total: 0,
    subtotal: total,
    discount_total: 0,
    trade_credit: 0,
    net_total: total,
    tax_total: 0,
    cash_down: 0,
    amount_financed: total,
    margin_amount: margin,
    margin_pct: Math.round((margin / total) * 10_000) / 100,
    commercial_discount_type: "flat",
    commercial_discount_value: 0,
    requires_requote: false,
    delivery_state: "FL",
    post_approval_action: "return_to_rep",
    opportunity_description: `${runTag} production acceptance fixture`,
    metadata: { acceptance_run: runTag },
  };
}

function lineRow(
  id,
  quoteId,
  catalogId,
  make,
  model,
  price,
  cost,
  sourceLocation,
  displayOrder,
) {
  return {
    id,
    workspace_id: workspaceId,
    quote_package_id: quoteId,
    catalog_entry_id: catalogId,
    make,
    model,
    quoted_list_price: price,
    quoted_dealer_cost: cost,
    quantity: 1,
    source_location: sourceLocation,
    line_type: "equipment",
    description: `${runTag} ${make} ${model}`,
    unit_price: price,
    extended_price: price,
    display_order: displayOrder,
    cost_visibility: "customer",
    metadata: { acceptance_run: runTag },
  };
}
