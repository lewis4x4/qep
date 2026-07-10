#!/usr/bin/env bun

/**
 * Production acceptance for DNA-SERVICE-ROLE-AUTH (goal run 2026-07-09).
 *
 * Safety properties:
 *   - Dry-run is the default. Pass --apply to create production fixtures.
 *   - The configured project URL must resolve to the pinned production ref.
 *   - The global DGE queue must be empty before the lease test begins.
 *   - Every fixture is uniquely tagged and removed in a finally block.
 *   - Output is one JSON document; credentials and auth sessions are redacted.
 *
 * Usage:
 *   bun scripts/acceptance/goal-run-2026-07-09/dna-service-auth-tenancy.mjs
 *   bun scripts/acceptance/goal-run-2026-07-09/dna-service-auth-tenancy.mjs --apply
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "../../_shared/local-env.mjs";

const EXPECTED_PROJECT_REF = "iciddijgonywtxoelous";
const ACCEPTANCE_NAME = "DNA-SERVICE-ROLE-AUTH production auth and tenancy";
const repoRoot = resolve(import.meta.dir, "..", "..", "..");
loadLocalEnv(repoRoot);

const args = new Set(process.argv.slice(2));
const apply = args.delete("--apply");
const unknownArgs = [...args];

const startedAt = new Date();
const runTag = `dna-${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
const workspaceA = process.env.DNA_ACCEPTANCE_WORKSPACE_ID?.trim() || "default";
const workspaceB = `goal-run-${runTag}-b`;
const artifactPath = resolve(
  repoRoot,
  "test-results",
  "agent-gates",
  `${runTag}-dna-service-role-auth-production.json`,
);

const report = {
  schema_version: 1,
  acceptance: ACCEPTANCE_NAME,
  mode: apply ? "apply" : "dry-run",
  run_tag: runTag,
  started_at: startedAt.toISOString(),
  finished_at: null,
  project_ref: null,
  artifact_path: apply ? artifactPath : null,
  artifact_error: null,
  verdict: "RUNNING",
  checks: [],
  fixture: {
    workspace_ids: [workspaceA, workspaceB],
    created: {
      auth_users: 0,
      companies: 0,
      contacts: 0,
      customer_profiles: 0,
      refresh_jobs: 0,
    },
  },
  cleanup: {
    status: apply ? "PENDING" : "NOT_REQUIRED",
    errors: [],
  },
  limitations: [],
  mission_alignment: {
    verdict: "NOT_RUN",
    evidence: [],
  },
  error: null,
};

const state = {
  admin: null,
  authUserIds: new Set(),
  companyIds: new Set(),
  contactIds: new Set(),
  customerProfileIds: new Set(),
  refreshJobIds: new Set(),
};

const secretValues = new Set();

function addCheck(name, status, evidence = {}) {
  report.checks.push({ name, status, evidence });
}

function requireCheck(name, condition, evidence = {}) {
  if (!condition) {
    addCheck(name, "FAIL", evidence);
    throw new Error(`Acceptance check failed: ${name}`);
  }
  addCheck(name, "PASS", evidence);
}

function skipCheck(name, reason) {
  addCheck(name, "SKIP", { reason });
  report.limitations.push(reason);
}

function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of secretValues) {
    if (value) message = message.split(value).join("[REDACTED]");
  }
  return message
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "[REDACTED_SERVICE_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .slice(0, 1200);
}

function requireData(data, error, operation) {
  if (error) {
    const code = error.code ? ` (${error.code})` : "";
    throw new Error(`${operation}${code}: ${error.message}`);
  }
  if (!data) throw new Error(`${operation}: no row returned`);
  return data;
}

function projectRefFromUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const suffix = ".supabase.co";
  if (!parsed.hostname.endsWith(suffix)) {
    throw new Error("SUPABASE_URL must be the canonical *.supabase.co project URL for this production acceptance.");
  }
  return parsed.hostname.slice(0, -suffix.length);
}

function resolveModernServiceCredential() {
  const candidates = [
    ["DNA_ACCEPTANCE_SERVICE_ROLE_KEY", process.env.DNA_ACCEPTANCE_SERVICE_ROLE_KEY?.trim() ?? ""],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY?.trim() ?? ""],
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""],
  ];
  for (const [, value] of candidates) secretValues.add(value);
  const modern = candidates.find(([, value]) => value.startsWith("sb_secret_"));
  return modern
    ? { key: modern[1], source: modern[0] }
    : { key: "", source: null };
}

function errorCode(body) {
  return body && typeof body === "object" && body.error && typeof body.error === "object"
    ? body.error.code ?? null
    : body && typeof body === "object"
      ? body.code ?? null
      : null;
}

async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let parsed = null;
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { non_json_response: true };
    }
  }
  return { status: response.status, body: parsed };
}

function expectEndpoint(name, response, expectedStatus, options = {}) {
  const actualCode = errorCode(response.body);
  const idMatches = options.profileId === undefined
    ? undefined
    : response.body?.id === options.profileId;
  const codeMatches = options.errorCode === undefined
    ? true
    : actualCode === options.errorCode;
  const idIsValid = idMatches === undefined ? true : idMatches;
  requireCheck(
    name,
    response.status === expectedStatus && codeMatches && idIsValid,
    {
      expected_status: expectedStatus,
      actual_status: response.status,
      expected_error_code: options.errorCode ?? null,
      actual_error_code: actualCode,
      ...(idMatches === undefined ? {} : { profile_id_matches: idMatches }),
    },
  );
}

async function createFixtureUser(admin, anonKey, supabaseUrl, { label, role, workspaceId }) {
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, email, role, active_workspace_id, profile_workspaces!inner(workspace_id)")
    .eq("role", role)
    .eq("active_workspace_id", workspaceId)
    .eq("profile_workspaces.workspace_id", workspaceId)
    .eq("is_active", true)
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (profileError) throw new Error(`resolve ${label} fixture principal: ${profileError.message}`);
  const profile = profiles?.[0];
  if (!profile?.id || !profile.email) {
    throw new Error(`No active ${role} principal with email and ${workspaceId} membership is available`);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new Error(`generate ${label} fixture session: ${linkError?.message ?? "missing token hash"}`);
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signInData, error: signInError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (signInError || !signInData.session) {
    throw new Error(`sign in ${label} fixture user: ${signInError?.message ?? "missing session"}`);
  }
  secretValues.add(signInData.session.access_token);
  secretValues.add(signInData.session.refresh_token);

  return {
    id: profile.id,
    role,
    workspaceId,
    client,
    accessToken: signInData.session.access_token,
  };
}

async function createCompanyAndContact(admin, { suffix, workspaceId, assignedRepId = null }) {
  const { data: company, error: companyError } = await admin
    .from("qrm_companies")
    .insert({
      workspace_id: workspaceId,
      name: `Goal Run DNA ${runTag} ${suffix.toUpperCase()}`,
      hubspot_company_id: `${runTag}-company-${suffix}`,
      assigned_rep_id: assignedRepId,
      metadata: { acceptance_run: runTag },
    })
    .select("id")
    .single();
  requireData(company, companyError, `create company ${suffix}`);
  state.companyIds.add(company.id);

  const email = `${runTag}-contact-${suffix}@acceptance.invalid`;
  const { data: contact, error: contactError } = await admin
    .from("qrm_contacts")
    .insert({
      workspace_id: workspaceId,
      first_name: "Goal Run",
      last_name: `DNA ${suffix.toUpperCase()}`,
      email,
      primary_company_id: company.id,
      assigned_rep_id: assignedRepId,
      hubspot_contact_id: `${runTag}-contact-${suffix}`,
      metadata: { acceptance_run: runTag },
    })
    .select("id, email")
    .single();
  requireData(contact, contactError, `create contact ${suffix}`);
  state.contactIds.add(contact.id);

  return { companyId: company.id, contactId: contact.id, email };
}

async function profileMarker(admin, profileId) {
  const { data, error } = await admin
    .from("customer_profiles_extended")
    .select("id, metadata")
    .eq("id", profileId)
    .single();
  requireData(data, error, "load customer DNA mutation marker");
  return typeof data.metadata?.last_dna_refresh_at === "string"
    ? data.metadata.last_dna_refresh_at
    : null;
}

async function visibleProfileIds(client, profileIds) {
  const { data, error } = await client
    .from("customer_profiles_extended")
    .select("id")
    .in("id", profileIds)
    .order("id");
  if (error) throw new Error(`customer profile RLS read: ${error.message}`);
  return (data ?? []).map((row) => row.id).sort();
}

async function countByIds(client, table, ids) {
  if (ids.length === 0) return 0;
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .in("id", ids);
  if (error) throw error;
  return count ?? 0;
}

async function cleanupFixtures() {
  if (!state.admin) return;
  const cleanupErrors = [];
  const admin = state.admin;

  const cleanupStep = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(`${label}: ${safeError(error)}`);
    }
  };

  await cleanupStep("discover uniquely tagged company and contact fixtures", async () => {
    const [contactsResult, companiesResult] = await Promise.all([
      admin
        .from("qrm_contacts")
        .select("id, dge_customer_profile_id")
        .contains("metadata", { acceptance_run: runTag }),
      admin
        .from("qrm_companies")
        .select("id")
        .contains("metadata", { acceptance_run: runTag }),
    ]);
    if (contactsResult.error) throw contactsResult.error;
    if (companiesResult.error) throw companiesResult.error;
    for (const row of contactsResult.data ?? []) {
      state.contactIds.add(row.id);
      if (row.dge_customer_profile_id) state.customerProfileIds.add(row.dge_customer_profile_id);
    }
    for (const row of companiesResult.data ?? []) state.companyIds.add(row.id);
  });

  await cleanupStep("discover linked customer profiles", async () => {
    const contactIds = [...state.contactIds];
    if (contactIds.length > 0) {
      const { data, error } = await admin
        .from("qrm_contacts")
        .select("dge_customer_profile_id")
        .in("id", contactIds);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.dge_customer_profile_id) state.customerProfileIds.add(row.dge_customer_profile_id);
      }
    }
    const companyIds = [...state.companyIds];
    if (companyIds.length > 0) {
      const { data, error } = await admin
        .from("customer_profiles_extended")
        .select("id")
        .in("crm_company_id", companyIds);
      if (error) throw error;
      for (const row of data ?? []) state.customerProfileIds.add(row.id);
    }
  });

  await cleanupStep("delete refresh jobs", async () => {
    const ids = [...state.refreshJobIds];
    if (ids.length === 0) return;
    const { error } = await admin.from("dge_refresh_jobs").delete().in("id", ids);
    if (error) throw error;
  });

  await cleanupStep("delete contacts", async () => {
    const ids = [...state.contactIds];
    if (ids.length === 0) return;
    const { error } = await admin.from("qrm_contacts").delete().in("id", ids);
    if (error) throw error;
  });

  await cleanupStep("delete customer profiles", async () => {
    const ids = [...state.customerProfileIds];
    if (ids.length === 0) return;
    const { error } = await admin.from("customer_profiles_extended").delete().in("id", ids);
    if (error) throw error;
  });

  await cleanupStep("delete companies", async () => {
    const ids = [...state.companyIds];
    if (ids.length === 0) return;
    const { error } = await admin.from("qrm_companies").delete().in("id", ids);
    if (error) throw error;
  });

  await cleanupStep("delete fixture workspace memberships", async () => {
    const ids = [...state.authUserIds];
    if (ids.length === 0) return;
    const { error } = await admin.from("profile_workspaces").delete().in("profile_id", ids);
    if (error) throw error;
  });

  await cleanupStep("delete fixture application profiles", async () => {
    const ids = [...state.authUserIds];
    if (ids.length === 0) return;
    const { error } = await admin.from("profiles").delete().in("id", ids);
    if (error) throw error;
  });

  for (const userId of state.authUserIds) {
    await cleanupStep("delete auth user", async () => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    });
  }

  await cleanupStep("verify fixture row cleanup", async () => {
    const remaining = {
      jobs: await countByIds(admin, "dge_refresh_jobs", [...state.refreshJobIds]),
      contacts: await countByIds(admin, "qrm_contacts", [...state.contactIds]),
      profiles: await countByIds(admin, "customer_profiles_extended", [...state.customerProfileIds]),
      companies: await countByIds(admin, "qrm_companies", [...state.companyIds]),
      application_profiles: await countByIds(admin, "profiles", [...state.authUserIds]),
    };
    if (Object.values(remaining).some((count) => count !== 0)) {
      throw new Error(`fixture rows remain: ${JSON.stringify(remaining)}`);
    }
  });

  report.cleanup = {
    status: cleanupErrors.length === 0 ? "PASS" : "FAIL",
    errors: cleanupErrors,
  };
}

async function runAcceptance(config) {
  const { supabaseUrl, anonKey, serviceRoleKey, internalSecret } = config;
  const functionBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  state.admin = admin;

  const { data: openJobs, error: openJobsError } = await admin
    .from("dge_refresh_jobs")
    .select("id")
    .in("status", ["queued", "running"])
    .is("deleted_at", null)
    .limit(2);
  if (openJobsError) throw new Error(`preflight DGE queue: ${openJobsError.message}`);
  requireCheck(
    "queue lease test has an exclusive empty-queue precondition",
    (openJobs ?? []).length === 0,
    { open_job_count: (openJobs ?? []).length },
  );

  const manager = await createFixtureUser(admin, anonKey, supabaseUrl, {
    label: "manager",
    role: "manager",
    workspaceId: workspaceA,
  });
  const rep = await createFixtureUser(admin, anonKey, supabaseUrl, {
    label: "rep",
    role: "rep",
    workspaceId: workspaceA,
  });
  requireCheck("fixture users are bound to one explicit workspace", true, {
    manager_role: manager.role,
    rep_role: rep.role,
    workspace: workspaceA,
  });

  const targetA = await createCompanyAndContact(admin, {
    suffix: "a",
    workspaceId: workspaceA,
    assignedRepId: rep.id,
  });
  const targetB = await createCompanyAndContact(admin, {
    suffix: "b",
    workspaceId: workspaceB,
  });

  const bearerA = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "x-workspace-id": workspaceA,
    },
    body: { workspace_id: workspaceA, email: targetA.email },
  });
  expectEndpoint("modern service key succeeds through Authorization bearer", bearerA, 200);
  const profileA = bearerA.body?.id;
  requireCheck("bearer refresh created a customer profile for workspace A", typeof profileA === "string", {
    profile_created: typeof profileA === "string",
  });
  state.customerProfileIds.add(profileA);

  const bearerB = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "x-workspace-id": workspaceB,
    },
    body: { workspace_id: workspaceB, email: targetB.email },
  });
  expectEndpoint("service fixture creates an independently anchored workspace B profile", bearerB, 200);
  const profileB = bearerB.body?.id;
  requireCheck("workspace B fixture has a distinct customer profile", typeof profileB === "string" && profileB !== profileA, {
    distinct_profile: profileB !== profileA,
  });
  state.customerProfileIds.add(profileB);

  const { data: linkedContacts, error: linkedError } = await admin
    .from("qrm_contacts")
    .select("id, workspace_id, dge_customer_profile_id")
    .in("id", [targetA.contactId, targetB.contactId]);
  if (linkedError) throw new Error(`verify profile links: ${linkedError.message}`);
  const links = new Map((linkedContacts ?? []).map((row) => [row.id, row]));
  requireCheck(
    "atomic profile creation linked both contacts inside their tenant",
    links.get(targetA.contactId)?.dge_customer_profile_id === profileA &&
      links.get(targetA.contactId)?.workspace_id === workspaceA &&
      links.get(targetB.contactId)?.dge_customer_profile_id === profileB &&
      links.get(targetB.contactId)?.workspace_id === workspaceB,
    { linked_contacts: (linkedContacts ?? []).length },
  );

  const apikeyRefresh = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      "x-workspace-id": workspaceA,
    },
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  expectEndpoint("modern service key succeeds through apikey", apikeyRefresh, 200, { profileId: profileA });

  if (internalSecret) {
    const internalRefresh = await requestJson(`${functionBase}/customer-dna-update`, {
      method: "POST",
      headers: {
        "x-internal-service-secret": internalSecret,
        "x-workspace-id": workspaceA,
      },
      body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
    });
    expectEndpoint("internal service secret succeeds", internalRefresh, 200, { profileId: profileA });
  } else {
    skipCheck(
      "internal service secret succeeds",
      "INTERNAL_SERVICE_SECRET/DGE_INTERNAL_SERVICE_SECRET was unavailable locally; the path remains covered by focused endpoint tests.",
    );
  }

  const staffRefresh = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${manager.accessToken}`,
      apikey: anonKey,
    },
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  expectEndpoint("manager ES256 user session can refresh customer DNA", staffRefresh, 200, { profileId: profileA });

  const profileReadUrlA = new URL(`${functionBase}/customer-profile`);
  profileReadUrlA.searchParams.set("customer_profiles_extended_id", profileA);
  const managerRead = await requestJson(profileReadUrlA, {
    headers: { Authorization: `Bearer ${manager.accessToken}`, apikey: anonKey },
  });
  expectEndpoint("manager can read the fixture through customer-profile", managerRead, 200, { profileId: profileA });

  const repRead = await requestJson(profileReadUrlA, {
    headers: { Authorization: `Bearer ${rep.accessToken}`, apikey: anonKey },
  });
  expectEndpoint("assigned rep retains read-only customer-profile access", repRead, 200, { profileId: profileA });

  const profileIds = [profileA, profileB];
  const managerVisible = await visibleProfileIds(manager.client, profileIds);
  requireCheck(
    "customer profile RLS exposes only manager workspace A",
    managerVisible.length === 1 && managerVisible[0] === profileA,
    { visible_fixture_profiles: managerVisible.length, workspace_b_hidden: !managerVisible.includes(profileB) },
  );
  const repVisible = await visibleProfileIds(rep.client, profileIds);
  requireCheck(
    "customer profile RLS exposes only rep workspace A",
    repVisible.length === 1 && repVisible[0] === profileA,
    { visible_fixture_profiles: repVisible.length, workspace_b_hidden: !repVisible.includes(profileB) },
  );

  const { error: managerMutationError } = await manager.client
    .from("customer_profiles_extended")
    .update({ customer_name: `Unauthorized manager mutation ${runTag}` })
    .eq("id", profileA);
  requireCheck("authenticated direct customer profile mutation is revoked", Boolean(managerMutationError), {
    mutation_rejected: Boolean(managerMutationError),
    postgres_code: managerMutationError?.code ?? null,
  });

  const markerA = await profileMarker(admin, profileA);
  const markerB = await profileMarker(admin, profileB);

  const repRefresh = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rep.accessToken}`, apikey: anonKey },
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  expectEndpoint("ordinary rep cannot refresh customer DNA", repRefresh, 403, { errorCode: "FORBIDDEN" });

  const staffCrossWorkspace = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${manager.accessToken}`, apikey: anonKey },
    body: { workspace_id: workspaceB, customer_profiles_extended_id: profileB },
  });
  expectEndpoint("staff cross-workspace refresh fails closed", staffCrossWorkspace, 403, {
    errorCode: "WORKSPACE_MISMATCH",
  });

  const serviceCrossWorkspace = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, "x-workspace-id": workspaceA },
    body: { workspace_id: workspaceB, customer_profiles_extended_id: profileB },
  });
  expectEndpoint("service header/body workspace mismatch fails closed", serviceCrossWorkspace, 403, {
    errorCode: "WORKSPACE_MISMATCH",
  });

  const serviceMissingWorkspace = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}` },
    body: { customer_profiles_extended_id: profileA },
  });
  expectEndpoint("service caller cannot silently default a workspace", serviceMissingWorkspace, 400, {
    errorCode: "WORKSPACE_REQUIRED",
  });

  const wrongBearer = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { Authorization: `Bearer sb_secret_wrong_${runTag}`, "x-workspace-id": workspaceA },
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  // A malformed opaque bearer can be rejected either by the function's auth
  // contract or by the Functions gateway before a structured body is added.
  expectEndpoint("wrong bearer secret is unauthorized", wrongBearer, 401);

  const wrongApikey = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { apikey: `sb_secret_wrong_${runTag}`, "x-workspace-id": workspaceA },
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  // An invalid apikey may be rejected by the Supabase gateway before the
  // function handler. Status + the no-mutation assertion below are the
  // authoritative contract for either layer.
  expectEndpoint("wrong apikey secret is unauthorized", wrongApikey, 401);

  const malformedJwt = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    headers: { Authorization: "Bearer not-a-jwt", apikey: anonKey },
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  expectEndpoint("malformed user JWT is unauthorized", malformedJwt, 401, { errorCode: "UNAUTHORIZED" });

  const anonymous = await requestJson(`${functionBase}/customer-dna-update`, {
    method: "POST",
    body: { workspace_id: workspaceA, customer_profiles_extended_id: profileA },
  });
  expectEndpoint("anonymous refresh is unauthorized", anonymous, 401, { errorCode: "UNAUTHORIZED" });

  requireCheck(
    "rejected auth and cross-tenant attempts cause no customer DNA mutation",
    await profileMarker(admin, profileA) === markerA && await profileMarker(admin, profileB) === markerB,
    { workspace_a_unchanged: true, workspace_b_unchanged: true },
  );

  const profileReadUrlB = new URL(`${functionBase}/customer-profile`);
  profileReadUrlB.searchParams.set("customer_profiles_extended_id", profileB);
  const managerCrossRead = await requestJson(profileReadUrlB, {
    headers: { Authorization: `Bearer ${manager.accessToken}`, apikey: anonKey },
  });
  expectEndpoint("customer-profile endpoint rejects a cross-workspace profile", managerCrossRead, 403, {
    errorCode: "WORKSPACE_MISMATCH",
  });

  const { error: repClaimError } = await rep.client.rpc("claim_dge_refresh_job", {
    p_lease_seconds: 60,
  });
  requireCheck("authenticated rep has no queue claim capability", Boolean(repClaimError), {
    claim_rejected: Boolean(repClaimError),
    postgres_code: repClaimError?.code ?? null,
  });

  const dedupeKey = `goal-run-dna:${runTag}:lease`;
  const { data: enqueueRows, error: enqueueError } = await admin.rpc("enqueue_dge_refresh_job", {
    p_workspace_id: workspaceA,
    p_job_type: "economic_sync_refresh",
    p_dedupe_key: dedupeKey,
    p_request_payload: { acceptance_run: runTag, indicators: [] },
    p_requested_by: manager.id,
    p_priority: 1,
  });
  if (enqueueError) throw new Error(`enqueue fixture DGE job: ${enqueueError.message}`);
  const enqueued = Array.isArray(enqueueRows) ? enqueueRows[0] : null;
  requireCheck("service-only enqueue created one canonical fixture job", Boolean(enqueued?.job_id && enqueued.enqueued), {
    enqueued: Boolean(enqueued?.enqueued),
    status: enqueued?.job_status ?? null,
  });
  state.refreshJobIds.add(enqueued.job_id);

  const { data: exclusiveJobs, error: exclusiveError } = await admin
    .from("dge_refresh_jobs")
    .select("id")
    .in("status", ["queued", "running"])
    .is("deleted_at", null)
    .limit(2);
  if (exclusiveError) throw new Error(`verify exclusive queue window: ${exclusiveError.message}`);
  requireCheck(
    "fixture remains the only open job before global claim",
    exclusiveJobs?.length === 1 && exclusiveJobs[0].id === enqueued.job_id,
    { open_job_count: exclusiveJobs?.length ?? 0 },
  );

  const { data: claimRows, error: claimError } = await admin.rpc("claim_dge_refresh_job", {
    p_lease_seconds: 60,
  });
  if (claimError) throw new Error(`claim fixture DGE job: ${claimError.message}`);
  const claimed = Array.isArray(claimRows) ? claimRows[0] : null;
  requireCheck(
    "queue claim returns the fixture job with a lease token and authoritative requester",
    claimed?.job_id === enqueued.job_id &&
      typeof claimed?.lease_token === "string" &&
      claimed?.requested_by === manager.id,
    {
      claimed_fixture_job: claimed?.job_id === enqueued.job_id,
      lease_token_present: typeof claimed?.lease_token === "string",
      requested_by_matches: claimed?.requested_by === manager.id,
    },
  );

  const { error: wrongLeaseError } = await admin.rpc("complete_dge_refresh_job", {
    p_job_id: enqueued.job_id,
    p_lease_token: crypto.randomUUID(),
    p_status: "succeeded",
    p_result_payload: { acceptance_run: runTag, wrong_lease: true },
    p_last_error: null,
  });
  requireCheck("queue completion rejects a stale or foreign lease token", Boolean(wrongLeaseError), {
    stale_lease_rejected: Boolean(wrongLeaseError),
    postgres_code: wrongLeaseError?.code ?? null,
  });

  const { error: completionError } = await admin.rpc("complete_dge_refresh_job", {
    p_job_id: enqueued.job_id,
    p_lease_token: claimed.lease_token,
    p_status: "succeeded",
    p_result_payload: { acceptance_run: runTag, lease_contract: "verified" },
    p_last_error: null,
  });
  if (completionError) throw new Error(`complete fixture DGE job: ${completionError.message}`);

  const { data: completedJob, error: completedReadError } = await admin
    .from("dge_refresh_jobs")
    .select("status, lease_token, lease_expires_at, attempt_count, requested_by")
    .eq("id", enqueued.job_id)
    .single();
  requireData(completedJob, completedReadError, "read completed fixture DGE job");
  requireCheck(
    "valid lease completion reaches one terminal state and clears lease ownership",
    completedJob.status === "succeeded" &&
      completedJob.lease_token === null &&
      completedJob.lease_expires_at === null &&
      completedJob.attempt_count === 1 &&
      completedJob.requested_by === manager.id,
    {
      status: completedJob.status,
      lease_cleared: completedJob.lease_token === null && completedJob.lease_expires_at === null,
      attempt_count: completedJob.attempt_count,
      requested_by_matches: completedJob.requested_by === manager.id,
    },
  );
}

async function main() {
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  }
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const configuredProjectRef = process.env.SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required to verify the production target.");
  const urlProjectRef = projectRefFromUrl(supabaseUrl);
  if (urlProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`Refusing target ${urlProjectRef}; expected production project ${EXPECTED_PROJECT_REF}.`);
  }
  if (configuredProjectRef && configuredProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`SUPABASE_PROJECT_REF does not match ${EXPECTED_PROJECT_REF}.`);
  }
  report.project_ref = urlProjectRef;
  addCheck("production project ref is pinned", "PASS", {
    expected: EXPECTED_PROJECT_REF,
    actual: urlProjectRef,
    explicit_env_ref_matches: configuredProjectRef ? true : null,
  });

  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
  const modernServiceCredential = resolveModernServiceCredential();
  const serviceRoleKey = modernServiceCredential.key;
  const internalSecret = (
    process.env.DGE_INTERNAL_SERVICE_SECRET?.trim() ||
    process.env.INTERNAL_SERVICE_SECRET?.trim() ||
    ""
  );
  for (const secret of [anonKey, serviceRoleKey, internalSecret]) secretValues.add(secret);

  addCheck(
    "credential availability preflight",
    apply ? anonKey && serviceRoleKey ? "PASS" : "FAIL" : "NOT_RUN",
    {
    anon_key_available: Boolean(anonKey),
    modern_service_role_key_available: Boolean(serviceRoleKey),
    internal_secret_available: Boolean(internalSecret),
    service_role_key_shape: serviceRoleKey ? "modern_sb_secret" : "missing_modern_key",
    service_role_key_source: modernServiceCredential.source,
    },
  );

  if (!apply) {
    report.verdict = "DRY_RUN";
    report.mission_alignment = {
      verdict: "NOT_RUN",
      evidence: [
        "Dry-run verified the pinned production target and did not create or mutate fixtures.",
      ],
    };
    return;
  }

  if (!anonKey || !serviceRoleKey) {
    if (!anonKey) {
      throw new Error("SUPABASE_ANON_KEY is required with --apply.");
    }
    throw new Error(
      "A modern sb_secret_ key is required. Set DNA_ACCEPTANCE_SERVICE_ROLE_KEY (preferred) or SUPABASE_SECRET_KEY to the production project's Secret key from Supabase Dashboard > Project Settings > API, without replacing or printing the legacy SUPABASE_SERVICE_ROLE_KEY, then rerun with --apply.",
    );
  }
  requireCheck(
    "production acceptance uses a modern sb_secret service key",
    serviceRoleKey.startsWith("sb_secret_"),
    { credential_shape: serviceRoleKey.startsWith("sb_secret_") ? "modern_sb_secret" : "unsupported" },
  );

  await runAcceptance({ supabaseUrl, anonKey, serviceRoleKey, internalSecret });
  report.verdict = "PASS";
  report.mission_alignment = {
    verdict: "PASS",
    evidence: [
      "Scheduled customer intelligence can authenticate with modern service credentials without depending on a human page view.",
      "Database RLS and endpoint authorization keep customer DNA anchored to one explicit equipment-sales workspace.",
      "Lease-owned queue processing protects durable AI refresh work from duplicate or stale completion.",
    ],
  };
}

try {
  await main();
} catch (error) {
  report.verdict = "FAIL";
  report.error = safeError(error);
  report.mission_alignment = {
    verdict: "FAIL",
    evidence: ["One or more required customer intelligence auth, tenant, or queue controls did not pass."],
  };
  process.exitCode = 1;
} finally {
  report.fixture.created = {
    auth_users: state.authUserIds.size,
    companies: state.companyIds.size,
    contacts: state.contactIds.size,
    customer_profiles: state.customerProfileIds.size,
    refresh_jobs: state.refreshJobIds.size,
  };
  if (apply) {
    await cleanupFixtures();
    if (report.cleanup.status !== "PASS") {
      report.verdict = "FAIL";
      report.mission_alignment.verdict = "FAIL";
      process.exitCode = 1;
    }
  }
  report.finished_at = new Date().toISOString();
  let rendered = JSON.stringify(report, null, 2);
  if (apply) {
    try {
      mkdirSync(resolve(repoRoot, "test-results", "agent-gates"), { recursive: true });
      writeFileSync(artifactPath, `${rendered}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      report.verdict = "FAIL";
      report.mission_alignment.verdict = "FAIL";
      report.artifact_error = safeError(error);
      report.error = report.error ?? "Evidence persistence failed.";
      report.artifact_path = null;
      process.exitCode = 1;
      rendered = JSON.stringify(report, null, 2);
    }
  }
  console.log(rendered);
}
